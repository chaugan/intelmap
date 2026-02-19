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

export default router;
