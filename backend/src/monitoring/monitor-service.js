import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db/index.js';
import config, { getNtfyToken, getNtfyUrl, getVlmApiToken, getPublicUrl } from '../config.js';
import { frameManager } from './frame-manager.js';
import { vlmClient } from './vlm-client.js';
import { annotateImage } from './annotator.js';
import { eventLogger } from '../lib/event-logger.js';

/**
 * MonitorService - Core monitoring logic
 *
 * Handles:
 * - User subscriptions to cameras
 * - Running VLM inference on frames
 * - Matching detections to user-monitored labels
 * - Sending ntfy notifications
 * - Snooze tracking
 * - Detection history logging
 */
class MonitorService {
  constructor() {
    this.processingCameras = new Set(); // Cameras currently being processed
    this.detectionsDir = path.join(config.dataDir, 'detections');
    // Bound callback reference (same instance for register/unregister)
    this.boundOnFrame = this.onFrame.bind(this);
  }

  /**
   * Initialize the monitor service (create directories)
   */
  init() {
    fs.mkdirSync(this.detectionsDir, { recursive: true });
  }

  /**
   * Check if monitoring is available (both VLM and ntfy configured)
   * @returns {boolean}
   */
  isEnabled() {
    return !!getVlmApiToken() && !!getNtfyUrl();
  }

  /**
   * Transliterate Norwegian characters for ntfy compatibility
   * @param {string} text - Text to transliterate
   * @returns {string} - Transliterated text
   */
  transliterateNorwegian(text) {
    if (!text) return text;
    return text
      .replace(/ø/g, 'oe')
      .replace(/Ø/g, 'Oe')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'Ae')
      .replace(/å/g, 'aa')
      .replace(/Å/g, 'Aa');
  }

  /**
   * Generate a permanent ntfy hash for a user
   * @returns {string} - 8 character alphanumeric hash
   */
  generateNtfyHash() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let hash = '';
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      hash += chars[randomBytes[i] % chars.length];
    }
    return hash;
  }

  /**
   * Get or create ntfy hash for a user
   * @param {string} userId - User ID
   * @returns {string} - User's ntfy hash
   */
  getUserNtfyHash(userId) {
    const db = getDb();
    let row = db.prepare('SELECT ntfy_hash FROM users WHERE id = ?').get(userId);

    if (!row?.ntfy_hash) {
      const hash = this.generateNtfyHash();
      db.prepare('UPDATE users SET ntfy_hash = ? WHERE id = ?').run(hash, userId);
      return hash;
    }

    return row.ntfy_hash;
  }

  /**
   * Get user's ntfy channel URL
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @returns {string} - Full ntfy channel URL
   */
  getUserNtfyChannel(userId, username) {
    const hash = this.getUserNtfyHash(userId);
    const baseUrl = getNtfyUrl();
    return `${baseUrl}/${username}-${hash}`;
  }

  /**
   * Subscribe a user to monitor a camera
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @param {string[]} labels - Labels to monitor
   * @param {number} snoozeMinutes - Snooze duration (0 = all alerts)
   * @param {string} cameraName - Camera name
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Object}
   */
  async subscribe(userId, cameraId, labels = [], snoozeMinutes = 0, cameraName = null, lat = null, lon = null) {
    const db = getDb();
    const subId = crypto.randomUUID();

    // Upsert subscription
    db.prepare(`
      INSERT INTO monitor_subscriptions (id, user_id, camera_id, camera_name, lat, lon, labels, snooze_minutes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, camera_id) DO UPDATE SET
        labels = excluded.labels,
        snooze_minutes = excluded.snooze_minutes,
        camera_name = COALESCE(excluded.camera_name, monitor_subscriptions.camera_name),
        lat = COALESCE(excluded.lat, monitor_subscriptions.lat),
        lon = COALESCE(excluded.lon, monitor_subscriptions.lon),
        is_active = 1
    `).run(subId, userId, cameraId, cameraName, lat, lon, JSON.stringify(labels), snoozeMinutes);

    // Update aggregated monitor_cameras
    this.updateCameraLabels(cameraId);

    // Register with frame manager for this camera
    const consumerId = `monitor:${cameraId}`;
    frameManager.registerConsumer(cameraId, consumerId, this.boundOnFrame);

    return { subscribed: true, cameraId, labels };
  }

  /**
   * Unsubscribe a user from monitoring a camera
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @returns {Object}
   */
  async unsubscribe(userId, cameraId) {
    const db = getDb();

    db.prepare(`
      UPDATE monitor_subscriptions SET is_active = 0
      WHERE user_id = ? AND camera_id = ?
    `).run(userId, cameraId);

    // Clear detection history and images for this user/camera
    this.clearDetectionHistory(userId, cameraId);

    // Update aggregated labels
    const remaining = this.updateCameraLabels(cameraId);

    // If no more subscribers, unregister from frame manager
    if (remaining === 0) {
      const consumerId = `monitor:${cameraId}`;
      frameManager.unregisterConsumer(cameraId, consumerId, this.boundOnFrame);
    }

    return { unsubscribed: true, cameraId };
  }

  /**
   * Update a subscription's labels or snooze
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @param {string[]} labels - New labels
   * @param {number} snoozeMinutes - New snooze duration
   */
  async updateSubscription(userId, cameraId, labels, snoozeMinutes) {
    const db = getDb();

    db.prepare(`
      UPDATE monitor_subscriptions
      SET labels = ?, snooze_minutes = ?
      WHERE user_id = ? AND camera_id = ? AND is_active = 1
    `).run(JSON.stringify(labels), snoozeMinutes, userId, cameraId);

    // Update aggregated labels
    this.updateCameraLabels(cameraId);

    return { updated: true };
  }

  /**
   * Toggle pause state for a subscription
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @returns {Object} - { isPaused: boolean }
   */
  togglePause(userId, cameraId) {
    const db = getDb();

    // Get current state
    const sub = db.prepare(`
      SELECT is_paused FROM monitor_subscriptions
      WHERE user_id = ? AND camera_id = ? AND is_active = 1
    `).get(userId, cameraId);

    if (!sub) {
      throw new Error('Subscription not found');
    }

    const newPaused = sub.is_paused ? 0 : 1;
    db.prepare(`
      UPDATE monitor_subscriptions SET is_paused = ?
      WHERE user_id = ? AND camera_id = ? AND is_active = 1
    `).run(newPaused, userId, cameraId);

    return { isPaused: !!newPaused };
  }

  /**
   * Update aggregated labels for a camera
   * @param {string} cameraId - Camera ID
   * @returns {number} - Number of active subscribers
   */
  updateCameraLabels(cameraId) {
    const db = getDb();

    // Get all active subscriptions for this camera
    const subs = db.prepare(`
      SELECT labels FROM monitor_subscriptions
      WHERE camera_id = ? AND is_active = 1
    `).all(cameraId);

    // Union all labels
    const allLabels = new Set();
    for (const sub of subs) {
      const labels = JSON.parse(sub.labels || '[]');
      for (const l of labels) allLabels.add(l);
    }

    // Upsert monitor_cameras
    db.prepare(`
      INSERT INTO monitor_cameras (camera_id, labels, subscriber_count, is_capturing, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(camera_id) DO UPDATE SET
        labels = excluded.labels,
        subscriber_count = excluded.subscriber_count,
        is_capturing = excluded.is_capturing
    `).run(cameraId, JSON.stringify([...allLabels]), subs.length, subs.length > 0 ? 1 : 0);

    return subs.length;
  }

  /**
   * Get user's monitor subscriptions
   * @param {string} userId - User ID
   * @returns {Array}
   */
  getUserSubscriptions(userId) {
    const db = getDb();
    return db.prepare(`
      SELECT
        s.*,
        COALESCE(s.camera_name, c.name) as name
      FROM monitor_subscriptions s
      LEFT JOIN timelapse_cameras c ON s.camera_id = c.camera_id
      WHERE s.user_id = ? AND s.is_active = 1
      ORDER BY s.created_at DESC
    `).all(userId);
  }

  /**
   * Get camera IDs being monitored by a user (for map markers)
   * @param {string} userId - User ID
   * @returns {string[]}
   */
  getMonitoredCameraIds(userId) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT camera_id FROM monitor_subscriptions
      WHERE user_id = ? AND is_active = 1
    `).all(userId);
    return rows.map(r => r.camera_id);
  }

  /**
   * Get all camera IDs being monitored by any user (for map markers)
   * @returns {string[]}
   */
  getAllMonitoredCameraIds() {
    const db = getDb();
    const rows = db.prepare(`
      SELECT DISTINCT camera_id FROM monitor_subscriptions WHERE is_active = 1
    `).all();
    return rows.map(r => r.camera_id);
  }

  /**
   * Get detection history for a user/camera
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID (optional)
   * @param {number} page - Page number (1-based)
   * @param {number} pageSize - Items per page
   * @returns {Object} - { detections, totalCount, page, pageSize }
   */
  getDetectionHistory(userId, cameraId = null, page = 1, pageSize = 20) {
    const db = getDb();
    const offset = (page - 1) * pageSize;

    let query = `SELECT * FROM monitor_detections WHERE user_id = ?`;
    let countQuery = `SELECT COUNT(*) as c FROM monitor_detections WHERE user_id = ?`;
    const params = [userId];

    if (cameraId) {
      query += ` AND camera_id = ?`;
      countQuery += ` AND camera_id = ?`;
      params.push(cameraId);
    }

    query += ` ORDER BY detected_at DESC LIMIT ? OFFSET ?`;

    const totalCount = db.prepare(countQuery).get(...params).c;
    const detections = db.prepare(query).all(...params, pageSize, offset);

    return {
      detections: detections.map(d => ({
        ...d,
        labelsMonitored: JSON.parse(d.labels_monitored),
        labelsDetected: JSON.parse(d.labels_detected),
      })),
      totalCount,
      page,
      pageSize,
    };
  }

  /**
   * Get detection summary for a camera (total per label, last detection)
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @returns {Object} - { totalCount, lastDetection, labelCounts }
   */
  getDetectionSummary(userId, cameraId) {
    const db = getDb();

    // Get total count and last detection
    const stats = db.prepare(`
      SELECT COUNT(*) as total, MAX(detected_at) as lastDetection
      FROM monitor_detections
      WHERE user_id = ? AND camera_id = ?
    `).get(userId, cameraId);

    if (stats.total === 0) {
      return { totalCount: 0, lastDetection: null, labelCounts: {} };
    }

    // Get all detections to aggregate label counts
    const detections = db.prepare(`
      SELECT labels_detected FROM monitor_detections
      WHERE user_id = ? AND camera_id = ?
    `).all(userId, cameraId);

    const labelCounts = {};
    for (const det of detections) {
      const labels = JSON.parse(det.labels_detected || '[]');
      for (const l of labels) {
        labelCounts[l.label] = (labelCounts[l.label] || 0) + l.count;
      }
    }

    return {
      totalCount: stats.total,
      lastDetection: stats.lastDetection,
      labelCounts,
    };
  }

  /**
   * Check if user is snoozed for a camera
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @returns {boolean}
   */
  isSnoozed(userId, cameraId) {
    const db = getDb();

    // Get user's snooze setting
    const sub = db.prepare(`
      SELECT snooze_minutes FROM monitor_subscriptions
      WHERE user_id = ? AND camera_id = ? AND is_active = 1
    `).get(userId, cameraId);

    if (!sub || sub.snooze_minutes === 0) return false;

    // Get last notification time
    const snoozeState = db.prepare(`
      SELECT last_notified_at FROM monitor_snooze_state
      WHERE user_id = ? AND camera_id = ?
    `).get(userId, cameraId);

    if (!snoozeState) return false;

    const lastNotified = new Date(snoozeState.last_notified_at);
    const snoozeDuration = sub.snooze_minutes * 60 * 1000;
    const now = Date.now();

    return (now - lastNotified.getTime()) < snoozeDuration;
  }

  /**
   * Update snooze state after notification
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   */
  updateSnoozeState(userId, cameraId) {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO monitor_snooze_state (user_id, camera_id, last_notified_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, camera_id) DO UPDATE SET last_notified_at = excluded.last_notified_at
    `).run(userId, cameraId, now);
  }

  /**
   * Log a detection and optionally save annotated and raw images
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @param {string[]} labelsMonitored - Labels user was monitoring
   * @param {Array} labelsDetected - Matched labels with counts
   * @param {boolean} notified - Whether user was notified (or snoozed)
   * @param {string} annotatedPath - Path to annotated image (optional)
   * @param {string} rawPath - Path to raw image (optional)
   * @returns {string} - Detection ID
   */
  logDetection(userId, cameraId, labelsMonitored, labelsDetected, notified, annotatedPath = null, rawPath = null) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const totalDetections = labelsDetected.reduce((sum, l) => sum + l.count, 0);

    // Save annotated image if provided
    let hasImage = 0;
    if (annotatedPath && fs.existsSync(annotatedPath)) {
      const destPath = path.join(this.detectionsDir, `${id}_annotated.jpg`);
      fs.copyFileSync(annotatedPath, destPath);
      hasImage = 1;
    }

    // Save raw image if provided
    let hasRawImage = 0;
    if (rawPath && fs.existsSync(rawPath)) {
      const destPath = path.join(this.detectionsDir, `${id}_raw.jpg`);
      fs.copyFileSync(rawPath, destPath);
      hasRawImage = 1;
    }

    db.prepare(`
      INSERT INTO monitor_detections
        (id, user_id, camera_id, labels_monitored, labels_detected, total_detections, detected_at, notified, has_image, has_raw_image, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, cameraId,
      JSON.stringify(labelsMonitored),
      JSON.stringify(labelsDetected),
      totalDetections, now, notified ? 1 : 0, hasImage, hasRawImage, now
    );

    return id;
  }

  /**
   * Get path to detection image
   * @param {string} detectionId - Detection ID
   * @param {string} type - Image type: 'annotated' or 'raw'
   * @returns {string|null} - Path to image or null if not found
   */
  getDetectionImagePath(detectionId, type = 'annotated') {
    // Try new naming convention first
    const suffix = type === 'raw' ? '_raw' : '_annotated';
    const newPath = path.join(this.detectionsDir, `${detectionId}${suffix}.jpg`);
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    // Fallback to legacy naming (for annotated only)
    if (type === 'annotated') {
      const legacyPath = path.join(this.detectionsDir, `${detectionId}.jpg`);
      if (fs.existsSync(legacyPath)) {
        return legacyPath;
      }
    }

    return null;
  }

  /**
   * Clear all detection history for a user/camera and delete images
   * @param {string} userId - User ID
   * @param {string} cameraId - Camera ID
   * @returns {number} - Number of detections deleted
   */
  clearDetectionHistory(userId, cameraId) {
    const db = getDb();

    // Get all detection IDs with any images for this user/camera
    const detections = db.prepare(`
      SELECT id FROM monitor_detections
      WHERE user_id = ? AND camera_id = ? AND (has_image = 1 OR has_raw_image = 1)
    `).all(userId, cameraId);

    // Delete image files (annotated, raw, and legacy naming)
    for (const det of detections) {
      const filesToDelete = [
        path.join(this.detectionsDir, `${det.id}_annotated.jpg`),
        path.join(this.detectionsDir, `${det.id}_raw.jpg`),
        path.join(this.detectionsDir, `${det.id}.jpg`), // legacy
      ];
      for (const filePath of filesToDelete) {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }
    }

    // Delete database records
    const result = db.prepare(`
      DELETE FROM monitor_detections
      WHERE user_id = ? AND camera_id = ?
    `).run(userId, cameraId);

    return result.changes;
  }

  /**
   * Get storage usage stats for a user
   * @param {string} userId - User ID
   * @returns {Object} - { timelapseBytes, detectionBytes, detectionCount }
   */
  getUserStorageStats(userId) {
    const db = getDb();

    // Get detection image count and calculate size
    const detections = db.prepare(`
      SELECT id FROM monitor_detections
      WHERE user_id = ? AND (has_image = 1 OR has_raw_image = 1)
    `).all(userId);

    let detectionBytes = 0;
    for (const det of detections) {
      // Check all possible image files
      const filesToCheck = [
        path.join(this.detectionsDir, `${det.id}_annotated.jpg`),
        path.join(this.detectionsDir, `${det.id}_raw.jpg`),
        path.join(this.detectionsDir, `${det.id}.jpg`), // legacy
      ];
      for (const filePath of filesToCheck) {
        if (fs.existsSync(filePath)) {
          try {
            const stat = fs.statSync(filePath);
            detectionBytes += stat.size;
          } catch {}
        }
      }
    }

    return {
      detectionBytes,
      detectionCount: detections.length,
    };
  }

  /**
   * Get public URL for a detection image (generates a token-based URL)
   * @param {string} detectionId - Detection ID
   * @returns {string|null} - URL or null if image doesn't exist
   */
  getDetectionImageUrl(detectionId) {
    const imagePath = this.getDetectionImagePath(detectionId);
    if (!imagePath) return null;

    // Return a public URL (without auth) - the detection ID is unique enough
    // This is acceptable since the ID is a UUID and the image is not sensitive
    return `/api/monitoring/detections/${detectionId}/image/public`;
  }

  /**
   * Send test notification to user's ntfy channel
   * @param {string} userId - User ID
   * @param {string} username - Username
   */
  async sendTestNotification(userId, username) {
    const channel = this.getUserNtfyChannel(userId, username);
    const token = getNtfyToken();

    const headers = {
      'X-Title': 'IntelMap Test Notification',
      'X-Tags': 'white_check_mark,test',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(channel, {
      method: 'POST',
      headers,
      body: 'This is a test notification from IntelMap monitoring. If you see this, your setup is working correctly!',
    });

    if (!response.ok) {
      throw new Error(`Failed to send test notification: ${response.status}`);
    }

    return true;
  }

  /**
   * Send ntfy alert with image attachment
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string} cameraId - Camera ID
   * @param {string} cameraName - Camera name
   * @param {Array} matches - Matched labels
   * @param {string} detectionId - Detection ID (for image file)
   */
  async sendAlert(userId, username, cameraId, cameraName, matches, detectionId) {
    const channel = this.getUserNtfyChannel(userId, username);
    const token = getNtfyToken();

    // Build message with labels
    const labelSummary = matches
      .map(m => `${m.count}x ${m.label} (${Math.round(m.maxConfidence * 100)}%)`)
      .join(', ');

    const displayName = cameraName || cameraId;
    const title = `Detection: ${displayName}`;

    // Get the saved image file
    const imagePath = this.getDetectionImagePath(detectionId);

    // Use PUT with file body - this uploads the image directly to ntfy
    // which works better for self-hosted ntfy on iOS
    const headers = {
      'Title': this.transliterateNorwegian(title),
      'Message': this.transliterateNorwegian(labelSummary),
      'Tags': 'camera,warning',
      'Filename': `detection-${cameraId}.jpg`,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      let response;

      if (imagePath && fs.existsSync(imagePath)) {
        // Upload image directly to ntfy
        const imageBuffer = fs.readFileSync(imagePath);
        response = await fetch(channel, {
          method: 'PUT',
          headers,
          body: imageBuffer,
        });
      } else {
        // No image - just send text notification
        response = await fetch(channel, {
          method: 'POST',
          headers,
          body: labelSummary,
        });
      }

      if (!response.ok) {
        const errText = await response.text();
        eventLogger.notification.error(`Failed to send alert: ${response.status} - ${errText}`, { cameraId, userId });
      }
    } catch (err) {
      eventLogger.notification.error(`ntfy error: ${err.message}`, { cameraId, userId });
    }
  }

  /**
   * Frame callback - called when a new frame is captured
   * @param {string} cameraId - Camera ID
   * @param {string} framePath - Path to captured frame
   */
  async onFrame(cameraId, framePath) {
    // Prevent concurrent processing of same camera
    if (this.processingCameras.has(cameraId)) return;
    this.processingCameras.add(cameraId);

    try {
      await this.processFrame(cameraId, framePath);
    } finally {
      this.processingCameras.delete(cameraId);
    }
  }

  /**
   * Process a captured frame
   * @param {string} cameraId - Camera ID
   * @param {string} framePath - Path to frame
   */
  async processFrame(cameraId, framePath) {
    const db = getDb();

    // Get all labels being monitored for this camera
    const cameraRow = db.prepare(`
      SELECT labels FROM monitor_cameras WHERE camera_id = ?
    `).get(cameraId);

    if (!cameraRow) return;

    const allLabels = JSON.parse(cameraRow.labels || '[]');
    if (allLabels.length === 0) return;

    // Run inference via VLM
    let result;
    try {
      result = await vlmClient.infer(framePath, allLabels);
    } catch (err) {
      eventLogger.inference.error(`Inference failed for ${cameraId}: ${err.message}`);
      return;
    }

    // Always update last_check_at to show the system is checking
    const now = new Date().toISOString();
    if (result.detections.length === 0) {
      // No detections - just update last_check_at
      db.prepare(`
        UPDATE monitor_cameras SET last_check_at = ? WHERE camera_id = ?
      `).run(now, cameraId);
      return;
    }

    // Update both timestamps when there are detections
    db.prepare(`
      UPDATE monitor_cameras
      SET last_check_at = ?, last_detection_at = ?
      WHERE camera_id = ?
    `).run(now, now, cameraId);

    // Get all active subscriptions for this camera
    const subs = db.prepare(`
      SELECT
        s.*,
        u.username,
        COALESCE(s.camera_name, c.name) as camera_name
      FROM monitor_subscriptions s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN timelapse_cameras c ON s.camera_id = c.camera_id
      WHERE s.camera_id = ? AND s.is_active = 1
    `).all(cameraId);

    // Fetch raw image and generate annotated image locally
    let rawImageBuffer = null;
    let annotatedImageBuffer = null;
    let rawPath = null;
    let annotatedPath = null;

    try {
      rawImageBuffer = await vlmClient.getRawImageBuffer(result.jobId);

      // Generate annotated image locally using canvas
      annotatedImageBuffer = await annotateImage(rawImageBuffer, result.detections);

      // Save to temp files for logDetection
      rawPath = path.join(os.tmpdir(), `vlm-${result.jobId}-raw.jpg`);
      annotatedPath = path.join(os.tmpdir(), `vlm-${result.jobId}-annotated.jpg`);
      fs.writeFileSync(rawPath, rawImageBuffer);
      fs.writeFileSync(annotatedPath, annotatedImageBuffer);
    } catch (err) {
      eventLogger.inference.error(`Failed to get/annotate images: ${err.message}`, { cameraId, jobId: result.jobId });
    }

    for (const sub of subs) {
      const userLabels = JSON.parse(sub.labels || '[]');
      const matches = vlmClient.matchLabels(result.detections, userLabels);

      if (matches.length === 0) continue;

      const isPaused = !!sub.is_paused;
      const isSnoozed = this.isSnoozed(sub.user_id, cameraId);
      const shouldNotify = !isPaused && !isSnoozed;

      // Log detection and save both images - returns detection ID
      const detectionId = this.logDetection(sub.user_id, cameraId, userLabels, matches, shouldNotify, annotatedPath, rawPath);

      if (shouldNotify && annotatedPath) {
        // Send alert
        await this.sendAlert(sub.user_id, sub.username, cameraId, sub.camera_name, matches, detectionId);

        // Update snooze state
        this.updateSnoozeState(sub.user_id, cameraId);
      }
    }

    // Clean up temp images (we've saved copies to detections dir)
    for (const tempPath of [annotatedPath, rawPath]) {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }
    }
  }

  /**
   * Resume monitoring for all cameras with active subscriptions
   * Called on server startup
   */
  resumeMonitoring() {
    if (!this.isEnabled()) {
      eventLogger.monitoring.warning('Monitoring disabled (VLM or ntfy not configured)');
      return;
    }

    const db = getDb();
    const cameras = db.prepare(`
      SELECT DISTINCT camera_id FROM monitor_subscriptions WHERE is_active = 1
    `).all();

    for (const { camera_id } of cameras) {
      const consumerId = `monitor:${camera_id}`;
      frameManager.registerConsumer(camera_id, consumerId, this.boundOnFrame);
    }

    if (cameras.length > 0) {
      eventLogger.monitoring.info(`Resumed monitoring for ${cameras.length} camera(s)`);
    }
  }
}

// Export singleton
export const monitorService = new MonitorService();
