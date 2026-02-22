import { Router } from 'express';

const router = Router();

// In-memory cache keyed by rounded lat/lon
const cache = new Map();
const CACHE_TTL = 8000; // 8 seconds
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 1000; // 1 req/sec rate limit

router.get('/', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = Math.min(parseInt(req.query.radius) || 100, 250);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    // Round to 1 decimal for cache key
    const cacheKey = `${lat.toFixed(1)}_${lon.toFixed(1)}_${radius}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Rate-limit guard
    const now = Date.now();
    const elapsed = now - lastFetchTime;
    if (elapsed < MIN_FETCH_INTERVAL) {
      await new Promise((resolve) => setTimeout(resolve, MIN_FETCH_INTERVAL - elapsed));
    }
    lastFetchTime = Date.now();

    const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IntelMap/1.0' },
    });
    if (!response.ok) throw new Error(`Airplanes.live ${response.status}`);
    const data = await response.json();

    const geojson = {
      type: 'FeatureCollection',
      meta: {
        total: (data.ac || []).length,
        fetchedAt: new Date().toISOString(),
      },
      features: (data.ac || [])
        .filter((ac) => ac.lat != null && ac.lon != null)
        .map((ac) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [ac.lon, ac.lat],
          },
          properties: {
            hex: ac.hex || null,
            callsign: (ac.flight || '').trim() || null,
            registration: ac.r || null,
            type: ac.t || null,
            altBaro: ac.alt_baro ?? null,
            groundSpeed: ac.gs ?? null,
            track: ac.track ?? null,
            squawk: ac.squawk || null,
            military: !!(ac.dbFlags & 1),
            onGround: ac.alt_baro === 'ground',
            emergency: ac.emergency || null,
            category: ac.category || null,
          },
        })),
    };

    cache.set(cacheKey, { data: geojson, time: Date.now() });

    // Prune old cache entries
    for (const [key, entry] of cache) {
      if (Date.now() - entry.time > CACHE_TTL * 10) cache.delete(key);
    }

    res.json(geojson);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
