import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { getDb } from '../db/index.js';

const DATA_DIR = path.join(config.dataDir, 'timelapse');
const RETENTION_DAYS = 7;

/**
 * Purge old timelapse frames (7-day rolling window)
 * Skips protected cameras
 */
export function purgeOldFrames() {
  const db = getDb();

  // Get non-protected cameras
  const cameras = db.prepare(`
    SELECT camera_id FROM timelapse_cameras WHERE is_protected = 0
  `).all();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().replace(/[:.]/g, '-');

  let totalDeleted = 0;

  for (const { camera_id } of cameras) {
    const framesDir = path.join(DATA_DIR, camera_id, 'frames');
    if (!fs.existsSync(framesDir)) continue;

    const frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg') && f < cutoffStr);

    for (const frame of frames) {
      try {
        fs.unlinkSync(path.join(framesDir, frame));
        totalDeleted++;
      } catch (err) {
        console.error(`[Timelapse] Failed to delete frame ${frame}:`, err.message);
      }
    }

    // Update available_from timestamp
    const remaining = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
    if (remaining.length > 0) {
      const oldest = remaining[0].replace('.jpg', '').replace(/-/g, (m, i) => i < 10 ? '-' : i < 16 ? ':' : '.');
      db.prepare(`
        UPDATE timelapse_cameras SET available_from = ? WHERE camera_id = ?
      `).run(oldest, camera_id);
    }
  }

  if (totalDeleted > 0) {
    console.log(`[Timelapse] Purged ${totalDeleted} old frames`);
  }

  return totalDeleted;
}

/**
 * Purge old export files (keep for 24 hours after creation)
 */
export function purgeOldExports() {
  const db = getDb();
  const exportsDir = path.join(DATA_DIR, 'exports');

  if (!fs.existsSync(exportsDir)) return 0;

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);
  const cutoffStr = cutoff.toISOString();

  // Get old completed exports
  const oldExports = db.prepare(`
    SELECT id, file_path FROM timelapse_exports
    WHERE status = 'completed' AND completed_at < ?
  `).all(cutoffStr);

  let deleted = 0;
  for (const { id, file_path } of oldExports) {
    if (file_path && fs.existsSync(file_path)) {
      try {
        fs.unlinkSync(file_path);
        deleted++;
      } catch {}
    }
    // Mark as expired
    db.prepare(`UPDATE timelapse_exports SET status = 'expired' WHERE id = ?`).run(id);
  }

  if (deleted > 0) {
    console.log(`[Timelapse] Purged ${deleted} old exports`);
  }

  return deleted;
}

/**
 * Clean up empty camera directories
 */
export function cleanupEmptyDirectories() {
  if (!fs.existsSync(DATA_DIR)) return;

  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'exports') continue;

    const cameraDir = path.join(DATA_DIR, entry.name);
    const framesDir = path.join(cameraDir, 'frames');

    // Check if frames directory exists and is empty
    if (fs.existsSync(framesDir)) {
      const frames = fs.readdirSync(framesDir);
      if (frames.length === 0) {
        // Remove empty camera directory
        try {
          fs.rmSync(cameraDir, { recursive: true, force: true });
          console.log(`[Timelapse] Cleaned up empty directory: ${entry.name}`);
        } catch {}
      }
    }
  }
}

/**
 * Run all purge operations
 */
export function runPurge() {
  purgeOldFrames();
  purgeOldExports();
  cleanupEmptyDirectories();
}

/**
 * Start periodic purge (run every hour)
 */
let purgeInterval = null;

export function startPurgeScheduler() {
  if (purgeInterval) return;

  // Run immediately
  runPurge();

  // Then every hour
  purgeInterval = setInterval(runPurge, 60 * 60 * 1000);
  console.log('[Timelapse] Started purge scheduler (hourly)');
}

export function stopPurgeScheduler() {
  if (purgeInterval) {
    clearInterval(purgeInterval);
    purgeInterval = null;
  }
}
