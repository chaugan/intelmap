import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { eventLogger } from '../lib/event-logger.js';

/**
 * FrameManager - Shared frame infrastructure for timelapse and monitoring
 *
 * This service coordinates frame capture across both timelapse and monitoring consumers.
 * When either system needs frames from a camera, it registers as a consumer.
 * Frames are captured every 60 seconds and shared by all consumers.
 */
class FrameManager {
  constructor() {
    this.frameDir = path.join(config.dataDir, 'frames');
    this.activeCaptures = new Map(); // cameraId -> { intervalId, consumers: Set, lastFrame, lastError }
    this.frameCallbacks = new Map(); // cameraId -> Set of callback functions
  }

  /**
   * Initialize the frame manager
   */
  init() {
    // Ensure frame directory exists
    fs.mkdirSync(this.frameDir, { recursive: true });
    console.log('[FrameManager] Initialized');
  }

  /**
   * Register a consumer for a camera's frames
   * @param {string} cameraId - Camera ID
   * @param {string} consumerId - Unique consumer ID (e.g., 'timelapse', 'monitor:user123')
   * @param {Function} onFrame - Optional callback when new frame is captured
   * @returns {boolean} - Whether this was the first consumer (capture just started)
   */
  registerConsumer(cameraId, consumerId, onFrame = null) {
    let entry = this.activeCaptures.get(cameraId);
    const isFirst = !entry;

    if (isFirst) {
      entry = {
        intervalId: null,
        consumers: new Set(),
        lastFrame: null,
        lastError: null,
      };
      this.activeCaptures.set(cameraId, entry);
      this.frameCallbacks.set(cameraId, new Set());
      this.startCapture(cameraId);
    }

    entry.consumers.add(consumerId);

    if (onFrame) {
      this.frameCallbacks.get(cameraId).add(onFrame);
    }

    console.log(`[FrameManager] Consumer "${consumerId}" registered for camera ${cameraId} (total: ${entry.consumers.size})`);
    return isFirst;
  }

  /**
   * Unregister a consumer from a camera's frames
   * @param {string} cameraId - Camera ID
   * @param {string} consumerId - Unique consumer ID
   * @param {Function} onFrame - Optional callback to remove
   * @returns {boolean} - Whether this was the last consumer (capture stopped)
   */
  unregisterConsumer(cameraId, consumerId, onFrame = null) {
    const entry = this.activeCaptures.get(cameraId);
    if (!entry) return false;

    entry.consumers.delete(consumerId);

    if (onFrame) {
      const callbacks = this.frameCallbacks.get(cameraId);
      if (callbacks) callbacks.delete(onFrame);
    }

    console.log(`[FrameManager] Consumer "${consumerId}" unregistered from camera ${cameraId} (remaining: ${entry.consumers.size})`);

    if (entry.consumers.size === 0) {
      this.stopCapture(cameraId);
      return true;
    }

    return false;
  }

  /**
   * Start capturing frames for a camera
   * @param {string} cameraId - Camera ID
   */
  startCapture(cameraId) {
    const entry = this.activeCaptures.get(cameraId);
    if (!entry || entry.intervalId) return;

    // Create camera frame directory
    const cameraDir = path.join(this.frameDir, cameraId);
    fs.mkdirSync(cameraDir, { recursive: true });

    // Capture function
    const captureFrame = async () => {
      try {
        const framePath = await this.captureFrame(cameraId);
        entry.lastFrame = framePath;
        entry.lastError = null;

        // Notify all callbacks
        const callbacks = this.frameCallbacks.get(cameraId);
        if (callbacks) {
          for (const cb of callbacks) {
            try {
              await cb(cameraId, framePath);
            } catch (err) {
              eventLogger.monitoring.error(`Frame callback error for ${cameraId}: ${err.message}`);
            }
          }
        }
      } catch (err) {
        eventLogger.timelapse.error(`Frame capture error for ${cameraId}: ${err.message}`);
        entry.lastError = err.message;
      }
    };

    // Capture immediately, then every 60 seconds
    captureFrame();
    entry.intervalId = setInterval(captureFrame, 60 * 1000);

    console.log(`[FrameManager] Started capture for camera ${cameraId}`);
  }

  /**
   * Stop capturing frames for a camera
   * @param {string} cameraId - Camera ID
   */
  stopCapture(cameraId) {
    const entry = this.activeCaptures.get(cameraId);
    if (!entry) return;

    if (entry.intervalId) {
      clearInterval(entry.intervalId);
    }

    this.activeCaptures.delete(cameraId);
    this.frameCallbacks.delete(cameraId);

    console.log(`[FrameManager] Stopped capture for camera ${cameraId}`);
  }

  /**
   * Capture a single frame from a webcam
   * @param {string} cameraId - Camera ID
   * @returns {string} - Path to captured frame
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
    const cameraDir = path.join(this.frameDir, cameraId);
    const framePath = path.join(cameraDir, `${timestamp}.jpg`);

    fs.writeFileSync(framePath, buffer);

    return framePath;
  }

  /**
   * Get latest frame for a camera
   * @param {string} cameraId - Camera ID
   * @returns {string|null} - Path to latest frame or null
   */
  getLatestFrame(cameraId) {
    const entry = this.activeCaptures.get(cameraId);
    if (entry?.lastFrame && fs.existsSync(entry.lastFrame)) {
      return entry.lastFrame;
    }

    // Fall back to scanning directory
    const cameraDir = path.join(this.frameDir, cameraId);
    if (!fs.existsSync(cameraDir)) return null;

    const files = fs.readdirSync(cameraDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (files.length === 0) return null;
    return path.join(cameraDir, files[files.length - 1]);
  }

  /**
   * Get all frames for a camera within a time range
   * @param {string} cameraId - Camera ID
   * @param {string} startTime - ISO timestamp
   * @param {string} endTime - ISO timestamp
   * @returns {Array} - Array of { filename, timestamp, path }
   */
  getFrames(cameraId, startTime = null, endTime = null) {
    const cameraDir = path.join(this.frameDir, cameraId);
    if (!fs.existsSync(cameraDir)) return [];

    let files = fs.readdirSync(cameraDir)
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
      timestamp: f.replace('.jpg', '').replace(/-/g, (m, i) => i < 10 ? '-' : i < 19 ? ':' : '.'),
      path: path.join(cameraDir, f),
    }));
  }

  /**
   * Check if a camera is actively being captured
   * @param {string} cameraId - Camera ID
   * @returns {boolean}
   */
  isCapturing(cameraId) {
    return this.activeCaptures.has(cameraId);
  }

  /**
   * Get camera capture status
   * @param {string} cameraId - Camera ID
   * @returns {Object}
   */
  getCameraStatus(cameraId) {
    const entry = this.activeCaptures.get(cameraId);
    return {
      isCapturing: !!entry,
      consumerCount: entry?.consumers.size || 0,
      consumers: entry ? Array.from(entry.consumers) : [],
      lastFrame: entry?.lastFrame || null,
      lastError: entry?.lastError || null,
    };
  }

  /**
   * Clean up old frames (called by purge scheduler)
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {number} - Number of frames deleted
   */
  cleanupOldFrames(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    let deletedCount = 0;

    if (!fs.existsSync(this.frameDir)) return 0;

    const cameraDirs = fs.readdirSync(this.frameDir);
    for (const cameraId of cameraDirs) {
      const cameraDir = path.join(this.frameDir, cameraId);
      if (!fs.statSync(cameraDir).isDirectory()) continue;

      const files = fs.readdirSync(cameraDir).filter(f => f.endsWith('.jpg'));
      for (const file of files) {
        const filePath = path.join(cameraDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {}
      }

      // Remove empty camera directories
      const remaining = fs.readdirSync(cameraDir);
      if (remaining.length === 0) {
        fs.rmdirSync(cameraDir);
      }
    }

    if (deletedCount > 0) {
      console.log(`[FrameManager] Cleaned up ${deletedCount} old frames`);
    }

    return deletedCount;
  }
}

// Export singleton
export const frameManager = new FrameManager();
