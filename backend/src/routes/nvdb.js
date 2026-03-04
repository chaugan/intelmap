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

// Convert height restrictions (591) to GeoJSON features
function convertHeights(objects) {
  const features = [];

  for (const obj of objects) {
    if (!obj.geometri?.wkt) continue;

    // Parse WKT POINT or LINESTRING
    const wkt = obj.geometri.wkt;
    let geometry = null;

    if (wkt.startsWith('POINT')) {
      const match = wkt.match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/);
      if (match) {
        geometry = {
          type: 'Point',
          coordinates: [parseFloat(match[1]), parseFloat(match[2])],
        };
      }
    } else if (wkt.startsWith('LINESTRING')) {
      const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/);
      if (match) {
        const coords = match[1].split(',').map((pair) => {
          const [x, y] = pair.trim().split(/\s+/).map(parseFloat);
          return [x, y];
        });
        geometry = { type: 'LineString', coordinates: coords };
      }
    }

    if (!geometry) continue;

    // Extract properties from egenskaper
    const props = {
      id: obj.id,
      type: 'height',
      restrictionType: 'height',
    };

    for (const eg of obj.egenskaper || []) {
      if (eg.navn === 'Høyde') {
        props.height = eg.verdi;
        props.heightLabel = `${eg.verdi}m`;
      }
      if (eg.navn === 'Skilthøyde') {
        props.signHeight = eg.verdi;
      }
      if (eg.navn === 'Type') {
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

// Convert weight/load class (893) to GeoJSON features
function convertWeights(objects) {
  const features = [];

  for (const obj of objects) {
    if (!obj.geometri?.wkt) continue;

    // Parse WKT
    const wkt = obj.geometri.wkt;
    let geometry = null;

    if (wkt.startsWith('POINT')) {
      const match = wkt.match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/);
      if (match) {
        geometry = {
          type: 'Point',
          coordinates: [parseFloat(match[1]), parseFloat(match[2])],
        };
      }
    } else if (wkt.startsWith('LINESTRING')) {
      const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/);
      if (match) {
        const coords = match[1].split(',').map((pair) => {
          const [x, y] = pair.trim().split(/\s+/).map(parseFloat);
          return [x, y];
        });
        geometry = { type: 'LineString', coordinates: coords };
      }
    }

    if (!geometry) continue;

    const props = {
      id: obj.id,
      type: 'weight',
      restrictionType: 'weight',
    };

    for (const eg of obj.egenskaper || []) {
      if (eg.navn === 'Bruksklasse') {
        props.loadClass = eg.verdi;
      }
      if (eg.navn === 'Bruksklasse, vinter') {
        props.loadClassWinter = eg.verdi;
      }
      if (eg.navn === 'Maks tillatt totalvekt') {
        props.maxWeight = eg.verdi;
        props.weightLabel = `${eg.verdi}t`;
      }
      if (eg.navn === 'Maks tillatt aksellast') {
        props.maxAxleLoad = eg.verdi;
      }
      if (eg.navn === 'Maks tillatt boggilast') {
        props.maxBogieLoad = eg.verdi;
      }
      if (eg.navn === 'Vegtype') {
        props.roadType = eg.verdi;
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
    // Fetch height restrictions (591) and weight/load class (893) in parallel
    const [heights, weights] = await Promise.all([
      fetchAllPages(`${NVDB_BASE}/591?kartutsnitt=${bbox}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
      fetchAllPages(`${NVDB_BASE}/893?kartutsnitt=${bbox}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
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
