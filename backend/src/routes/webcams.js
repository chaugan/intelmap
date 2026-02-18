import { Router } from 'express';

const router = Router();
let cachedCameras = null;
let cacheTime = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

router.get('/', async (_req, res) => {
  try {
    if (cachedCameras && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedCameras);
    }

    const url = 'https://ogckart-sn1.atlas.vegvesen.no/wfs?service=wfs&version=2.0.0&request=GetFeature&typeName=datex_3_1:CctvSimple_v2&outputFormat=application/json';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`WFS ${response.status}`);
    const geojson = await response.json();

    // Filter for Norway (lat 57.5-71.5, lon 4-32)
    const filtered = {
      type: 'FeatureCollection',
      features: (geojson.features || []).filter((f) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return false;
        const [lon, lat] = coords;
        return lat >= 57.5 && lat <= 71.5 && lon >= 4 && lon <= 32;
      }).map((f) => {
        const props = f.properties || {};
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: props.CAMERA_ID || props.RECORD_ID || f.id,
            name: props.DESCRIPTION || props.cctvCameraName || 'Camera',
            direction: props.ORIENTATION_DESCRIPTION || null,
            road: props.ROAD_NUMBER || null,
            imageUrl: props.STILL_IMAGE_URL || null,
            lastUpdate: props.LAST_UPDATE_TIME || null,
            publicationTime: props.PUBLICATION_TIME || null,
          },
        };
      }),
    };

    cachedCameras = filtered;
    cacheTime = Date.now();
    res.json(filtered);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Image proxy - cameraId uses underscores e.g. "1229032_1"
router.get('/image/:cameraId', async (req, res) => {
  try {
    const cameraId = req.params.cameraId;
    const imageUrl = `https://kamera.atlas.vegvesen.no/api/images/${cameraId}`;
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'IntelMap/1.0' },
    });
    if (!response.ok) throw new Error(`Image fetch ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const lastModified = response.headers.get('last-modified');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=60');
    if (lastModified) res.set('Last-Modified', lastModified);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
