import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../auth/middleware.js';
import config from '../config.js';

const router = Router();
router.use(requireAuth);

// GeoJSON source directory
const GEOJSON_DIR = process.env.GEOJSON_DIR || path.join(config.dataDir, 'geojson');

// Layer definitions with metadata
const LAYER_DEFS = {
  // Power Grid
  '66kv':           { category: 'power', name: '66 kV',          type: 'line' },
  '110kv':          { category: 'power', name: '110 kV',         type: 'line' },
  '132kv':          { category: 'power', name: '132 kV',         type: 'line' },
  '220kv':          { category: 'power', name: '220 kV',         type: 'line' },
  '300kv':          { category: 'power', name: '300 kV',         type: 'line' },
  '420kv':          { category: 'power', name: '420 kV',         type: 'line' },
  'distribution':   { category: 'power', name: 'Distribution',   type: 'line' },
  'subsea_power':   { category: 'power', name: 'Subsea Power',   type: 'line' },
  'transformator':  { category: 'power', name: 'Transformator',  type: 'mixed' },

  // Transport
  'eroad':          { category: 'transport', name: 'E-roads',          type: 'line' },
  'rail':           { category: 'transport', name: 'Railway',          type: 'line' },
  'rail_station':   { category: 'transport', name: 'Rail Stations',    type: 'point' },
  'rail_substation':{ category: 'transport', name: 'Rail Substations', type: 'point' },
  'railway_bridge': { category: 'transport', name: 'Railway Bridges',  type: 'line' },
  'ferry':          { category: 'transport', name: 'Ferry Routes',     type: 'line' },
  'ferry_rail':     { category: 'transport', name: 'Ferry Rail',       type: 'line' },

  // Telecom
  'fiber':          { category: 'telecom', name: 'Fiber',        type: 'line' },
  'radiotowers2':   { category: 'telecom', name: 'Radio Towers', type: 'point' },
  'radar':          { category: 'telecom', name: 'Radar',        type: 'point' },

  // Aviation
  'airport':        { category: 'aviation', name: 'Airports',      type: 'polygon' },
  'lufthinder':     { category: 'aviation', name: 'Air Obstacles', type: 'line' },

  // Military
  'military':       { category: 'military', name: 'Military Areas', type: 'polygon' },

  // Energy
  'hydro':          { category: 'energy', name: 'Hydro Power',   type: 'mixed' },
  'wind':           { category: 'energy', name: 'Wind Power',    type: 'point' },
  'oil_gas_chem':   { category: 'energy', name: 'Oil/Gas/Chem',  type: 'point' },

  // Other
  'pipes':          { category: 'other', name: 'Pipelines',  type: 'line' },
  'tilfluktsrom':   { category: 'other', name: 'Shelters',   type: 'point' },
};

// In-memory cache for loaded GeoJSON (except lufthinder)
const cache = new Map();

function requireInfraview(req, res, next) {
  if (req.user.role === 'admin' || req.user.infraviewEnabled) {
    return next();
  }
  return res.status(403).json({ error: 'InfraView access required' });
}

router.use(requireInfraview);

// ── Search endpoint (MUST be before /:layer to avoid being caught) ──────────

let nameIndex = null;

function buildNameIndex() {
  if (nameIndex) return nameIndex;
  nameIndex = {};
  for (const [id] of Object.entries(LAYER_DEFS)) {
    if (id === 'lufthinder') continue; // too large
    const filePath = path.join(GEOJSON_DIR, `${id}.geojson`);
    if (!fs.existsSync(filePath)) continue;
    try {
      let data;
      if (cache.has(id)) {
        data = cache.get(id);
      } else {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        cache.set(id, data);
      }
      const names = [];
      for (const f of data.features || []) {
        const p = f.properties || {};
        const n = p.Name || p.name || p.NAME || p.navn || p.official_name || '';
        if (n && !names.includes(n)) names.push(n);
      }
      if (names.length > 0) nameIndex[id] = names;
    } catch {}
  }
  console.log(`Built infrastructure name index: ${Object.values(nameIndex).reduce((s, a) => s + a.length, 0)} names across ${Object.keys(nameIndex).length} layers`);
  return nameIndex;
}

router.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json([]);

  const idx = buildNameIndex();
  const results = [];

  for (const [layerId, names] of Object.entries(idx)) {
    for (const name of names) {
      if (name.toLowerCase().includes(q)) {
        results.push({ name, layer: layerId });
        if (results.length >= 50) break;
      }
    }
    if (results.length >= 50) break;
  }

  res.json(results);
});

// ── List available layers ───────────────────────────────────────────────────

router.get('/layers', (req, res) => {
  const layers = [];
  for (const [id, def] of Object.entries(LAYER_DEFS)) {
    const filePath = path.join(GEOJSON_DIR, `${id}.geojson`);
    const exists = fs.existsSync(filePath);
    if (exists) {
      let featureCount = 0;
      if (cache.has(id)) {
        featureCount = cache.get(id).features?.length || 0;
      }
      layers.push({ id, ...def, featureCount });
    }
  }
  res.json(layers);
});

// ── Get a specific layer's GeoJSON ──────────────────────────────────────────

router.get('/:layer', (req, res) => {
  const { layer } = req.params;

  if (!LAYER_DEFS[layer]) {
    return res.status(404).json({ error: 'Unknown layer' });
  }

  // lufthinder uses bbox filtering
  if (layer === 'lufthinder') {
    return serveLufthinder(req, res);
  }

  // Return from cache if available
  if (cache.has(layer)) {
    return res.json(cache.get(layer));
  }

  const filePath = path.join(GEOJSON_DIR, `${layer}.geojson`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Layer file not found' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    cache.set(layer, data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse GeoJSON' });
  }
});

// ── Lufthinder: large file, serve bbox-filtered ─────────────────────────────

let lufthinderData = null;
let lufthinderSwapped = false; // true if coords are [lat, lon] instead of [lon, lat]

function loadLufthinder() {
  if (lufthinderData) return lufthinderData;
  const filePath = path.join(GEOJSON_DIR, 'lufthinder.geojson');
  if (!fs.existsSync(filePath)) return null;
  try {
    lufthinderData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Detect coordinate order: if first coord[0] > 50, it's likely latitude (Norway: lat 58-71)
    const firstFeature = lufthinderData.features?.[0];
    if (firstFeature?.geometry?.coordinates?.[0]) {
      const c = firstFeature.geometry.coordinates[0];
      const val = Array.isArray(c) ? c[0] : c;
      if (val > 50) {
        lufthinderSwapped = true;
        console.log('lufthinder.geojson: detected [lat, lon] coordinate order, swapping');
      }
    }
    console.log(`Loaded lufthinder.geojson: ${lufthinderData.features?.length || 0} features`);
    return lufthinderData;
  } catch (err) {
    console.error('Failed to load lufthinder:', err.message);
    return null;
  }
}

function serveLufthinder(req, res) {
  const { bbox } = req.query;
  const data = loadLufthinder();
  if (!data) return res.status(404).json({ error: 'lufthinder not available' });

  if (!bbox) {
    return res.json({
      type: 'FeatureCollection',
      features: [],
      totalFeatures: data.features?.length || 0,
    });
  }

  const [west, south, east, north] = bbox.split(',').map(Number);
  if ([west, south, east, north].some(isNaN)) {
    return res.status(400).json({ error: 'Invalid bbox' });
  }

  const filtered = data.features.filter(f => {
    const coords = f.geometry?.coordinates;
    if (!coords) return false;

    let lon, lat;
    if (f.geometry.type === 'Point') {
      [lon, lat] = lufthinderSwapped ? [coords[1], coords[0]] : coords;
    } else {
      // LineString/MultiLineString: check first coordinate
      const first = Array.isArray(coords[0]) ? (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0]) : coords;
      [lon, lat] = lufthinderSwapped ? [first[1], first[0]] : [first[0], first[1]];
    }

    return lon >= west && lon <= east && lat >= south && lat <= north;
  });

  // If coords are swapped, swap them in the output so MapLibre renders correctly
  if (lufthinderSwapped) {
    const swapped = filtered.map(f => ({
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: f.geometry.type === 'Point'
          ? [f.geometry.coordinates[1], f.geometry.coordinates[0], f.geometry.coordinates[2]]
          : f.geometry.coordinates.map(c =>
              Array.isArray(c[0])
                ? c.map(pt => [pt[1], pt[0], ...(pt.length > 2 ? [pt[2]] : [])])
                : [c[1], c[0], ...(c.length > 2 ? [c[2]] : [])]
            ),
      },
    }));
    return res.json({ type: 'FeatureCollection', features: swapped });
  }

  res.json({ type: 'FeatureCollection', features: filtered });
}

export default router;
