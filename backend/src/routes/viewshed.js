import { Router } from 'express';
import sharp from 'sharp';
import { requireAuth } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

// DEM tile cache (shared with tiles.js — using same AWS source)
const demCache = new Map();
const DEM_CACHE_MAX = 2000;
const DEM_CACHE_TTL = 24 * 60 * 60 * 1000;

function demCacheGet(key) {
  const entry = demCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DEM_CACHE_TTL) { demCache.delete(key); return null; }
  return entry.buf;
}

function demCacheSet(key, buf) {
  if (demCache.size >= DEM_CACHE_MAX) {
    const oldest = demCache.keys().next().value;
    demCache.delete(oldest);
  }
  demCache.set(key, { buf, ts: Date.now() });
}

async function fetchDemTile(z, x, y) {
  const cacheKey = `dem/${z}/${x}/${y}`;
  const cached = demCacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const buf = Buffer.from(await response.arrayBuffer());
  demCacheSet(cacheKey, buf);
  return buf;
}

// Decode a Terrarium PNG tile into a Float32Array of 256x256 elevations
async function decodeTerrariumTile(buffer) {
  const { data } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const elevations = new Float32Array(256 * 256);
  // Terrarium tiles are RGB (3 channels) or RGBA (4 channels)
  const channels = data.length / (256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    elevations[i] = (r * 256 + g + b / 256) - 32768;
  }
  return elevations;
}

// Convert lon/lat to tile coordinates
function lngLatToTile(lng, lat, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

// Get the lon/lat of a tile's top-left corner
function tileToLngLat(x, y, zoom) {
  const n = Math.pow(2, zoom);
  const lng = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const lat = latRad * 180 / Math.PI;
  return { lng, lat };
}

// Haversine distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Destination point given start, bearing (radians), and distance (meters)
function destination(lat, lon, bearingRad, distMeters) {
  const R = 6371000;
  const d = distMeters / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180,
  };
}

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude, observerHeight, radiusKm } = req.body;

    // Validation
    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const height = Math.max(1, Math.min(100, Number(observerHeight) || 5));
    const radius = Math.max(0.5, Math.min(50, Number(radiusKm) || 5));
    const radiusMeters = radius * 1000;

    // Choose zoom level based on radius
    let zoom;
    if (radius > 10) zoom = 12;
    else if (radius > 3) zoom = 13;
    else zoom = 14;

    // Calculate bounding box
    const north = destination(latitude, longitude, 0, radiusMeters);
    const south = destination(latitude, longitude, Math.PI, radiusMeters);
    const east = destination(latitude, longitude, Math.PI / 2, radiusMeters);
    const west = destination(latitude, longitude, 3 * Math.PI / 2, radiusMeters);

    const latMin = south.lat;
    const latMax = north.lat;
    const lonMin = west.lon;
    const lonMax = east.lon;

    // Calculate tile range
    const tileNW = lngLatToTile(lonMin, latMax, zoom);
    const tileSE = lngLatToTile(lonMax, latMin, zoom);

    // Fetch and decode all tiles
    const tileMap = new Map(); // "x,y" -> Float32Array
    const tilePromises = [];
    for (let tx = tileNW.x; tx <= tileSE.x; tx++) {
      for (let ty = tileNW.y; ty <= tileSE.y; ty++) {
        tilePromises.push(
          fetchDemTile(zoom, tx, ty).then(async (buf) => {
            if (buf) {
              const elevations = await decodeTerrariumTile(buf);
              tileMap.set(`${tx},${ty}`, { x: tx, y: ty, elevations });
            }
          })
        );
      }
    }
    await Promise.all(tilePromises);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    // Build elevation lookup function
    function getElevation(lon, lat) {
      const n = Math.pow(2, zoom);
      const xf = (lon + 180) / 360 * n;
      const latRad = lat * Math.PI / 180;
      const yf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;

      const tileX = Math.floor(xf);
      const tileY = Math.floor(yf);

      const tile = tileMap.get(`${tileX},${tileY}`);
      if (!tile) return 0;

      const px = Math.floor((xf - tileX) * 256);
      const py = Math.floor((yf - tileY) * 256);
      const cx = Math.max(0, Math.min(255, px));
      const cy = Math.max(0, Math.min(255, py));

      return tile.elevations[cy * 256 + cx];
    }

    // Get observer elevation
    const groundElevation = getElevation(longitude, latitude);
    const observerElevation = groundElevation + height;

    // Ray-cast viewshed: 720 rays, 0.5-degree steps
    const numRays = 720;
    // Sample resolution based on radius — larger radius = coarser samples
    const sampleStep = radius > 10 ? 100 : radius > 3 ? 50 : 30; // meters
    const numSamples = Math.ceil(radiusMeters / sampleStep);

    // Polar grid: [ray][sample] = visible?
    const visibilityGrid = new Array(numRays);

    for (let r = 0; r < numRays; r++) {
      const bearingDeg = r * 0.5;
      const bearingRad = bearingDeg * Math.PI / 180;
      visibilityGrid[r] = new Uint8Array(numSamples);
      let maxAngle = -Infinity;

      for (let s = 1; s <= numSamples; s++) {
        const dist = s * sampleStep;
        const pt = destination(latitude, longitude, bearingRad, dist);
        const terrainElev = getElevation(pt.lon, pt.lat);
        const elevAngle = Math.atan2(terrainElev - observerElevation, dist);

        if (elevAngle > maxAngle) {
          visibilityGrid[r][s - 1] = 1; // visible
          maxAngle = elevAngle;
        }
        // else: not visible (blocked by terrain closer in)
      }
    }

    // Convert to GeoJSON: build wedge polygons for visible sectors
    const visiblePolygons = [];
    const angleStep = 0.5; // degrees per ray

    for (let r = 0; r < numRays; r++) {
      let startSample = -1;

      for (let s = 0; s <= numSamples; s++) {
        const vis = s < numSamples ? visibilityGrid[r][s] : 0;

        if (vis && startSample === -1) {
          startSample = s;
        } else if (!vis && startSample !== -1) {
          // Build a wedge from startSample to s-1
          const bearing1 = (r * angleStep - angleStep / 2) * Math.PI / 180;
          const bearing2 = (r * angleStep + angleStep / 2) * Math.PI / 180;
          const dNear = (startSample + 1) * sampleStep;
          const dFar = s * sampleStep;

          const p1 = destination(latitude, longitude, bearing1, dNear);
          const p2 = destination(latitude, longitude, bearing2, dNear);
          const p3 = destination(latitude, longitude, bearing2, dFar);
          const p4 = destination(latitude, longitude, bearing1, dFar);

          visiblePolygons.push([[
            [p1.lon, p1.lat],
            [p2.lon, p2.lat],
            [p3.lon, p3.lat],
            [p4.lon, p4.lat],
            [p1.lon, p1.lat],
          ]]);
          startSample = -1;
        }
      }
    }

    // Count visible samples for stats
    let visibleCount = 0;
    let totalCount = 0;
    for (let r = 0; r < numRays; r++) {
      for (let s = 0; s < numSamples; s++) {
        totalCount++;
        if (visibilityGrid[r][s]) visibleCount++;
      }
    }

    const totalAreaKm2 = Math.PI * radius * radius;
    const visiblePercent = totalCount > 0 ? Math.round(visibleCount / totalCount * 100) : 0;
    const visibleAreaKm2 = Math.round(totalAreaKm2 * visiblePercent / 100 * 100) / 100;

    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: visiblePolygons,
      },
      properties: {
        observerLon: longitude,
        observerLat: latitude,
        observerHeight: height,
        radiusKm: radius,
      },
    };

    res.json({
      geojson,
      stats: {
        visiblePercent,
        visibleAreaKm2,
        totalAreaKm2: Math.round(totalAreaKm2 * 100) / 100,
      },
      observerElevation: Math.round(groundElevation),
    });
  } catch (err) {
    console.error('Viewshed calculation error:', err);
    res.status(500).json({ error: 'Viewshed calculation failed' });
  }
});

export default router;
