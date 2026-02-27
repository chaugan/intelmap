import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { captureService } from '../timelapse/capture-service.js';
import { hlsGenerator } from '../timelapse/hls-generator.js';
import { createExportJob, getExportStatus, getUserExports, deleteExport, getExportFilePath } from '../timelapse/export-worker.js';
import config from '../config.js';

const router = Router();

// Middleware to check if user has timelapse access
function requireTimelapseAccess(req, res, next) {
  if (!req.user?.timelapse_enabled && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Timelapse access not enabled' });
  }
  next();
}

// --- User endpoints ---

// Get user's subscribed cameras
router.get('/cameras', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const subs = captureService.getUserSubscriptions(req.user.id);
    res.json(subs.map(s => ({
      cameraId: s.camera_id,
      name: s.name,
      isCapturing: !!s.is_capturing,
      lastFrameAt: s.last_frame_at,
      availableFrom: s.available_from,
      availableTo: s.available_to,
      subscribedAt: s.created_at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to a camera
router.post('/subscribe/:cameraId', requireAuth, requireTimelapseAccess, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { name } = req.body;
    const result = await captureService.subscribe(req.user.id, cameraId, name || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unsubscribe from a camera
router.delete('/subscribe/:cameraId', requireAuth, requireTimelapseAccess, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const result = await captureService.unsubscribe(req.user.id, cameraId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get camera status
router.get('/status/:cameraId', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId } = req.params;
    const status = captureService.getCameraStatus(cameraId);
    if (!status) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- HLS Streaming ---

// Get HLS playlist
router.get('/stream/:cameraId/playlist.m3u8', requireAuth, requireTimelapseAccess, async (req, res) => {
  try {
    const { cameraId } = req.params;

    // Check if user is subscribed or admin
    const db = getDb();
    const sub = db.prepare(`
      SELECT id FROM timelapse_subscriptions
      WHERE user_id = ? AND camera_id = ? AND is_active = 1
    `).get(req.user.id, cameraId);

    if (!sub && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not subscribed to this camera' });
    }

    const playlist = await hlsGenerator.getPlaylist(cameraId);
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get HLS segment
router.get('/stream/:cameraId/segments/:segmentName', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId, segmentName } = req.params;

    // Validate segment name to prevent path traversal
    if (!segmentName.match(/^segment_\d{4}\.ts$/) && !segmentName.match(/^playlist\.m3u8$/)) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    const segmentPath = hlsGenerator.getSegmentPath(cameraId, segmentName);
    if (!segmentPath) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.set('Content-Type', 'video/mp2t');
    res.sendFile(segmentPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Frame access ---

// Get list of available frames
router.get('/frames/:cameraId', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId } = req.params;
    const { start, end, limit = 100 } = req.query;

    let frames = captureService.getFrames(cameraId, start, end);

    // Limit response size
    if (frames.length > limit) {
      // Sample frames evenly
      const step = Math.ceil(frames.length / limit);
      frames = frames.filter((_, i) => i % step === 0);
    }

    res.json(frames.map(f => ({
      timestamp: f.timestamp,
      filename: f.filename,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific frame (for download/save)
router.get('/frame/:cameraId/:timestamp.jpg', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId, timestamp } = req.params;

    const framePath = captureService.getFramePath(cameraId, timestamp);
    if (!framePath) {
      return res.status(404).json({ error: 'Frame not found' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Disposition', `attachment; filename="${cameraId}_${timestamp}.jpg"`);
    res.sendFile(framePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get latest frame
router.get('/frame/:cameraId/latest.jpg', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId } = req.params;

    const frame = captureService.getLatestFrame(cameraId);
    if (!frame) {
      return res.status(404).json({ error: 'No frames available' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(frame.path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Exports ---

// Create export job
router.post('/exports', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const { cameraId, startTime, endTime } = req.body;

    if (!cameraId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = createExportJob(req.user.id, cameraId, startTime, endTime);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user's exports
router.get('/exports', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const exports = getUserExports(req.user.id);
    res.json(exports.map(e => ({
      id: e.id,
      cameraId: e.camera_id,
      startTime: e.start_time,
      endTime: e.end_time,
      status: e.status,
      progress: e.progress,
      fileSize: e.file_size,
      errorMessage: e.error_message,
      createdAt: e.created_at,
      completedAt: e.completed_at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get export status
router.get('/exports/:id', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const exp = getExportStatus(req.params.id);
    if (!exp || exp.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Export not found' });
    }
    res.json({
      id: exp.id,
      cameraId: exp.camera_id,
      startTime: exp.start_time,
      endTime: exp.end_time,
      status: exp.status,
      progress: exp.progress,
      fileSize: exp.file_size,
      errorMessage: exp.error_message,
      createdAt: exp.created_at,
      completedAt: exp.completed_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download export
router.get('/exports/:id/download', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const filePath = getExportFilePath(req.params.id, req.user.id);
    if (!filePath) {
      return res.status(404).json({ error: 'Export not found or not ready' });
    }

    const exp = getExportStatus(req.params.id);
    const filename = `timelapse_${exp.camera_id}_${exp.start_time.slice(0,10)}_${exp.end_time.slice(0,10)}.mp4`;

    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete export
router.delete('/exports/:id', requireAuth, requireTimelapseAccess, (req, res) => {
  try {
    const success = deleteExport(req.params.id, req.user.id);
    if (!success) {
      return res.status(404).json({ error: 'Export not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin endpoints ---

// Get all cameras (admin)
router.get('/admin/cameras', requireAdmin, (req, res) => {
  try {
    const cameras = captureService.getAllCameras();
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle protection status (admin)
router.post('/admin/cameras/:cameraId/protect', requireAdmin, (req, res) => {
  try {
    const { cameraId } = req.params;
    const { isProtected } = req.body;

    captureService.setProtected(cameraId, isProtected);
    res.json({ ok: true, isProtected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle timelapse access for user (admin)
router.post('/users/:id/toggle-timelapse', requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, timelapse_enabled FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.timelapse_enabled ? 0 : 1;
  db.prepare("UPDATE users SET timelapse_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, timelapseEnabled: !!newVal });
});

export default router;
