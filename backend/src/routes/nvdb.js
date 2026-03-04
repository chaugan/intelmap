import { Router } from 'express';

const router = Router();

// Cache with bbox containment check
const CACHE = new Map(); // key: bbox string, value: { data, bbox: {w,s,e,n}, timestamp }
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const NVDB_BASE = 'https://nvdbapiles.atlas.vegvesen.no/vegobjekter';
const HEADERS = {
  'X-Client': 'IntelMap/1.0',
  'Accept': 'application/json',
};

// Check if bbox1 contains bbox2
function bboxContains(outer, inner) {
  return outer.w <= inner.w && outer.s <= inner.s &&
         outer.e >= inner.e && outer.n >= inner.n;
}

// Check if a feature intersects with the given bounding box
function featureIntersectsBbox(feature, w, s, e, n) {
  const geom = feature.geometry;
  if (!geom) return false;

  let coords = [];
  if (geom.type === 'Point') {
    coords = [geom.coordinates];
  } else if (geom.type === 'LineString') {
    coords = geom.coordinates;
  } else if (geom.type === 'MultiLineString') {
    coords = geom.coordinates.flat();
  }

  for (const [lon, lat] of coords) {
    if (lon >= w && lon <= e && lat >= s && lat <= n) {
      return true;
    }
  }
  return false;
}

// Find a cached bbox that contains the requested bbox
function findContainingCache(reqBbox) {
  const now = Date.now();
  for (const [key, entry] of CACHE.entries()) {
    // Skip expired entries
    if (now - entry.timestamp > CACHE_TTL) {
      CACHE.delete(key);
      continue;
    }
    // Check if this cached bbox contains the requested bbox
    if (bboxContains(entry.bbox, reqBbox)) {
      return entry;
    }
  }
  return null;
}

// Fetch all pages from NVDB API with pagination
async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  let pageCount = 0;
  const maxPages = 50;

  while (nextUrl && pageCount < maxPages) {
    const res = await fetch(nextUrl, { headers: HEADERS });
    if (!res.ok) {
      console.error(`NVDB API error: ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    const objects = data.objekter || [];
    if (objects.length === 0) break; // No more data
    results.push(...objects);
    nextUrl = data.metadata?.neste?.href || null;
    pageCount++;
  }

  return results;
}

// Parse WKT to GeoJSON geometry
function parseWktToGeometry(wkt) {
  if (!wkt) return null;

  if (wkt.startsWith('POINT')) {
    const match = wkt.match(/POINT\s*Z?\s*\(\s*([\d.-]+)\s+([\d.-]+)(?:\s+[\d.-]+)?\s*\)/);
    if (match) {
      return {
        type: 'Point',
        coordinates: [parseFloat(match[2]), parseFloat(match[1])],
      };
    }
  }

  if (wkt.startsWith('LINESTRING') && !wkt.startsWith('MULTILINESTRING')) {
    const match = wkt.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/);
    if (match) {
      const coords = match[1].split(',').map((pair) => {
        const parts = pair.trim().split(/\s+/).map(parseFloat);
        return [parts[1], parts[0]];
      });
      if (coords.length > 0) {
        return { type: 'LineString', coordinates: coords };
      }
    }
  }

  if (wkt.startsWith('MULTILINESTRING')) {
    const innerMatch = wkt.match(/MULTILINESTRING\s*Z?\s*\((.+)\)$/);
    if (innerMatch) {
      const lineStrings = [];
      const parts = innerMatch[1].split(/\)\s*,\s*\(/);
      for (const part of parts) {
        const clean = part.replace(/^\(/, '').replace(/\)$/, '');
        const coords = clean.split(',').map((pair) => {
          const nums = pair.trim().split(/\s+/).map(parseFloat);
          return [nums[1], nums[0]];
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

    const props = {
      id: obj.id,
      type: 'height',
      restrictionType: 'height',
    };

    for (const eg of obj.egenskaper || []) {
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

  const reqBbox = {
    w: parseFloat(west),
    s: parseFloat(south),
    e: parseFloat(east),
    n: parseFloat(north),
  };

  // Check if we have a cached bbox that contains this request
  const containingCache = findContainingCache(reqBbox);
  if (containingCache) {
    // Filter the cached data to the requested bbox
    const filteredFeatures = containingCache.data.features.filter((f) =>
      featureIntersectsBbox(f, reqBbox.w, reqBbox.s, reqBbox.e, reqBbox.n)
    );

    const heightCount = filteredFeatures.filter((f) => f.properties.restrictionType === 'height').length;
    const weightCount = filteredFeatures.filter((f) => f.properties.restrictionType === 'weight').length;

    return res.json({
      type: 'FeatureCollection',
      features: filteredFeatures,
      meta: {
        total: filteredFeatures.length,
        heightCount,
        weightCount,
        fromCache: true,
      },
    });
  }

  // Check exact cache match
  const bboxStr = `${west},${south},${east},${north}`;
  const exactCache = CACHE.get(bboxStr);
  if (exactCache && Date.now() - exactCache.timestamp < CACHE_TTL) {
    return res.json(exactCache.data);
  }

  try {
    const [heights, weights] = await Promise.all([
      fetchAllPages(`${NVDB_BASE}/591?kartutsnitt=${bboxStr}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
      fetchAllPages(`${NVDB_BASE}/904?kartutsnitt=${bboxStr}&srid=4326&inkluder=geometri,egenskaper,lokasjon`),
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

    // Cache the result with bbox info
    CACHE.set(bboxStr, {
      data: geojson,
      bbox: reqBbox,
      timestamp: Date.now(),
    });

    res.json(geojson);
  } catch (err) {
    console.error('NVDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch NVDB data' });
  }
});

export default router;
