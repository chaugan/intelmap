import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { monitorService } from '../monitoring/monitor-service.js';
import { getYoloApiToken, getNtfyUrl } from '../config.js';

const router = Router();
router.use(requireAuth);

// YOLO labels (80 COCO + tank)
const YOLO_LABELS = [
  'airplane', 'apple', 'backpack', 'banana', 'baseball bat', 'baseball glove',
  'bear', 'bed', 'bench', 'bicycle', 'bird', 'boat', 'book', 'bottle', 'bowl',
  'broccoli', 'bus', 'cake', 'car', 'carrot', 'cat', 'cell phone', 'chair',
  'clock', 'couch', 'cow', 'cup', 'dining table', 'dog', 'donut', 'elephant',
  'fire hydrant', 'fork', 'frisbee', 'giraffe', 'hair drier', 'handbag',
  'horse', 'hot dog', 'keyboard', 'kite', 'knife', 'laptop', 'microwave',
  'motorcycle', 'mouse', 'orange', 'oven', 'parking meter', 'person', 'pizza',
  'potted plant', 'refrigerator', 'remote', 'sandwich', 'scissors', 'sheep',
  'sink', 'skateboard', 'skis', 'snowboard', 'spoon', 'sports ball',
  'stop sign', 'suitcase', 'surfboard', 'tank', 'teddy bear', 'tennis racket',
  'tie', 'toaster', 'toilet', 'toothbrush', 'traffic light', 'train',
  'truck', 'tv', 'umbrella', 'vase', 'wine glass', 'zebra'
];

// Get monitoring config (whether enabled + user's ntfy channel)
router.get('/config', (req, res) => {
  const enabled = monitorService.isEnabled();
  let ntfyChannel = null;

  if (enabled) {
    ntfyChannel = monitorService.getUserNtfyChannel(req.user.id, req.user.username);
  }

  res.json({
    enabled,
    ntfyChannel,
    labels: YOLO_LABELS,
  });
});

// Get user's monitor subscriptions
router.get('/subscriptions', (req, res) => {
  const subs = monitorService.getUserSubscriptions(req.user.id);

  res.json(subs.map(s => ({
    id: s.id,
    cameraId: s.camera_id,
    cameraName: s.name || s.camera_id,
    lat: s.lat,
    lon: s.lon,
    labels: JSON.parse(s.labels || '[]'),
    snoozeMinutes: s.snooze_minutes,
    isPaused: !!s.is_paused,
    createdAt: s.created_at,
  })));
});

// Subscribe to monitor a camera
router.post('/subscribe', async (req, res) => {
  if (!monitorService.isEnabled()) {
    return res.status(400).json({ error: 'Monitoring is not enabled' });
  }

  const { cameraId, cameraName, lat, lon, labels, snoozeMinutes = 0 } = req.body;

  if (!cameraId) {
    return res.status(400).json({ error: 'Camera ID is required' });
  }

  if (!labels || !Array.isArray(labels) || labels.length === 0) {
    return res.status(400).json({ error: 'At least one label is required' });
  }

  // Validate labels
  const validLabels = labels.filter(l =>
    YOLO_LABELS.includes(l.toLowerCase())
  ).map(l => l.toLowerCase());

  if (validLabels.length === 0) {
    return res.status(400).json({ error: 'No valid labels provided' });
  }

  // Validate snooze
  const validSnooze = [0, 15, 60, 360, 1440];
  const snooze = validSnooze.includes(snoozeMinutes) ? snoozeMinutes : 0;

  try {
    await monitorService.subscribe(req.user.id, cameraId, validLabels, snooze, cameraName, lat, lon);
    res.json({ ok: true, cameraId, labels: validLabels, snoozeMinutes: snooze });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update monitor subscription (labels and/or snooze)
router.put('/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  const { labels, snoozeMinutes } = req.body;

  // Validate labels
  const validLabels = (labels || []).filter(l =>
    YOLO_LABELS.includes(l.toLowerCase())
  ).map(l => l.toLowerCase());

  if (validLabels.length === 0) {
    return res.status(400).json({ error: 'At least one valid label is required' });
  }

  // Validate snooze
  const validSnooze = [0, 15, 60, 360, 1440];
  const snooze = validSnooze.includes(snoozeMinutes) ? snoozeMinutes : 0;

  try {
    await monitorService.updateSubscription(req.user.id, cameraId, validLabels, snooze);
    res.json({ ok: true, labels: validLabels, snoozeMinutes: snooze });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unsubscribe from monitoring a camera
router.delete('/:cameraId', async (req, res) => {
  const { cameraId } = req.params;

  try {
    await monitorService.unsubscribe(req.user.id, cameraId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle pause state for a camera subscription
router.post('/:cameraId/pause', (req, res) => {
  const { cameraId } = req.params;

  try {
    const result = monitorService.togglePause(req.user.id, cameraId);
    res.json({ ok: true, isPaused: result.isPaused });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detection summary for a camera (total per label, last detection)
router.get('/:cameraId/summary', (req, res) => {
  const { cameraId } = req.params;
  const summary = monitorService.getDetectionSummary(req.user.id, cameraId);
  res.json(summary);
});

// Get detection history for a camera
router.get('/:cameraId/detections', (req, res) => {
  const { cameraId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);

  const result = monitorService.getDetectionHistory(req.user.id, cameraId, page, pageSize);
  res.json(result);
});

// Get all detection history for user
router.get('/detections', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);

  const result = monitorService.getDetectionHistory(req.user.id, null, page, pageSize);
  res.json(result);
});

// Get camera IDs being monitored by user (for map markers)
router.get('/cameras', (req, res) => {
  const cameraIds = monitorService.getMonitoredCameraIds(req.user.id);
  res.json({ cameraIds });
});

// Send test notification to user's ntfy channel
router.post('/test-notification', async (req, res) => {
  if (!monitorService.isEnabled()) {
    return res.status(400).json({ error: 'Monitoring is not enabled' });
  }

  try {
    await monitorService.sendTestNotification(req.user.id, req.user.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all camera IDs being monitored by anyone (for map markers)
router.get('/cameras/all', (req, res) => {
  const cameraIds = monitorService.getAllMonitoredCameraIds();
  res.json({ cameraIds });
});

// Get annotated image for a detection (authenticated)
router.get('/detections/:id/image', (req, res) => {
  const { id } = req.params;

  // Verify this detection belongs to the user
  const db = getDb();
  const detection = db.prepare('SELECT user_id FROM monitor_detections WHERE id = ?').get(id);

  if (!detection) {
    return res.status(404).json({ error: 'Detection not found' });
  }

  if (detection.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const imagePath = monitorService.getDetectionImagePath(id);
  if (!imagePath) {
    return res.status(404).json({ error: 'Image not found' });
  }

  res.sendFile(imagePath);
});

// Clear detection history for a camera
router.delete('/:cameraId/detections', (req, res) => {
  const { cameraId } = req.params;

  try {
    const deletedCount = monitorService.clearDetectionHistory(req.user.id, cameraId);
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

// Public endpoint for detection images (no auth, used for ntfy attachments)
// This needs to be registered separately in api.js since it bypasses auth
export function registerPublicRoutes(app) {
  app.get('/api/monitoring/detections/:id/image/public', (req, res) => {
    const { id } = req.params;

    const imagePath = monitorService.getDetectionImagePath(id);
    if (!imagePath) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set cache headers to prevent excessive requests
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.sendFile(imagePath);
  });
}
