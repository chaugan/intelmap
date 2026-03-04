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
  'powerlines':     { category: 'power', name: 'Powerlines',     type: 'line' },
  'subsea_power':   { category: 'power', name: 'Subsea Power',   type: 'line' },
  'transformator':  { category: 'power', name: 'Transformator',  type: 'point' },

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
  'lufthinder':     { category: 'aviation', name: 'Air Obstacles', type: 'point' },

  // Military
  'military':       { category: 'military', name: 'Military Areas', type: 'polygon' },

  // Energy
  'hydro':          { category: 'energy', name: 'Hydro Power',   type: 'point' },
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

// List available layers
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

// Get a specific layer's GeoJSON
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

// Lufthinder: large file, serve bbox-filtered
let lufthinderData = null;

function loadLufthinder() {
  if (lufthinderData) return lufthinderData;
  const filePath = path.join(GEOJSON_DIR, 'lufthinder.geojson');
  if (!fs.existsSync(filePath)) return null;
  try {
    lufthinderData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
    // No bbox = return feature count only (too large for full)
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
    // Handle Point geometry
    if (f.geometry.type === 'Point') {
      const [lon, lat] = coords;
      return lon >= west && lon <= east && lat >= south && lat <= north;
    }
    // For other types, check first coordinate
    const first = Array.isArray(coords[0]) ? (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0]) : coords;
    return first[0] >= west && first[0] <= east && first[1] >= south && first[1] <= north;
  });

  res.json({
    type: 'FeatureCollection',
    features: filtered,
  });
}

export default router;
