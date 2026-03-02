import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getGoogleMapsApiKey } from '../config.js';

const router = Router();
router.use(requireAuth);

// Return API key to authenticated users (for iframe src)
router.get('/key', (req, res) => {
  const key = getGoogleMapsApiKey();
  res.json({ key: key || null });
});

// Check Street View coverage at a location
router.get('/check', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const key = getGoogleMapsApiKey();
  if (!key) return res.json({ available: false });

  try {
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status === 'OK') {
      res.json({
        available: true,
        panoId: data.pano_id,
        location: data.location,
      });
    } else {
      res.json({ available: false });
    }
  } catch {
    res.json({ available: false });
  }
});

// Get static Street View image (for export)
router.get('/image', async (req, res) => {
  const { lat, lng, heading = 0, pitch = 0, fov = 90, size = '1200x800' } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const key = getGoogleMapsApiKey();
  if (!key) return res.status(503).json({ error: 'Street View not configured' });

  try {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&heading=${heading}&pitch=${pitch}&fov=${fov}&key=${key}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'Failed to fetch street view image' });
    }

    // Proxy the image with correct content type
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');

    const buffer = await resp.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Street view image fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch street view image' });
  }
});

export default router;
