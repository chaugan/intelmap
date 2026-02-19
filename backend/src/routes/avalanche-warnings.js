import { Router } from 'express';

const router = Router();

const NVE_BASE = 'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api';

// In-memory caches
let regionsCache = null; // loaded once, never expires
let warningsCache = null; // { data: Map<regionId, Array>, ts }
let parsedPolygonsCache = null; // [{ id, name, polygon: [[lon,lat],...] }]
const detailCache = new Map(); // key: `${regionId}-${lang}` → { data, ts }
const WARNINGS_TTL = 60 * 60 * 1000; // 1 hour

const DANGER_LEVEL_NAMES = {
  1: { no: 'Liten', en: 'Low' },
  2: { no: 'Moderat', en: 'Moderate' },
  3: { no: 'Betydelig', en: 'Considerable' },
  4: { no: 'Stor', en: 'High' },
  5: { no: 'Meget stor', en: 'Very High' },
};

async function fetchRegions() {
  if (regionsCache) return regionsCache;

  const res = await fetch(`${NVE_BASE}/Region`);
  if (!res.ok) throw new Error(`NVE Region API ${res.status}`);
  const all = await res.json();

  // TypeId 10 = A-regions (main forecast regions)
  regionsCache = all.filter((r) => r.TypeId === 10);
  return regionsCache;
}

function parseNvePolygon(polyStr) {
  // NVE format: array of strings or single string — "lat,lon lat,lon lat,lon ..."
  if (!polyStr) return null;
  // Handle array (NVE returns Polygon as string[])
  const raw = Array.isArray(polyStr) ? polyStr.join(' ') : polyStr;
  const coords = raw
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [latStr, lonStr] = pair.split(',');
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      if (isNaN(lat) || isNaN(lon)) return null;
      return [lon, lat]; // GeoJSON = [lon, lat]
    })
    .filter(Boolean);

  if (coords.length < 3) return null;
  // Close ring if not already closed
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return [coords]; // GeoJSON Polygon = array of rings
}

async function fetchAllWarnings() {
  if (warningsCache && Date.now() - warningsCache.ts < WARNINGS_TTL) {
    return warningsCache.data;
  }

  const regions = await fetchRegions();

  // Fetch warnings for all regions in parallel (batched)
  // API returns array of 3 forecast objects (today, tomorrow, day after) per region
  // Second path param is langKey (1=Norwegian, 2=English; 0 returns empty/not-assessed)
  const batchSize = 10;
  const allWarnings = new Map();

  for (let b = 0; b < regions.length; b += batchSize) {
    const batch = regions.slice(b, b + batchSize);
    const results = await Promise.all(
      batch.map(async (region) => {
        try {
          const url = `${NVE_BASE}/AvalancheWarningByRegion/Simple/${region.Id}/1`;
          const res = await fetch(url);
          if (!res.ok) return null;
          const data = await res.json();
          return Array.isArray(data) ? data : null;
        } catch {
          return null;
        }
      })
    );
    batch.forEach((region, i) => {
      if (results[i]) allWarnings.set(region.Id, results[i]);
    });
  }

  warningsCache = { data: allWarnings, ts: Date.now() };
  return allWarnings;
}

function buildGeoJson(regions, allWarnings, dayOffset) {
  const features = [];
  for (const region of regions) {
    const polygon = parseNvePolygon(region.Polygon);
    if (!polygon) continue;

    const forecasts = allWarnings.get(region.Id);
    // Pick the forecast for the requested day (sorted by ValidFrom)
    const warning = forecasts?.[dayOffset] || null;
    const dangerLevel = warning?.DangerLevel ?? 0;

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: polygon },
      properties: {
        id: region.Id,
        name: region.Name,
        dangerLevel: parseInt(dangerLevel, 10) || 0,
        mainText: warning?.MainText || '',
        validFrom: warning?.ValidFrom || null,
        validTo: warning?.ValidTo || null,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// GET /api/avalanche-warnings?day=0|1|2
router.get('/', async (req, res) => {
  try {
    const day = Math.min(Math.max(parseInt(req.query.day, 10) || 0, 0), 2);
    const regions = await fetchRegions();
    const allWarnings = await fetchAllWarnings();
    const geojson = buildGeoJson(regions, allWarnings, day);
    res.json(geojson);
  } catch (err) {
    console.error('Avalanche warnings error:', err);
    res.status(502).json({ error: err.message });
  }
});

// Ray-casting point-in-polygon
function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

async function getParsedPolygons() {
  if (parsedPolygonsCache) return parsedPolygonsCache;
  const regions = await fetchRegions();
  parsedPolygonsCache = regions
    .map((r) => {
      const polygon = parseNvePolygon(r.Polygon);
      return polygon ? { id: r.Id, name: r.Name, polygon: polygon[0] } : null;
    })
    .filter(Boolean);
  return parsedPolygonsCache;
}

// GET /api/avalanche-warnings/at?lat=X&lon=X&day=0
router.get('/at', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const day = Math.min(Math.max(parseInt(req.query.day, 10) || 0, 0), 2);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat/lon required' });

    const polygons = await getParsedPolygons();
    const allWarnings = await fetchAllWarnings();

    let match = null;
    for (const p of polygons) {
      if (pointInPolygon(lon, lat, p.polygon)) {
        match = p;
        break;
      }
    }

    if (!match) {
      return res.json({ regionId: null, regionName: null, dangerLevel: 0, dangerLevelName: null });
    }

    const forecasts = allWarnings.get(match.id);
    const warning = forecasts?.[day] || null;
    const dangerLevel = parseInt(warning?.DangerLevel, 10) || 0;
    const names = DANGER_LEVEL_NAMES[dangerLevel];

    res.json({
      regionId: match.id,
      regionName: match.name,
      dangerLevel,
      dangerLevelName: names || null,
    });
  } catch (err) {
    console.error('Avalanche at-point error:', err);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/avalanche-warnings/detail/:regionId?day=0&lang=1
router.get('/detail/:regionId', async (req, res) => {
  try {
    const regionId = parseInt(req.params.regionId, 10);
    const day = Math.min(Math.max(parseInt(req.query.day, 10) || 0, 0), 2);
    const lang = req.query.lang === '2' ? 2 : 1; // 1=no, 2=en
    if (isNaN(regionId)) return res.status(400).json({ error: 'Invalid regionId' });

    const cacheKey = `${regionId}-${lang}`;
    const cached = detailCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < WARNINGS_TTL) {
      return res.json(cached.data[day] || null);
    }

    const url = `${NVE_BASE}/AvalancheWarningByRegion/Detail/${regionId}/${lang}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`NVE Detail API ${r.status}`);
    const data = await r.json();

    detailCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data[day] || null);
  } catch (err) {
    console.error('Avalanche detail error:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
