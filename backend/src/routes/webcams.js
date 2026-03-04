import { Router } from 'express';

const router = Router();

// Norway-wide cache
let webcamCache = null;
let cacheTimestamp = null;
let cacheLoading = false;

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const WFS_URL = 'https://ogckart-sn1.atlas.vegvesen.no/wfs?service=wfs&version=2.0.0&request=GetFeature&typeName=datex_3_1:CctvSimple_v2&outputFormat=application/json';

// Fetch all Norway webcams and cache them
async function warmCache() {
  if (cacheLoading) return;
  cacheLoading = true;

  console.log('[Webcams] Warming cache - fetching all webcams...');
  const startTime = Date.now();

  try {
    const response = await fetch(WFS_URL);
    if (!response.ok) throw new Error(`WFS ${response.status}`);
    const geojson = await response.json();

    // Filter for Norway (lat 57.5-71.5, lon 4-32) and transform
    const features = (geojson.features || [])
      .filter((f) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return false;
        const [lon, lat] = coords;
        return lat >= 57.5 && lat <= 71.5 && lon >= 4 && lon <= 32;
      })
      .map((f) => {
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
      });

    webcamCache = {
      type: 'FeatureCollection',
      features,
    };
    cacheTimestamp = Date.now();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Webcams] Cache warm! ${features.length} cameras in ${elapsed}s`);
  } catch (err) {
    console.error('[Webcams] Failed to warm cache:', err);
  } finally {
    cacheLoading = false;
  }
}

// Check if cache needs refresh
function shouldRefreshCache() {
  if (!webcamCache || !cacheTimestamp) return true;
  return Date.now() - cacheTimestamp > CACHE_TTL;
}

// Start background cache warming on module load
warmCache();

// Schedule refresh every 6 hours
setInterval(() => {
  if (shouldRefreshCache()) {
    warmCache();
  }
}, CACHE_TTL);

router.get('/', async (_req, res) => {
  // If cache not ready, return empty with loading flag
  if (!webcamCache) {
    return res.json({
      type: 'FeatureCollection',
      features: [],
      meta: { loading: true },
    });
  }

  res.json({
    ...webcamCache,
    meta: {
      total: webcamCache.features.length,
      cachedAt: cacheTimestamp,
    },
  });
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
