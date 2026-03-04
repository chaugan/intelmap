import { Router } from 'express';

const router = Router();

// Norway-wide cache
let norwayCache = null;
let cacheTimestamp = null;
let cacheLoading = false;

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const NORWAY_BBOX = '4.5,57.9,31.1,71.2'; // Full Norway bounding box

const NVDB_BASE = 'https://nvdbapiles.atlas.vegvesen.no/vegobjekter';
const HEADERS = {
  'X-Client': 'IntelMap/1.0',
  'Accept': 'application/json',
};

// Fetch all pages from NVDB API with pagination
async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  let pageCount = 0;
  const maxPages = 100; // Increased for full Norway fetch

  while (nextUrl && pageCount < maxPages) {
    const res = await fetch(nextUrl, { headers: HEADERS });
    if (!res.ok) {
      console.error(`NVDB API error: ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    results.push(...(data.objekter || []));
    nextUrl = data.metadata?.neste?.href || null;
    pageCount++;
  }

  return results;
}

// Parse WKT to GeoJSON geometry
// NVDB returns coords in lat/lon order, but GeoJSON needs [lon, lat]
function parseWktToGeometry(wkt) {
  if (!wkt) return null;

  // Handle POINT or POINT Z
  if (wkt.startsWith('POINT')) {
    const match = wkt.match(/POINT\s*Z?\s*\(\s*([\d.-]+)\s+([\d.-]+)(?:\s+[\d.-]+)?\s*\)/);
    if (match) {
      return {
        type: 'Point',
        coordinates: [parseFloat(match[2]), parseFloat(match[1])],
      };
    }
  }

  // Handle LINESTRING or LINESTRING Z
  if (wkt.startsWith('LINESTRING') && !wkt.startsWith('MULTILINESTRING')) {
    const match = wkt.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/);
    if (match) {
      const coords = match[1].split(',').map((pair) => {
        const parts = pair.trim().split(/\s+/).map(parseFloat);
        return [parts[1], parts[0]]; // Swap lat/lon to lon/lat
      });
      if (coords.length > 0) {
        return { type: 'LineString', coordinates: coords };
      }
    }
  }

  // Handle MULTILINESTRING - convert to MultiLineString geometry
  if (wkt.startsWith('MULTILINESTRING')) {
    // Extract all linestrings from MULTILINESTRING Z ((...),(...),...)
    const innerMatch = wkt.match(/MULTILINESTRING\s*Z?\s*\((.+)\)$/);
    if (innerMatch) {
      const lineStrings = [];
      // Split by ),( to get individual linestrings
      const parts = innerMatch[1].split(/\)\s*,\s*\(/);
      for (const part of parts) {
        // Clean up parentheses
        const clean = part.replace(/^\(/, '').replace(/\)$/, '');
        const coords = clean.split(',').map((pair) => {
          const nums = pair.trim().split(/\s+/).map(parseFloat);
          return [nums[1], nums[0]]; // Swap lat/lon to lon/lat
        });
        if (coords.length > 0) {
          lineStrings.push(coords);
        }
      }
      if (lineStrings.length === 1) {
        return { type: 'LineString', coordinates: lineStrings[0] };
      } else if (lineStrings.length > 1) {
        return { type: 'MultiLineString', coordinates: lineStrings };
      }
    }
  }

  return null;
}

// Convert height restrictions (591) to GeoJSON features
function convertHeights(objects) {
  const features = [];

  for (const obj of objects) {
    const geometry = parseWktToGeometry(obj.geometri?.wkt);
    if (!geometry) continue;

    // Extract properties from egenskaper
    const props = {
      id: obj.id,
      type: 'height',
      restrictionType: 'height',
    };

    for (const eg of obj.egenskaper || []) {
      // Various height fields - take the minimum/most restrictive
      if (eg.navn === 'Beregnet høyde' || eg.navn === 'Skiltet høyde' || eg.navn === 'Høyde') {
        if (props.height == null || eg.verdi < props.height) {
          props.height = eg.verdi;
          props.heightLabel = `${eg.verdi}m`;
        }
      }
      if (eg.navn === 'H-min, høyre kant' || eg.navn === 'H-min, venstre kant') {
        if (props.height == null || eg.verdi < props.height) {
          props.height = eg.verdi;
          props.heightLabel = `${eg.verdi}m`;
        }
      }
      if (eg.navn === 'Type hinder') {
        props.heightType = eg.verdi;
      }
      if (eg.navn === 'Navn') {
        props.name = eg.verdi;
      }
    }

    // Get location info
    if (obj.lokasjon) {
      if (obj.lokasjon.kommuner?.length) {
        props.municipality = obj.lokasjon.kommuner.map((k) => k.navn || k).join(', ');
      }
      if (obj.lokasjon.vegsystemreferanser?.length) {
        const ref = obj.lokasjon.vegsystemreferanser[0];
        props.road = ref.vegsystem?.vegkategori === 'E'
          ? `E${ref.vegsystem?.vegfase || ''}${ref.vegsystem?.vegnummer || ''}`
          : ref.vegsystem?.vegkategori === 'R'
          ? `Rv${ref.vegsystem?.vegnummer || ''}`
          : ref.vegsystem?.vegkategori === 'F'
          ? `Fv${ref.vegsystem?.vegnummer || ''}`
          : ref.kortform || '';
      }
    }

    features.push({
      type: 'Feature',
      geometry,
      properties: props,
    });
  }

  return features;
}

// Convert weight/load class (904) to GeoJSON features
function convertWeights(objects) {
  const features = [];

  for (const obj of objects) {
    const geometry = parseWktToGeometry(obj.geometri?.wkt);
    if (!geometry) continue;

    const props = {
      id: obj.id,
      type: 'weight',
      restrictionType: 'weight',
    };

    for (const eg of obj.egenskaper || []) {
      if (eg.navn === 'Bruksklasse') {
        props.loadClass = eg.verdi;
        // Parse weight from strings like "Bk10 - 50 tonn" or "BkT8 - 40 tonn"
        const weightMatch = eg.verdi.match(/(\d+)\s*tonn/i);
        if (weightMatch) {
          props.maxWeight = parseInt(weightMatch[1], 10);
          props.weightLabel = `${props.maxWeight}t`;
        }
      }
      if (eg.navn === 'Strekningsbeskrivelse') {
        props.description = eg.verdi;
      }
      if (eg.navn === 'Maks vogntoglengde') {
        props.maxVehicleLength = eg.verdi;
      }
    }

    // Get location info
    if (obj.lokasjon) {
      if (obj.lokasjon.kommuner?.length) {
        props.municipality = obj.lokasjon.kommuner.map((k) => k.navn || k).join(', ');
      }
      if (obj.lokasjon.vegsystemreferanser?.length) {
        const ref = obj.lokasjon.vegsystemreferanser[0];
        props.road = ref.vegsystem?.vegkategori === 'E'
          ? `E${ref.vegsystem?.vegfase || ''}${ref.vegsystem?.vegnummer || ''}`
          : ref.vegsystem?.vegkategori === 'R'
          ? `Rv${ref.vegsystem?.vegnummer || ''}`
          : ref.vegsystem?.vegkategori === 'F'
          ? `Fv${ref.vegsystem?.vegnummer || ''}`
          : ref.kortform || '';
      }
    }

    // Only include if we have a weight value
    if (props.maxWeight != null) {
      features.push({
        type: 'Feature',
        geometry,
        properties: props,
      });
    }
  }

  return features;
}

// Check if a feature intersects with the given bounding box
function featureIntersectsBbox(feature, west, south, east, north) {
  const geom = feature.geometry;
  if (!geom) return false;

  // Get all coordinates from the geometry
  let coords = [];
  if (geom.type === 'Point') {
    coords = [geom.coordinates];
  } else if (geom.type === 'LineString') {
    coords = geom.coordinates;
  } else if (geom.type === 'MultiLineString') {
    coords = geom.coordinates.flat();
  }

  // Check if any coordinate is within the bbox
  for (const [lon, lat] of coords) {
    if (lon >= west && lon <= east && lat >= south && lat <= north) {
      return true;
    }
  }
  return false;
}

// Fetch all Norway restrictions and cache them
async function warmCache() {
  if (cacheLoading) return;
  cacheLoading = true;

  console.log('[NVDB] Warming cache - fetching all Norway restrictions...');
  const startTime = Date.now();

  try {
    const [heights, weights] = await Promise.all([
      fetchAllPages(`${NVDB_BASE}/591?kartutsnitt=${NORWAY_BBOX}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
      fetchAllPages(`${NVDB_BASE}/904?kartutsnitt=${NORWAY_BBOX}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
    ]);

    const features = [
      ...convertHeights(heights),
      ...convertWeights(weights),
    ];

    norwayCache = {
      type: 'FeatureCollection',
      features,
      meta: {
        total: features.length,
        heightCount: heights.length,
        weightCount: weights.length,
      },
    };
    cacheTimestamp = Date.now();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[NVDB] Cache warm! ${features.length} features (${heights.length} height, ${weights.length} weight) in ${elapsed}s`);
  } catch (err) {
    console.error('[NVDB] Failed to warm cache:', err);
  } finally {
    cacheLoading = false;
  }
}

// Check if cache needs refresh
function shouldRefreshCache() {
  if (!norwayCache || !cacheTimestamp) return true;
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

// GET /api/nvdb/restrictions?south=...&north=...&east=...&west=...
router.get('/restrictions', async (req, res) => {
  const { south, north, east, west } = req.query;

  if (!south || !north || !east || !west) {
    return res.status(400).json({ error: 'Missing bounding box parameters' });
  }

  // If cache not ready, return empty with loading flag
  if (!norwayCache) {
    return res.json({
      type: 'FeatureCollection',
      features: [],
      meta: { total: 0, heightCount: 0, weightCount: 0, loading: true },
    });
  }

  // Filter cached features by requested bbox
  const w = parseFloat(west);
  const s = parseFloat(south);
  const e = parseFloat(east);
  const n = parseFloat(north);

  const filteredFeatures = norwayCache.features.filter((f) =>
    featureIntersectsBbox(f, w, s, e, n)
  );

  const heightCount = filteredFeatures.filter((f) => f.properties.restrictionType === 'height').length;
  const weightCount = filteredFeatures.filter((f) => f.properties.restrictionType === 'weight').length;

  res.json({
    type: 'FeatureCollection',
    features: filteredFeatures,
    meta: {
      total: filteredFeatures.length,
      heightCount,
      weightCount,
      cachedAt: cacheTimestamp,
    },
  });
});

export default router;
