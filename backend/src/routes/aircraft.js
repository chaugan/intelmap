import { Router } from 'express';

const router = Router();

// Single shared cache entry — one active query at a time is enough
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 15000; // 15 seconds
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 3000; // 3 seconds between upstream requests
let backoffUntil = 0; // timestamp until we stop retrying after 429

router.get('/', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = Math.min(Math.max(parseInt(req.query.radius) || 100, 1), 250);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    // Serve from cache if fresh enough
    if (cachedData && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedData);
    }

    // If we're in backoff from a 429, serve stale cache or empty
    if (Date.now() < backoffUntil) {
      if (cachedData) return res.json(cachedData);
      return res.json({ type: 'FeatureCollection', meta: { total: 0, fetchedAt: new Date().toISOString() }, features: [] });
    }

    // Rate-limit guard — wait if needed
    const now = Date.now();
    const elapsed = now - lastFetchTime;
    if (elapsed < MIN_FETCH_INTERVAL) {
      // Serve stale cache instead of waiting
      if (cachedData) return res.json(cachedData);
      await new Promise((resolve) => setTimeout(resolve, MIN_FETCH_INTERVAL - elapsed));
    }
    lastFetchTime = Date.now();

    const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IntelMap/1.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 429) {
      // Back off for 30 seconds
      backoffUntil = Date.now() + 30000;
      console.warn('Aircraft API: 429 rate limited, backing off 30s');
      if (cachedData) return res.json(cachedData);
      return res.json({ type: 'FeatureCollection', meta: { total: 0, fetchedAt: new Date().toISOString() }, features: [] });
    }

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
        .map((ac) => {
          const dbFlags = typeof ac.dbFlags === 'number' ? ac.dbFlags : 0;
          return {
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
              military: !!(dbFlags & 1),
              helicopter: ac.category === 'A7',
              onGround: ac.alt_baro === 'ground',
              emergency: ac.emergency || null,
              category: ac.category || null,
            },
          };
        }),
    };

    cachedData = geojson;
    cacheTime = Date.now();

    res.json(geojson);
  } catch (err) {
    console.error('Aircraft API error:', err.message);
    // Serve stale cache on error instead of 502
    if (cachedData) return res.json(cachedData);
    res.status(502).json({ error: err.message });
  }
});

export default router;
