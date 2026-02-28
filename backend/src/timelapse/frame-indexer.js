import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { getDb } from '../db/index.js';

const DATA_DIR = path.join(config.dataDir, 'timelapse');

/**
 * Frame indexer service - provides O(1) frame lookups via SQLite
 * Replaces O(n) filesystem scans for timelapse operations
 */
class FrameIndexer {
  /**
   * Parse filename to ISO timestamp
   * Filename: 2026-02-27T12-59-40-366Z.jpg -> 2026-02-27T12:59:40.366Z
   */
  parseTimestamp(filename) {
    const base = filename.replace('.jpg', '');
    // Replace dashes at specific positions back to colons/dots
    // Format: YYYY-MM-DDTHH-MM-SS-mmmZ
    // Positions: 0-3=year, 5-6=month, 8-9=day, 11-12=hour, 14-15=min, 17-18=sec, 20-22=ms
    let result = '';
    for (let i = 0; i < base.length; i++) {
      const char = base[i];
      if (char === '-') {
        if (i === 4 || i === 7) {
          result += '-'; // Keep date dashes
        } else if (i === 13 || i === 16) {
          result += ':'; // Time colons
        } else if (i === 19) {
          result += '.'; // Millisecond dot
        } else {
          result += char;
        }
      } else {
        result += char;
      }
    }
    return result;
  }

  /**
   * Convert ISO timestamp to filename format
   * 2026-02-27T12:59:40.366Z -> 2026-02-27T12-59-40-366Z
   */
  timestampToFilename(timestamp) {
    return timestamp.replace(/[:.]/g, '-');
  }

  /**
   * Index a single frame (called on capture)
   */
  indexFrame(cameraId, filename, fileSize) {
    const db = getDb();
    const timestamp = this.parseTimestamp(filename);

    db.prepare(`
      INSERT OR REPLACE INTO timelapse_frames (camera_id, filename, timestamp, file_size)
      VALUES (?, ?, ?, ?)
    `).run(cameraId, filename, timestamp, fileSize);
  }

  /**
   * Remove a frame from the index
   */
  removeFrame(cameraId, filename) {
    const db = getDb();
    db.prepare(`
      DELETE FROM timelapse_frames WHERE camera_id = ? AND filename = ?
    `).run(cameraId, filename);
  }

  /**
   * Get frame count for a camera - O(1) via COUNT(*)
   */
  getFrameCount(cameraId) {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM timelapse_frames WHERE camera_id = ?
    `).get(cameraId);
    return result?.count || 0;
  }

  /**
   * Get latest frame for a camera - O(1) via indexed ORDER BY LIMIT 1
   */
  getLatestFrame(cameraId) {
    const db = getDb();
    return db.prepare(`
      SELECT filename, timestamp, file_size
      FROM timelapse_frames
      WHERE camera_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(cameraId);
  }

  /**
   * Get oldest frame for a camera
   */
  getOldestFrame(cameraId) {
    const db = getDb();
    return db.prepare(`
      SELECT filename, timestamp, file_size
      FROM timelapse_frames
      WHERE camera_id = ?
      ORDER BY timestamp ASC
      LIMIT 1
    `).get(cameraId);
  }

  /**
   * Get frames in a time range - O(log n) via indexed range query
   */
  getFrames(cameraId, startTime = null, endTime = null) {
    const db = getDb();
    let query = 'SELECT filename, timestamp, file_size FROM timelapse_frames WHERE camera_id = ?';
    const params = [cameraId];

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(new Date(startTime).toISOString());
    }
    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(new Date(endTime).toISOString());
    }

    query += ' ORDER BY timestamp ASC';
    return db.prepare(query).all(...params);
  }

  /**
   * Get frames for a specific hour (for segment generation)
   */
  getFramesForHour(cameraId, hourStart) {
    const db = getDb();
    const start = new Date(hourStart);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);

    return db.prepare(`
      SELECT filename, timestamp, file_size
      FROM timelapse_frames
      WHERE camera_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `).all(cameraId, start.toISOString(), end.toISOString());
  }

  /**
   * Get distinct hours that have frames (for segment generation)
   */
  getHoursWithFrames(cameraId) {
    const db = getDb();
    // SQLite: extract hour from ISO timestamp
    return db.prepare(`
      SELECT DISTINCT substr(timestamp, 1, 13) || ':00:00.000Z' as hour_start
      FROM timelapse_frames
      WHERE camera_id = ?
      ORDER BY hour_start ASC
    `).all(cameraId).map(r => r.hour_start);
  }

  /**
   * Delete frames older than a cutoff timestamp
   */
  deleteOldFrames(cameraId, cutoffTimestamp) {
    const db = getDb();
    return db.prepare(`
      DELETE FROM timelapse_frames
      WHERE camera_id = ? AND timestamp < ?
    `).run(cameraId, cutoffTimestamp).changes;
  }

  /**
   * Delete all frames for a camera
   */
  deleteAllFrames(cameraId) {
    const db = getDb();
    return db.prepare(`
      DELETE FROM timelapse_frames WHERE camera_id = ?
    `).run(cameraId).changes;
  }

  /**
   * Check if index exists for a camera
   */
  isIndexed(cameraId) {
    return this.getFrameCount(cameraId) > 0;
  }

  /**
   * Migrate existing frames to index (one-time operation)
   * Call this on startup or manually for existing cameras
   */
  migrateCamera(cameraId) {
    const framesDir = path.join(DATA_DIR, cameraId, 'frames');
    if (!fs.existsSync(framesDir)) return { indexed: 0, skipped: 0 };

    const db = getDb();
    const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));

    // Check how many are already indexed
    const existingCount = this.getFrameCount(cameraId);
    if (existingCount >= files.length) {
      return { indexed: 0, skipped: files.length };
    }

    // Get existing filenames for deduplication
    const existing = new Set(
      db.prepare('SELECT filename FROM timelapse_frames WHERE camera_id = ?')
        .all(cameraId)
        .map(r => r.filename)
    );

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO timelapse_frames (camera_id, filename, timestamp, file_size)
      VALUES (?, ?, ?, ?)
    `);

    let indexed = 0;
    let skipped = 0;

    const insertMany = db.transaction((filesToIndex) => {
      for (const file of filesToIndex) {
        if (existing.has(file)) {
          skipped++;
          continue;
        }
        try {
          const stats = fs.statSync(path.join(framesDir, file));
          const timestamp = this.parseTimestamp(file);
          stmt.run(cameraId, file, timestamp, stats.size);
          indexed++;
        } catch (err) {
          console.error(`[FrameIndexer] Error indexing ${file}:`, err.message);
        }
      }
    });

    insertMany(files);
    console.log(`[FrameIndexer] Migrated camera ${cameraId}: ${indexed} indexed, ${skipped} skipped`);
    return { indexed, skipped };
  }

  /**
   * Migrate all existing cameras
   */
  migrateAll() {
    if (!fs.existsSync(DATA_DIR)) return;

    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    let totalIndexed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'exports') continue;

      const result = this.migrateCamera(entry.name);
      totalIndexed += result.indexed;
    }

    if (totalIndexed > 0) {
      console.log(`[FrameIndexer] Migration complete: ${totalIndexed} frames indexed`);
    }
  }
}

// Export singleton
export const frameIndexer = new FrameIndexer();
