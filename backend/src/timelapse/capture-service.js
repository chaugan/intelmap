import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { getDb } from '../db/index.js';

// Singleton capture service - ONE capture job per camera, shared by all subscribers
class CaptureService {
  constructor() {
    this.activeCameras = new Map(); // cameraId -> { intervalId, lastError }
    this.dataDir = path.join(config.dataDir, 'timelapse');
  }

  /**
   * Subscribe a user to a camera's timelapse
   * Starts capture if this is the first subscriber
   */
  async subscribe(userId, cameraId, cameraName = '') {
    const db = getDb();
    const subId = crypto.randomUUID();

    // Upsert subscription (reactivate if exists)
    db.prepare(`
      INSERT INTO timelapse_subscriptions (id, user_id, camera_id, is_active, created_at)
      VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, camera_id) DO UPDATE SET is_active = 1
    `).run(subId, userId, cameraId);

    // Ensure camera record exists
    db.prepare(`
      INSERT INTO timelapse_cameras (camera_id, name, created_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(camera_id) DO UPDATE SET name = COALESCE(NULLIF(name, ''), ?)
    `).run(cameraId, cameraName, cameraName);

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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    const framePath = path.join(framesDir, `${timestamp}.jpg`);

    fs.writeFileSync(framePath, buffer);

    // Update database
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE timelapse_cameras
      SET last_frame_at = ?,
          available_from = COALESCE(available_from, ?),
          available_to = ?
      WHERE camera_id = ?
    `).run(now, now, now, cameraId);

    return framePath;
  }

  /**
   * Get list of available frames for a camera within a time range
   */
  getFrames(cameraId, startTime = null, endTime = null) {
    const framesDir = path.join(this.dataDir, cameraId, 'frames');
    if (!fs.existsSync(framesDir)) return [];

    let files = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (startTime) {
      const startStr = new Date(startTime).toISOString().replace(/[:.]/g, '-');
      files = files.filter(f => f >= startStr);
    }

    if (endTime) {
      const endStr = new Date(endTime).toISOString().replace(/[:.]/g, '-');
      files = files.filter(f => f <= endStr);
    }

    return files.map(f => ({
      filename: f,
      timestamp: f.replace('.jpg', '').replace(/-/g, (m, i) => i < 10 ? '-' : i < 16 ? ':' : '.'),
      path: path.join(framesDir, f),
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
   */
  getLatestFrame(cameraId) {
    const frames = this.getFrames(cameraId);
    if (frames.length === 0) return null;
    return frames[frames.length - 1];
  }

  /**
   * Get camera status
   */
  getCameraStatus(cameraId) {
    const db = getDb();
    const camera = db.prepare(`
      SELECT * FROM timelapse_cameras WHERE camera_id = ?
    `).get(cameraId);

    const entry = this.activeCameras.get(cameraId);
    const frames = this.getFrames(cameraId);

    return {
      ...camera,
      isCapturing: !!entry,
      lastError: entry?.lastError || null,
      frameCount: frames.length,
      oldestFrame: frames[0]?.timestamp || null,
      newestFrame: frames[frames.length - 1]?.timestamp || null,
    };
  }

  /**
   * Get user's subscriptions
   */
  getUserSubscriptions(userId) {
    const db = getDb();
    return db.prepare(`
      SELECT s.*, c.name, c.is_capturing, c.last_frame_at, c.available_from, c.available_to
      FROM timelapse_subscriptions s
      JOIN timelapse_cameras c ON s.camera_id = c.camera_id
      WHERE s.user_id = ? AND s.is_active = 1
      ORDER BY s.created_at DESC
    `).all(userId);
  }

  /**
   * Get all cameras (for admin)
   */
  getAllCameras() {
    const db = getDb();
    const cameras = db.prepare(`
      SELECT * FROM timelapse_cameras ORDER BY subscriber_count DESC
    `).all();

    return cameras.map(c => ({
      cameraId: c.camera_id,
      name: c.name,
      isProtected: !!c.is_protected,
      isCapturing: this.activeCameras.has(c.camera_id),
      subscriberCount: c.subscriber_count,
      lastFrameAt: c.last_frame_at,
      availableFrom: c.available_from,
      availableTo: c.available_to,
      frameCount: this.getFrames(c.camera_id).length,
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

    // Delete subscriptions
    db.prepare('DELETE FROM timelapse_subscriptions WHERE camera_id = ?').run(cameraId);

    // Delete camera record
    db.prepare('DELETE FROM timelapse_cameras WHERE camera_id = ?').run(cameraId);

    // Delete frame files
    const cameraDir = path.join(this.dataDir, cameraId);
    let deletedFrames = 0;
    if (fs.existsSync(cameraDir)) {
      const framesDir = path.join(cameraDir, 'frames');
      if (fs.existsSync(framesDir)) {
        deletedFrames = fs.readdirSync(framesDir).length;
      }
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
    }
  }
}

// Export singleton
export const captureService = new CaptureService();
