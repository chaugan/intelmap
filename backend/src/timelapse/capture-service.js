import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { frameIndexer } from './frame-indexer.js';

// Lazy import to avoid circular dependency (hlsGenerator imports frameIndexer)
let _hlsGenerator = null;
async function getHlsGenerator() {
  if (!_hlsGenerator) {
    const module = await import('./hls-generator.js');
    _hlsGenerator = module.hlsGenerator;
  }
  return _hlsGenerator;
}

// Singleton capture service - ONE capture job per camera, shared by all subscribers
class CaptureService {
  constructor() {
    this.activeCameras = new Map(); // cameraId -> { intervalId, lastError }
    this.lastFrameHash = new Map(); // cameraId -> md5 hash of last saved frame
    this.dataDir = path.join(config.dataDir, 'timelapse');
  }

  /**
   * Subscribe a user to a camera's timelapse
   * Starts capture if this is the first subscriber
   */
  async subscribe(userId, cameraId, cameraName = '', lat = null, lon = null) {
    const db = getDb();
    const subId = crypto.randomUUID();

    // Upsert subscription (reactivate if exists)
    db.prepare(`
      INSERT INTO timelapse_subscriptions (id, user_id, camera_id, is_active, created_at)
      VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, camera_id) DO UPDATE SET is_active = 1
    `).run(subId, userId, cameraId);

    // Ensure camera record exists with coordinates
    db.prepare(`
      INSERT INTO timelapse_cameras (camera_id, name, lat, lon, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(camera_id) DO UPDATE SET
        name = COALESCE(NULLIF(name, ''), ?),
        lat = COALESCE(lat, ?),
        lon = COALESCE(lon, ?)
    `).run(cameraId, cameraName, lat, lon, cameraName, lat, lon);

    // Update subscriber count
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM timelapse_subscriptions
      WHERE camera_id = ? AND is_active = 1
    `).get(cameraId).c;

    db.prepare(`
      UPDATE timelapse_cameras SET subscriber_count = ? WHERE camera_id = ?
    `).run(count, cameraId);

    // Start capture if first subscriber
    if (!this.activeCameras.has(cameraId)) {
      this.startCapture(cameraId);
    }

    return { subscribed: true, cameraId };
  }

  /**
   * Unsubscribe a user from a camera's timelapse
   * Stops capture if this was the last subscriber (and camera is not protected)
   */
  async unsubscribe(userId, cameraId) {
    const db = getDb();

    db.prepare(`
      UPDATE timelapse_subscriptions SET is_active = 0
      WHERE user_id = ? AND camera_id = ?
    `).run(userId, cameraId);

    // Update subscriber count
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM timelapse_subscriptions
      WHERE camera_id = ? AND is_active = 1
    `).get(cameraId).c;

    db.prepare(`
      UPDATE timelapse_cameras SET subscriber_count = ? WHERE camera_id = ?
    `).run(count, cameraId);

    // Stop capture if no subscribers left (unless protected)
    if (count === 0) {
      const camera = db.prepare('SELECT is_protected FROM timelapse_cameras WHERE camera_id = ?').get(cameraId);
      if (!camera?.is_protected) {
        this.stopCapture(cameraId);
      }
    }

    return { unsubscribed: true, cameraId };
  }

  /**
   * Start capturing frames for a camera
   */
  startCapture(cameraId) {
    if (this.activeCameras.has(cameraId)) return;

    const db = getDb();

    // Create directories
    const cameraDir = path.join(this.dataDir, cameraId);
    const framesDir = path.join(cameraDir, 'frames');
    const segmentsDir = path.join(cameraDir, 'segments');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(segmentsDir, { recursive: true });

    // Mark as capturing
    db.prepare(`
      UPDATE timelapse_cameras SET is_capturing = 1 WHERE camera_id = ?
    `).run(cameraId);

    // Capture frame immediately, then every minute
    const captureFrame = async () => {
      try {
        await this.captureFrame(cameraId);
      } catch (err) {
        console.error(`[Timelapse] Capture error for ${cameraId}:`, err.message);
        const entry = this.activeCameras.get(cameraId);
        if (entry) entry.lastError = err.message;
      }
    };

    captureFrame(); // Initial capture
    const intervalId = setInterval(captureFrame, 60 * 1000); // Every minute

    this.activeCameras.set(cameraId, { intervalId, lastError: null });
    console.log(`[Timelapse] Started capture for camera ${cameraId}`);
  }

  /**
   * Stop capturing frames for a camera
   */
  stopCapture(cameraId) {
    const entry = this.activeCameras.get(cameraId);
    if (!entry) return;

    clearInterval(entry.intervalId);
    this.activeCameras.delete(cameraId);

    const db = getDb();
    db.prepare(`
      UPDATE timelapse_cameras SET is_capturing = 0 WHERE camera_id = ?
    `).run(cameraId);

    console.log(`[Timelapse] Stopped capture for camera ${cameraId}`);
  }

  /**
   * Capture a single frame from the webcam
   */
  async captureFrame(cameraId) {
    const imageUrl = `https://kamera.atlas.vegvesen.no/api/images/${cameraId}`;
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'IntelMap/1.0' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Skip duplicate frames (camera source hasn't updated yet)
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    if (this.lastFrameHash.get(cameraId) === hash) {
      return null; // Identical to last frame, skip
    }
    this.lastFrameHash.set(cameraId, hash);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    const framePath = path.join(framesDir, `${timestamp}.jpg`);

    fs.writeFileSync(framePath, buffer);

    // Index the frame for fast lookups
    const filename = `${timestamp}.jpg`;
    frameIndexer.indexFrame(cameraId, filename, buffer.length);

    // Update database
    const db = getDb();
    const nowIso = now.toISOString();

    db.prepare(`
      UPDATE timelapse_cameras
      SET last_frame_at = ?,
          available_from = COALESCE(available_from, ?),
          available_to = ?
      WHERE camera_id = ?
    `).run(nowIso, nowIso, nowIso, cameraId);

    // Proactively generate/update current hour segment in background
    // This ensures segments are ready before user requests playlist
    this.updateCurrentSegment(cameraId, now).catch(err => {
      console.error(`[Timelapse] Segment update error for ${cameraId}:`, err.message);
    });

    return framePath;
  }

  /**
   * Update the current hour's segment (called after each frame capture)
   * Runs in background, doesn't block frame capture
   */
  async updateCurrentSegment(cameraId, timestamp) {
    const hls = await getHlsGenerator();
    const hourKey = timestamp.toISOString().slice(0, 13); // e.g., "2026-02-28T14"

    try {
      await hls.generateHourSegment(cameraId, hourKey);
    } catch (err) {
      // Ignore errors - segment generation is best-effort
      // Will be retried on next frame or on playlist request
    }
  }

  /**
   * Get list of available frames for a camera within a time range
   * Uses indexed database query - O(log n) instead of O(n) filesystem scan
   */
  getFrames(cameraId, startTime = null, endTime = null) {
    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    const frames = frameIndexer.getFrames(cameraId, startTime, endTime);

    return frames.map(f => ({
      filename: f.filename,
      timestamp: f.timestamp,
      path: path.join(framesDir, f.filename),
    }));
  }

  /**
   * Get a specific frame file path
   */
  getFramePath(cameraId, timestamp) {
    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    const filename = `${timestamp.replace(/[:.]/g, '-')}.jpg`;
    const framePath = path.join(framesDir, filename);
    return fs.existsSync(framePath) ? framePath : null;
  }

  /**
   * Get latest frame for a camera
   * Uses indexed database query - O(1) instead of O(n) filesystem scan
   */
  getLatestFrame(cameraId) {
    const frame = frameIndexer.getLatestFrame(cameraId);
    if (!frame) return null;

    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    return {
      filename: frame.filename,
      timestamp: frame.timestamp,
      path: path.join(framesDir, frame.filename),
    };
  }

  /**
   * Get camera status
   * Uses indexed database queries - O(1) instead of O(n) filesystem scan
   */
  getCameraStatus(cameraId) {
    const db = getDb();
    const camera = db.prepare(`
      SELECT * FROM timelapse_cameras WHERE camera_id = ?
    `).get(cameraId);

    const entry = this.activeCameras.get(cameraId);
    const frameCount = frameIndexer.getFrameCount(cameraId);
    const oldest = frameIndexer.getOldestFrame(cameraId);
    const newest = frameIndexer.getLatestFrame(cameraId);

    return {
      ...camera,
      isCapturing: !!entry,
      lastError: entry?.lastError || null,
      frameCount,
      oldestFrame: oldest?.timestamp || null,
      newestFrame: newest?.timestamp || null,
    };
  }

  /**
   * Get user's subscriptions
   */
  getUserSubscriptions(userId) {
    const db = getDb();
    return db.prepare(`
      SELECT s.*, c.name, c.lat, c.lon, c.is_capturing, c.last_frame_at, c.available_from, c.available_to
      FROM timelapse_subscriptions s
      JOIN timelapse_cameras c ON s.camera_id = c.camera_id
      WHERE s.user_id = ? AND s.is_active = 1
      ORDER BY s.created_at DESC
    `).all(userId);
  }

  /**
   * Get storage size for a camera (frames + segments)
   */
  getStorageSize(cameraId) {
    const cameraDir = path.join(this.dataDir, cameraId);
    if (!fs.existsSync(cameraDir)) return 0;

    let totalSize = 0;
    const countDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) totalSize += stat.size;
        } catch {}
      }
    };

    countDir(path.join(cameraDir, 'frames'));
    countDir(path.join(cameraDir, 'segments'));
    return totalSize;
  }

  /**
   * Get all cameras (for admin)
   * Uses indexed frame counts - O(1) per camera instead of O(n)
   */
  getAllCameras() {
    const db = getDb();
    const cameras = db.prepare(`
      SELECT * FROM timelapse_cameras ORDER BY subscriber_count DESC
    `).all();

    return cameras.map(c => ({
      cameraId: c.camera_id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      isProtected: !!c.is_protected,
      isCapturing: this.activeCameras.has(c.camera_id),
      subscriberCount: c.subscriber_count,
      lastFrameAt: c.last_frame_at,
      availableFrom: c.available_from,
      availableTo: c.available_to,
      frameCount: frameIndexer.getFrameCount(c.camera_id),
      storageSize: this.getStorageSize(c.camera_id),
    }));
  }

  /**
   * Set protection status for a camera
   */
  setProtected(cameraId, isProtected) {
    const db = getDb();
    db.prepare(`
      UPDATE timelapse_cameras SET is_protected = ? WHERE camera_id = ?
    `).run(isProtected ? 1 : 0, cameraId);
  }

  /**
   * Delete a camera and all associated data (admin only)
   */
  deleteCamera(cameraId) {
    const db = getDb();

    // Stop capture if running
    this.stopCapture(cameraId);

    // Count subscriptions being deleted
    const subCount = db.prepare(`
      SELECT COUNT(*) as c FROM timelapse_subscriptions WHERE camera_id = ?
    `).get(cameraId).c;

    // Get frame count from index before deleting
    const deletedFrames = frameIndexer.getFrameCount(cameraId);

    // Delete index entries
    frameIndexer.deleteAllFrames(cameraId);

    // Delete segment index entries
    db.prepare('DELETE FROM timelapse_segments WHERE camera_id = ?').run(cameraId);

    // Delete subscriptions
    db.prepare('DELETE FROM timelapse_subscriptions WHERE camera_id = ?').run(cameraId);

    // Delete camera record
    db.prepare('DELETE FROM timelapse_cameras WHERE camera_id = ?').run(cameraId);

    // Delete frame and segment files
    const cameraDir = path.join(this.dataDir, cameraId);
    if (fs.existsSync(cameraDir)) {
      fs.rmSync(cameraDir, { recursive: true, force: true });
    }

    return {
      deletedSubscriptions: subCount,
      deletedFrames,
    };
  }

  /**
   * Resume capturing for all cameras that should be active
   * Called on server startup
   */
  resumeCaptures() {
    const db = getDb();

    // Migrate existing frames to index (one-time operation)
    frameIndexer.migrateAll();

    const cameras = db.prepare(`
      SELECT camera_id FROM timelapse_cameras
      WHERE subscriber_count > 0 OR is_protected = 1
    `).all();

    for (const { camera_id } of cameras) {
      if (!this.activeCameras.has(camera_id)) {
        this.startCapture(camera_id);
      }
    }

    if (cameras.length > 0) {
      console.log(`[Timelapse] Resumed capture for ${cameras.length} camera(s)`);

      // Pre-generate segments for all cameras in background
      // This ensures instant playlist loading after server restart
      this.pregenerateSegments(cameras.map(c => c.camera_id));
    }
  }

  /**
   * Pre-generate all missing segments for cameras (runs in background)
   */
  async pregenerateSegments(cameraIds) {
    const hls = await getHlsGenerator();

    for (const cameraId of cameraIds) {
      try {
        const result = await hls.generateStream(cameraId);
        if (result.generated > 0) {
          console.log(`[Timelapse] Pre-generated ${result.generated} segments for ${cameraId}`);
        }
      } catch (err) {
        console.error(`[Timelapse] Pre-generation error for ${cameraId}:`, err.message);
      }
    }
  }
}

// Export singleton
export const captureService = new CaptureService();
