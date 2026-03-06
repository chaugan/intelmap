import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { getStabilityApiKey } from '../config.js';
import config from '../config.js';

const router = Router();
router.use(requireAuth);

// POST /api/upscale — Upscale an image via Stability AI Fast Upscale
router.post('/', async (req, res) => {
  const { sourceType, sourceKey } = req.body;

  if (!sourceType || !sourceKey) {
    return res.status(400).json({ error: 'sourceType and sourceKey are required' });
  }
  if (sourceType !== 'timelapse' && sourceType !== 'detection') {
    return res.status(400).json({ error: 'sourceType must be timelapse or detection' });
  }

  const db = getDb();

  // 1. Check user has upscale_enabled
  const user = db.prepare('SELECT upscale_enabled FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.upscale_enabled) {
    return res.status(403).json({ error: 'Upscale not enabled for this user' });
  }

  // 2. Check if already upscaled
  const existing = db.prepare('SELECT id, created_at FROM upscaled_images WHERE source_type = ? AND source_key = ?').get(sourceType, sourceKey);
  if (existing) {
    return res.status(409).json({ error: 'Already upscaled', id: existing.id, upscaledAt: existing.created_at });
  }

  // 3. Resolve original file path
  let originalPath;
  if (sourceType === 'timelapse') {
    // sourceKey = "cameraId/timestamp"
    const parts = sourceKey.split('/');
    if (parts.length < 2) {
      return res.status(400).json({ error: 'Invalid sourceKey for timelapse (expected cameraId/timestamp)' });
    }
    const cameraId = parts[0];
    const timestamp = parts.slice(1).join('/');
    // Convert ISO timestamp to filename format (colons/dots -> dashes)
    const filename = timestamp.replace(/[:.]/g, '-');
    originalPath = path.join(config.dataDir, 'timelapse', cameraId, 'frames', `${filename}.jpg`);
  } else {
    // detection: sourceKey = detection UUID
    const rawPath = path.join(config.dataDir, 'detections', `${sourceKey}_raw.jpg`);
    const annotatedPath = path.join(config.dataDir, 'detections', `${sourceKey}_annotated.jpg`);
    if (fs.existsSync(rawPath)) {
      originalPath = rawPath;
    } else if (fs.existsSync(annotatedPath)) {
      originalPath = annotatedPath;
    } else {
      return res.status(404).json({ error: 'Original image not found' });
    }
  }

  // 4. Verify file exists
  if (!fs.existsSync(originalPath)) {
    return res.status(404).json({ error: 'Original image not found' });
  }

  // 5. Get API key
  const apiKey = getStabilityApiKey(req.user.orgId);
  if (!apiKey) {
    return res.status(503).json({ error: 'Stability API key not configured' });
  }

  // 6. Call Stability API
  try {
    const imageBuffer = fs.readFileSync(originalPath);
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });

    const formData = new FormData();
    formData.append('image', blob, 'image.jpg');
    formData.append('output_format', 'jpeg');

    const response = await fetch('https://api.stability.ai/v2beta/stable-image/upscale/fast', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Stability API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.message || errorJson.name || errorMsg;
      } catch {}
      if (response.status === 422) {
        errorMsg = 'Image too large for upscaling (max 1 megapixel)';
      }
      return res.status(response.status === 422 ? 422 : 502).json({ error: errorMsg });
    }

    const upscaledBuffer = Buffer.from(await response.arrayBuffer());

    // 7. Save upscaled image
    const id = crypto.randomUUID();
    const upscaledDir = path.join(config.dataDir, 'upscaled');
    if (!fs.existsSync(upscaledDir)) {
      fs.mkdirSync(upscaledDir, { recursive: true });
    }
    const upscaledPath = path.join(upscaledDir, `${id}.jpg`);
    fs.writeFileSync(upscaledPath, upscaledBuffer);

    // 8. Insert into DB
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO upscaled_images (id, user_id, org_id, source_type, source_key, upscaled_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.user.id, req.user.orgId || null, sourceType, sourceKey, upscaledPath, now);

    // 9. Return success
    res.json({ ok: true, id, upscaledAt: now });
  } catch (err) {
    console.error('Upscale error:', err.message);
    res.status(500).json({ error: 'Upscale failed: ' + err.message });
  }
});

// GET /api/upscale/status — Check if an image has been upscaled
router.get('/status', (req, res) => {
  const { sourceType, sourceKey } = req.query;
  if (!sourceType || !sourceKey) {
    return res.status(400).json({ error: 'sourceType and sourceKey query params required' });
  }

  const db = getDb();
  const row = db.prepare('SELECT id, created_at FROM upscaled_images WHERE source_type = ? AND source_key = ?').get(sourceType, sourceKey);

  if (row) {
    res.json({ upscaled: true, id: row.id, upscaledAt: row.created_at });
  } else {
    res.json({ upscaled: false });
  }
});

// GET /api/upscale/image/:id — Serve upscaled image
router.get('/image/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM upscaled_images WHERE id = ?').get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'Upscaled image not found' });
  }

  // Verify user owns it or is in same org
  if (row.user_id !== req.user.id && row.org_id !== req.user.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(row.upscaled_path)) {
    return res.status(404).json({ error: 'Upscaled image file not found' });
  }

  if (req.query.download === '1') {
    const filename = `upscaled_${row.source_type}_${row.id.slice(0, 8)}.jpg`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(path.resolve(row.upscaled_path));
});

export default router;
