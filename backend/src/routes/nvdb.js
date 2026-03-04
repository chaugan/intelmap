import { Router } from 'express';

const router = Router();

const CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

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
  const maxPages = 10; // Safety limit

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

// Parse WKT to GeoJSON Point geometry (using centroid for lines)
// NVDB returns coords in lat/lon order, but GeoJSON needs [lon, lat]
function parseWktToPoint(wkt) {
  if (!wkt) return null;

  // Handle POINT or POINT Z
  if (wkt.startsWith('POINT')) {
    const match = wkt.match(/POINT\s*Z?\s*\(\s*([\d.-]+)\s+([\d.-]+)(?:\s+[\d.-]+)?\s*\)/);
    if (match) {
      // NVDB returns lat/lon, swap to lon/lat for GeoJSON
      return {
        type: 'Point',
        coordinates: [parseFloat(match[2]), parseFloat(match[1])],
      };
    }
  }

  // Handle LINESTRING or LINESTRING Z - convert to centroid point
  if (wkt.startsWith('LINESTRING') && !wkt.startsWith('MULTILINESTRING')) {
    const match = wkt.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/);
    if (match) {
      const coords = match[1].split(',').map((pair) => {
        const parts = pair.trim().split(/\s+/).map(parseFloat);
        // NVDB returns lat/lon(/z), swap to lon/lat for GeoJSON
        return [parts[1], parts[0]];
      });
      if (coords.length > 0) {
        // Use midpoint of line for marker placement
        const midIdx = Math.floor(coords.length / 2);
        return { type: 'Point', coordinates: coords[midIdx] };
      }
    }
  }

  // Handle MULTILINESTRING - extract first linestring and use its midpoint
  if (wkt.startsWith('MULTILINESTRING')) {
    // Match the first linestring within the multilinestring
    const match = wkt.match(/MULTILINESTRING\s*Z?\s*\(\(([^)]+)\)/);
    if (match) {
      const coords = match[1].split(',').map((pair) => {
        const parts = pair.trim().split(/\s+/).map(parseFloat);
        return [parts[1], parts[0]]; // Swap lat/lon to lon/lat
      });
      if (coords.length > 0) {
        const midIdx = Math.floor(coords.length / 2);
        return { type: 'Point', coordinates: coords[midIdx] };
      }
    }
  }

  return null;
}

// Convert height restrictions (591) to GeoJSON features
function convertHeights(objects) {
  const features = [];

  for (const obj of objects) {
    const geometry = parseWktToPoint(obj.geometri?.wkt);
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
    const geometry = parseWktToPoint(obj.geometri?.wkt);
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

// GET /api/nvdb/restrictions?south=...&north=...&east=...&west=...
router.get('/restrictions', async (req, res) => {
  const { south, north, east, west } = req.query;

  if (!south || !north || !east || !west) {
    return res.status(400).json({ error: 'Missing bounding box parameters' });
  }

  const bbox = `${west},${south},${east},${north}`;
  const cacheKey = `restrictions-${bbox}`;

  // Check cache
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Fetch height restrictions (591) and weight/load class (904) in parallel
    const [heights, weights] = await Promise.all([
      fetchAllPages(`${NVDB_BASE}/591?kartutsnitt=${bbox}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
      fetchAllPages(`${NVDB_BASE}/904?kartutsnitt=${bbox}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
    ]);

    const features = [
      ...convertHeights(heights),
      ...convertWeights(weights),
    ];

    const geojson = {
      type: 'FeatureCollection',
      features,
      meta: {
        total: features.length,
        heightCount: heights.length,
        weightCount: weights.length,
      },
    };

    // Cache the result
    CACHE.set(cacheKey, { data: geojson, timestamp: Date.now() });

    res.json(geojson);
  } catch (err) {
    console.error('NVDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch NVDB data' });
  }
});

export default router;
