import { Router } from 'express';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const router = Router();

// --- Live train positions ---
let cachedData = null;
let cacheTime = 0;
let lastFetchTime = 0;
const CACHE_TTL = 10000; // 10 seconds
const MIN_FETCH_INTERVAL = 5000;

// --- Trip updates (delay data) ---
let delayMap = new Map();
let delayFetchTime = 0;
const DELAY_CACHE_TTL = 10000;

// --- Station cache ---
let stationCache = null;
let stationCacheTime = 0;
const STATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// --- Track cache ---
let trackCache = null;
let trackCacheTime = 0;
const TRACK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const ENTUR_HEADERS = {
  'ET-Client-Name': 'coremap26-intelmap',
};

// Norwegian train operator route ID prefixes
// VYG = Vy Tog, FLT = Flytoget, SJN = SJ Nord, GOA = Go-Ahead Nordic, SJA = SJ (additional)
const TRAIN_OPERATORS = ['VYG', 'FLT', 'SJN', 'GOA', 'SJA'];

// --- Bearing computation from track geometry ---

function computeBearing(from, to) {
  const toRad = Math.PI / 180;
  const lat1 = from[1] * toRad;
  const lat2 = to[1] * toRad;
  const dLon = (to[0] - from[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function distSq(px, py, ax, ay) {
  const dx = (ax - px) * Math.cos(((py + ay) / 2) * Math.PI / 180);
  const dy = ay - py;
  return dx * dx + dy * dy;
}

function pointToSegmentDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distSq(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distSq(px, py, ax + t * dx, ay + t * dy);
}

/**
 * Find the nearest track segment to a point and return its bearing.
 * Uses a bounding box filter (~500m) for performance.
 */
function getBearingFromTracks(lon, lat) {
  if (!trackCache || !trackCache.features) return null;

  const SEARCH_RADIUS = 0.05; // ~5km in degrees
  let minDist = Infinity;
  let bestFrom = null;
  let bestTo = null;

  for (const feature of trackCache.features) {
    const coords = feature.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const [aLon, aLat] = coords[i];
      const [bLon, bLat] = coords[i + 1];

      // Quick proximity check: at least one endpoint must be within search radius
      const d1 = Math.abs(aLon - lon) + Math.abs(aLat - lat);
      const d2 = Math.abs(bLon - lon) + Math.abs(bLat - lat);
      if (d1 > SEARCH_RADIUS * 2 && d2 > SEARCH_RADIUS * 2) continue;

      const d = pointToSegmentDistSq(lon, lat, aLon, aLat, bLon, bLat);
      if (d < minDist) {
        minDist = d;
        bestFrom = coords[i];
        bestTo = coords[i + 1];
      }
    }
  }

  if (!bestFrom) return null;
  return Math.round(computeBearing(bestFrom, bestTo));
}

// Store previous positions for bearing-from-movement computation
const prevPositions = new Map();

/**
 * Get bearing for a train. Priority:
 * 1. GTFS-RT bearing (if non-zero)
 * 2. Bearing from movement (if train moved since last update)
 * 3. Bearing from nearest track segment
 * 4. Previous known bearing
 */
function getTrainBearing(id, lon, lat, gtfsBearing) {
  // If GTFS-RT provides a real bearing, use it
  if (gtfsBearing != null && gtfsBearing !== 0) {
    prevPositions.set(id, { lon, lat, bearing: gtfsBearing });
    return gtfsBearing;
  }

  const prev = prevPositions.get(id);

  // Try bearing from movement
  if (prev) {
    const dLon = lon - prev.lon;
    const dLat = lat - prev.lat;
    // Only compute if moved at least ~50m
    if (Math.abs(dLon) > 0.0005 || Math.abs(dLat) > 0.0005) {
      const moveBearing = Math.round(computeBearing([prev.lon, prev.lat], [lon, lat]));
      prevPositions.set(id, { lon, lat, bearing: moveBearing });
      return moveBearing;
    }
  }

  // Try bearing from track geometry
  const trackBearing = getBearingFromTracks(lon, lat);
  if (trackBearing != null) {
    prevPositions.set(id, { lon, lat, bearing: trackBearing });
    return trackBearing;
  }

  // Fall back to previous bearing or null
  if (prev?.bearing) {
    prevPositions.set(id, { lon, lat, bearing: prev.bearing });
    return prev.bearing;
  }

  prevPositions.set(id, { lon, lat, bearing: null });
  return null;
}

function getDelayCategory(delaySec) {
  if (delaySec == null) return null;
  if (delaySec <= 0) return 'onTime';
  if (delaySec <= 300) return 'slight';
  if (delaySec <= 900) return 'moderate';
  return 'severe';
}

async function fetchDelayData() {
  const now = Date.now();
  if (now - delayFetchTime < DELAY_CACHE_TTL) return delayMap;

  try {
    const res = await fetch(
      'https://api.entur.io/realtime/v1/gtfs-rt/trip-updates',
      { headers: ENTUR_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return delayMap;

    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    const newMap = new Map();
    for (const entity of feed.entity) {
      const tu = entity.tripUpdate;
      if (!tu || !tu.trip?.tripId) continue;
      // Only include train operator trips
      const routeId = tu.trip.routeId || '';
      const prefix = routeId.split(':')[0];
      if (!TRAIN_OPERATORS.includes(prefix)) continue;
      const updates = tu.stopTimeUpdate;
      if (!updates || updates.length === 0) continue;
      // Use the last stop time update's arrival delay
      const lastUpdate = updates[updates.length - 1];
      const delay = lastUpdate?.arrival?.delay ?? lastUpdate?.departure?.delay ?? null;
      if (delay != null) {
        newMap.set(tu.trip.tripId, delay);
      }
    }

    delayMap = newMap;
    delayFetchTime = now;
  } catch (err) {
    console.error('Trip updates fetch error:', err.message);
  }
  return delayMap;
}

// GET /api/trains — Live train positions
router.get('/', async (req, res) => {
  const now = Date.now();

  // Return cached data if fresh
  if (cachedData && now - cacheTime < CACHE_TTL) {
    return res.json(cachedData);
  }

  // Rate limit upstream requests
  const elapsed = now - lastFetchTime;
  if (elapsed < MIN_FETCH_INTERVAL) {
    if (cachedData) return res.json(cachedData);
    await new Promise((r) => setTimeout(r, MIN_FETCH_INTERVAL - elapsed));
  }

  lastFetchTime = Date.now();

  try {
    // Fetch vehicle positions and delay data in parallel
    const [vpRes, delays] = await Promise.all([
      fetch(
        'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions',
        { headers: ENTUR_HEADERS, signal: AbortSignal.timeout(10000) }
      ),
      fetchDelayData(),
    ]);

    if (!vpRes.ok) throw new Error(`Entur GTFS-RT ${vpRes.status}`);

    const buffer = await vpRes.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    const features = [];
    for (const entity of feed.entity) {
      const v = entity.vehicle;
      if (!v || !v.position) continue;

      // Filter: only include train operators
      const routeId = v.trip?.routeId ?? '';
      const opPrefix = routeId.split(':')[0];
      if (!TRAIN_OPERATORS.includes(opPrefix)) continue;

      const { latitude, longitude, bearing, speed } = v.position;
      if (latitude == null || longitude == null) continue;

      const tripId = v.trip?.tripId ?? null;
      const delaySec = tripId ? (delays.get(tripId) ?? null) : null;

      // Derive a display label: use vehicle label, or extract train number from id/tripId
      const rawLabel = v.vehicle?.label || '';
      const rawId = v.vehicle?.id ?? entity.id ?? '';
      // Train IDs are often like "531-2026-03-04" — extract the number part
      const trainNumber = rawLabel || rawId.split('-')[0] || rawId;
      // Build a readable line name from routeId (e.g. "VYG:Line:R12" → "R12")
      const lineName = routeId.split(':').pop() || '';

      // Compute bearing: GTFS-RT → movement → track geometry → previous
      const computedBearing = getTrainBearing(rawId, longitude, latitude, bearing);

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        properties: {
          id: rawId,
          label: lineName || trainNumber,
          tripId,
          routeId: v.trip?.routeId ?? null,
          directionId: v.trip?.directionId ?? null,
          bearing: computedBearing,
          speed: speed ?? null,
          speedKmh: speed != null ? Math.round(speed * 3.6) : null,
          stopId: v.stopId ?? null,
          currentStatus: v.currentStatus ?? null,
          timestamp: v.timestamp ? Number(v.timestamp) : null,
          delay: delaySec,
          delayCategory: getDelayCategory(delaySec),
        },
      });
    }

    const result = {
      type: 'FeatureCollection',
      meta: { total: features.length, fetchedAt: new Date().toISOString() },
      features,
    };

    cachedData = result;
    cacheTime = Date.now();
    res.json(result);
  } catch (err) {
    console.error('Train positions fetch error:', err.message);
    if (cachedData) return res.json(cachedData);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/trains/stations — Railway stations (cached 24h)
router.get('/stations', async (req, res) => {
  const now = Date.now();
  if (stationCache && now - stationCacheTime < STATION_CACHE_TTL) {
    return res.json(stationCache);
  }

  try {
    const query = `[out:json][timeout:60];
area["name"="Norge"]["admin_level"="2"]->.norway;
(
  node["railway"="station"]["train"="yes"](area.norway);
  node["railway"="halt"]["train"="yes"](area.norway);
  node["railway"="station"]["usage"="main"](area.norway);
  node["railway"="station"](area.norway);
);
out body;`;

    const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(60000),
    });

    if (!overpassRes.ok) throw new Error(`Overpass API ${overpassRes.status}`);
    const data = await overpassRes.json();

    // Deduplicate by node id
    const seen = new Set();
    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'node' || seen.has(el.id)) continue;
      seen.add(el.id);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          id: el.id,
          name: el.tags?.name ?? null,
          operator: el.tags?.operator ?? null,
        },
      });
    }

    const result = {
      type: 'FeatureCollection',
      meta: { total: features.length, fetchedAt: new Date().toISOString() },
      features,
    };

    stationCache = result;
    stationCacheTime = Date.now();
    res.json(result);
  } catch (err) {
    console.error('Station fetch error:', err.message);
    if (stationCache) return res.json(stationCache);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/trains/tracks — Railway tracks (cached 24h)
router.get('/tracks', async (req, res) => {
  const now = Date.now();
  if (trackCache && now - trackCacheTime < TRACK_CACHE_TTL) {
    return res.json(trackCache);
  }

  try {
    const query = `[out:json][timeout:120];
area["name"="Norge"]["admin_level"="2"]->.norway;
way["railway"="rail"](area.norway);
out geom;`;

    const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(120000),
    });

    if (!overpassRes.ok) throw new Error(`Overpass API ${overpassRes.status}`);
    const data = await overpassRes.json();

    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.geometry) continue;
      const coords = el.geometry.map((g) => [g.lon, g.lat]);
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          id: el.id,
          name: el.tags?.name ?? null,
          usage: el.tags?.usage ?? null,
          electrified: el.tags?.electrified ?? null,
        },
      });
    }

    const result = {
      type: 'FeatureCollection',
      meta: { total: features.length, fetchedAt: new Date().toISOString() },
      features,
    };

    trackCache = result;
    trackCacheTime = Date.now();
    res.json(result);
  } catch (err) {
    console.error('Track fetch error:', err.message);
    if (trackCache) return res.json(trackCache);
    res.status(502).json({ error: err.message });
  }
});

// Eagerly fetch track data on startup for bearing computation
async function preloadTracks() {
  try {
    const query = `[out:json][timeout:120];
area["name"="Norge"]["admin_level"="2"]->.norway;
way["railway"="rail"](area.norway);
out geom;`;

    const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(120000),
    });

    if (!overpassRes.ok) throw new Error(`Overpass API ${overpassRes.status}`);
    const data = await overpassRes.json();

    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.geometry) continue;
      const coords = el.geometry.map((g) => [g.lon, g.lat]);
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          id: el.id,
          name: el.tags?.name ?? null,
          usage: el.tags?.usage ?? null,
          electrified: el.tags?.electrified ?? null,
        },
      });
    }

    trackCache = {
      type: 'FeatureCollection',
      meta: { total: features.length, fetchedAt: new Date().toISOString() },
      features,
    };
    trackCacheTime = Date.now();
    console.log(`Track data preloaded: ${features.length} track segments for bearing computation`);
  } catch (err) {
    console.error('Track preload error:', err.message);
  }
}

// Start preloading after a short delay to not block startup
setTimeout(preloadTracks, 5000);

export default router;
