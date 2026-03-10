import sharp from 'sharp';

// DEM tile cache
const demCache = new Map();
const DEM_CACHE_MAX = 2000;
const DEM_CACHE_TTL = 24 * 60 * 60 * 1000;

export function demCacheGet(key) {
  const entry = demCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DEM_CACHE_TTL) { demCache.delete(key); return null; }
  return entry.buf;
}

export function demCacheSet(key, buf) {
  if (demCache.size >= DEM_CACHE_MAX) {
    const oldest = demCache.keys().next().value;
    demCache.delete(oldest);
  }
  demCache.set(key, { buf, ts: Date.now() });
}

export async function fetchDemTile(z, x, y) {
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

export async function decodeTerrariumTile(buffer) {
  const { data } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const elevations = new Float32Array(256 * 256);
  const channels = data.length / (256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    elevations[i] = (r * 256 + g + b / 256) - 32768;
  }
  return elevations;
}

export function lngLatToTile(lng, lat, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

export function tileToLngLat(x, y, zoom) {
  const n = Math.pow(2, zoom);
  const lng = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const lat = latRad * 180 / Math.PI;
  return { lng, lat };
}

/**
 * Compute terrain surface normal at a point by sampling 4 neighbors.
 * Returns { normalBearing (rad, direction slope faces outward), slopeAngle (degrees) }
 */
export function computeSurfaceNormal(lon, lat, getElevation, cellSizeMeters = 90) {
  const dLat = (cellSizeMeters / 6371000) * (180 / Math.PI);
  const dLon = dLat / Math.cos(lat * Math.PI / 180);

  const eN = getElevation(lon, lat + dLat);
  const eS = getElevation(lon, lat - dLat);
  const eE = getElevation(lon + dLon, lat);
  const eW = getElevation(lon - dLon, lat);

  const dzdx = (eE - eW) / (2 * cellSizeMeters); // east-west gradient
  const dzdy = (eN - eS) / (2 * cellSizeMeters); // north-south gradient

  // Slope angle from horizontal
  const slopeAngle = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;

  // Normal bearing: direction the slope faces outward (downhill direction)
  // atan2(-dzdx, -dzdy) gives bearing from north, clockwise
  let normalBearing = Math.atan2(-dzdx, -dzdy);
  if (normalBearing < 0) normalBearing += 2 * Math.PI;

  return { normalBearing, slopeAngle };
}

/**
 * Reflect an incoming bearing off a surface with the given normal bearing.
 * All angles in radians. Returns reflected bearing in [0, 2π).
 */
export function reflectBearing(incomingBearingRad, surfaceNormalBearingRad) {
  let reflected = 2 * surfaceNormalBearingRad - incomingBearingRad + Math.PI;
  reflected = ((reflected % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return reflected;
}

/**
 * Estimate reflection loss in dB for terrain reflection.
 * Steeper slopes reflect better; higher frequencies scatter more.
 * Returns a negative dB value (loss). -Infinity if slope too gentle.
 */
export function reflectionLossDb(slopeAngle, frequencyMHz) {
  if (slopeAngle < 15) return -Infinity;

  // Base loss: cliff (>70°) = -6 dB, gentle (15°) = -18 dB, linear interpolation
  const baseLoss = -18 + (slopeAngle - 15) * (12 / 55); // -18 at 15°, -6 at 70°
  const clamped = Math.max(-18, Math.min(-6, baseLoss));

  // Frequency penalty
  let freqPenalty = 0;
  if (frequencyMHz > 1000) freqPenalty = -5;
  else if (frequencyMHz > 300) freqPenalty = -2;

  const total = clamped + freqPenalty;
  return Math.max(total, -25); // cap at -25 dB worst case (not -Infinity for valid slopes)
}

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function destination(lat, lon, bearingRad, distMeters) {
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

/**
 * Build a tile map for a given center point and radius.
 * Returns { tileMap, zoom, getElevation }.
 */
export async function buildTileMap(latitude, longitude, radiusKm) {
  const radius = radiusKm;
  const radiusMeters = radius * 1000;

  let zoom;
  if (radius > 10) zoom = 12;
  else if (radius > 3) zoom = 13;
  else zoom = 14;

  const north = destination(latitude, longitude, 0, radiusMeters);
  const south = destination(latitude, longitude, Math.PI, radiusMeters);
  const east = destination(latitude, longitude, Math.PI / 2, radiusMeters);
  const west = destination(latitude, longitude, 3 * Math.PI / 2, radiusMeters);

  const tileNW = lngLatToTile(west.lon, north.lat, zoom);
  const tileSE = lngLatToTile(east.lon, south.lat, zoom);

  const tileMap = new Map();
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

  function getElevation(lon, lat) {
    const n = Math.pow(2, zoom);
    const xf = (lon + 180) / 360 * n;
    const latRad = lat * Math.PI / 180;
    const yf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    const tileX = Math.floor(xf);
    const tileY = Math.floor(yf);
    const tile = tileMap.get(`${tileX},${tileY}`);
    if (!tile) return 0;
    const px = Math.max(0, Math.min(255, Math.floor((xf - tileX) * 256)));
    const py = Math.max(0, Math.min(255, Math.floor((yf - tileY) * 256)));
    return tile.elevations[py * 256 + px];
  }

  return { tileMap, zoom, getElevation };
}
