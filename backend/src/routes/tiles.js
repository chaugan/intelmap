import { Router } from 'express';
import sharp from 'sharp';

// Helper to convert lng/lat to tile coordinates
function lngLatToTile(lng, lat, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

// Helper to convert tile to lng/lat (top-left corner)
function tileToLngLat(x, y, zoom) {
  const n = Math.pow(2, zoom);
  const lng = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const lat = latRad * 180 / Math.PI;
  return { lng, lat };
}

const router = Router();

// Elevation lookup via Kartverket
router.get('/elevation', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    const url = `https://ws.geonorge.no/hoydedata/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&geession=false`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      let elevation = data.punkter?.[0]?.z ?? data.hoyde ?? null;
      // Treat ocean (negative elevation) as sea level (0m)
      if (elevation !== null && elevation < 0) {
        elevation = 0;
      }
      return res.json({ elevation });
    }
    // Fallback: return null if service unavailable
    res.json({ elevation: null });
  } catch {
    res.json({ elevation: null });
  }
});

// Convert XYZ tile coordinates to EPSG:4326 bounding box
function tileToBBox4326(z, x, y) {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / (1 << z);
  const lonMin = (x / (1 << z)) * 360 - 180;
  const lonMax = ((x + 1) / (1 << z)) * 360 - 180;
  const latMax = (180 / Math.PI) * Math.atan(Math.sinh(n));
  const latMin = (180 / Math.PI) * Math.atan(Math.sinh(n2));
  return { latMin, lonMin, latMax, lonMax };
}

// Convert XYZ tile coordinates to EPSG:3857 (Web Mercator) bounding box
function tileToBBox3857(z, x, y) {
  const earthRadius = 6378137;
  const maxExtent = Math.PI * earthRadius;
  const tileSize = (2 * maxExtent) / (1 << z);
  const xMin = -maxExtent + x * tileSize;
  const xMax = -maxExtent + (x + 1) * tileSize;
  const yMax = maxExtent - y * tileSize;
  const yMin = maxExtent - (y + 1) * tileSize;
  return { xMin, yMin, xMax, yMax };
}

// Avalanche WMS proxy — XYZ tile endpoint (NVE has no CORS, no EPSG:3857)
router.get('/avalanche/:z/:x/:y.png', async (req, res) => {
  try {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const { latMin, lonMin, latMax, lonMax } = tileToBBox4326(z, x, y);
    // WMS 1.3.0 with EPSG:4326: bbox order is lat,lon (y,x)
    const wmsBbox = `${latMin},${lonMin},${latMax},${lonMax}`;

    const url = 'https://nve.geodataonline.no/arcgis/services/SnoskredAktsomhet/MapServer/WMSServer'
      + '?service=WMS&request=GetMap&version=1.3.0'
      + '&layers=PotensieltSkredfareOmr,S2_snoskred_u_skogeffekt_Aktsomhetsomrade&styles=&crs=EPSG:4326'
      + `&bbox=${wmsBbox}&width=256&height=256`
      + '&format=image/png&transparent=true';

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('WMS error');

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    const srcBuffer = Buffer.from(await response.arrayBuffer());

    // Recolor all non-transparent pixels to red (#FF0000), preserving alpha
    const { data, info } = await sharp(srcBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        data[i] = 255;     // R
        data[i + 1] = 0;   // G
        data[i + 2] = 0;   // B
      }
    }
    const result = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    res.send(result);
  } catch {
    res.status(502).send('Avalanche proxy error');
  }
});

// Avalanche data source info (NVE does not expose a usable update date)
router.get('/avalanche-date', (_req, res) => {
  res.json({ date: null, source: 'NVE / NGU' });
});

// DEM tile cache (in-memory, key = "z/x/y", max 2000 entries, 24h TTL)
const demCache = new Map();
const DEM_CACHE_MAX = 2000;
const DEM_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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

// DEM (Terrarium) tile proxy — AWS elevation tiles
router.get('/dem/:z/:x/:y.png', async (req, res) => {
  try {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);
    const cacheKey = `dem/${z}/${x}/${y}`;

    const cached = demCacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached);
    }

    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('DEM tile error');

    const buf = Buffer.from(await response.arrayBuffer());
    demCacheSet(cacheKey, buf);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    res.status(502).send('DEM proxy error');
  }
});

// Traffic flow tile cache (in-memory, short TTL for real-time data)
const trafficCache = new Map();
const TRAFFIC_CACHE_MAX = 500;
const TRAFFIC_CACHE_TTL = 2 * 60 * 1000; // 2 minutes (real-time data)

function trafficCacheGet(key) {
  const entry = trafficCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TRAFFIC_CACHE_TTL) { trafficCache.delete(key); return null; }
  return entry.buf;
}

function trafficCacheSet(key, buf) {
  if (trafficCache.size >= TRAFFIC_CACHE_MAX) {
    const oldest = trafficCache.keys().next().value;
    trafficCache.delete(oldest);
  }
  trafficCache.set(key, { buf, ts: Date.now() });
}

// Traffic flow WMS proxy — XYZ tile endpoint (Vegvesen has no CORS)
router.get('/traffic/:z/:x/:y.png', async (req, res) => {
  try {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);
    const cacheKey = `traffic/${z}/${x}/${y}`;

    const cached = trafficCacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=60');
      return res.send(cached);
    }

    const { xMin, yMin, xMax, yMax } = tileToBBox3857(z, x, y);
    const url = 'https://ogckart-sn1.atlas.vegvesen.no/wms'
      + '?service=WMS&version=1.1.1&request=GetMap'
      + '&layers=trafikkflyt_1_0:Trafikkflyt'
      + '&styles=&format=image/png&transparent=true'
      + '&srs=EPSG:3857'
      + `&bbox=${xMin},${yMin},${xMax},${yMax}`
      + '&width=256&height=256';

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('WMS error');

    const buf = Buffer.from(await response.arrayBuffer());
    trafficCacheSet(cacheKey, buf);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(buf);
  } catch {
    res.status(502).send('Traffic proxy error');
  }
});

// Snow depth tile cache (in-memory, key = "z/x/y", max 2000 entries, 1h TTL)
const snowCache = new Map();
const SNOW_CACHE_MAX = 2000;
const SNOW_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function snowCacheGet(key) {
  const entry = snowCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SNOW_CACHE_TTL) { snowCache.delete(key); return null; }
  return entry.buf;
}

function snowCacheSet(key, buf) {
  if (snowCache.size >= SNOW_CACHE_MAX) {
    const oldest = snowCache.keys().next().value;
    snowCache.delete(oldest);
  }
  snowCache.set(key, { buf, ts: Date.now() });
}

// Resolve today's snow depth raster OBJECTID (cached, refreshed hourly)
let snowRasterInfo = { objectId: null, date: null, ts: 0 };

async function getTodaySnowRaster() {
  if (snowRasterInfo.objectId && Date.now() - snowRasterInfo.ts < SNOW_CACHE_TTL) {
    return snowRasterInfo;
  }
  try {
    const today = new Date();
    const name = `sd_${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}_${String(today.getDate()).padStart(2, '0')}`;
    // Try today first, fall back to most recent before today
    let url = 'https://gis3.nve.no/image/rest/services/seNorgeGrid/sd/ImageServer/query'
      + `?where=Name%3D%27${name}%27&outFields=Name,OBJECTID&returnGeometry=false&f=json`;
    let resp = await fetch(url);
    let data = resp.ok ? await resp.json() : null;
    let feature = data?.features?.[0];

    if (!feature) {
      // Today's raster not yet available — get most recent before today
      url = 'https://gis3.nve.no/image/rest/services/seNorgeGrid/sd/ImageServer/query'
        + `?where=Name%3C%3D%27${name}%27&outFields=Name,OBJECTID&returnGeometry=false`
        + '&resultRecordCount=1&orderByFields=Name+DESC&f=json';
      resp = await fetch(url);
      data = resp.ok ? await resp.json() : null;
      feature = data?.features?.[0];
    }

    if (feature) {
      const match = feature.attributes.Name.match(/sd_(\d{4})_(\d{2})_(\d{2})/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
      snowRasterInfo = { objectId: feature.attributes.OBJECTID, date, ts: Date.now() };
    }
  } catch { /* keep previous cache */ }
  return snowRasterInfo;
}

// Snow depth (seNorge) ImageServer proxy — XYZ tile endpoint
router.get('/snowdepth/:z/:x/:y.png', async (req, res) => {
  try {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);
    const cacheKey = `${z}/${x}/${y}`;

    const cached = snowCacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    const raster = await getTodaySnowRaster();
    const { latMin, lonMin, latMax, lonMax } = tileToBBox4326(z, x, y);
    let url = 'https://gis3.nve.no/image/rest/services/seNorgeGrid/sd/ImageServer/exportImage'
      + `?bbox=${lonMin},${latMin},${lonMax},${latMax}`
      + '&bboxSR=4326&size=256,256&format=png32&f=image&transparent=true'
      + '&interpolation=RSP_NearestNeighbor';
    if (raster.objectId) {
      const rule = JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [raster.objectId] });
      url += '&mosaicRule=' + encodeURIComponent(rule);
    }
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('ImageServer error');
    const srcBuffer = Buffer.from(await response.arrayBuffer());

    // Make black (ocean/no-data) pixels transparent — threshold low to preserve #000080
    const { data, info } = await sharp(srcBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 5 && data[i + 1] < 5 && data[i + 2] < 5) {
        data[i + 3] = 0; // set alpha to 0
      }
    }
    const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    snowCacheSet(cacheKey, buf);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(502).send('Snow depth proxy error');
  }
});

// Snow depth date — returns the date of the currently displayed raster
router.get('/snowdepth-date', async (_req, res) => {
  try {
    const raster = await getTodaySnowRaster();
    res.json({ date: raster.date, source: 'NVE / seNorge' });
  } catch {
    res.json({ date: null, source: 'NVE / seNorge' });
  }
});

// Snow depth point query — returns depth category for a lat/lon
const SNOW_DEPTH_COLORS = [
  { r: 204, g: 255, b: 102, label: { no: 'Barmark', en: 'Bare ground' }, range: '0' },
  { r: 170, g: 255, b: 255, label: { no: 'Under 25 cm', en: 'Under 25 cm' }, range: '<25' },
  { r: 0,   g: 255, b: 255, label: { no: '25–50 cm', en: '25–50 cm' }, range: '25-50' },
  { r: 0,   g: 170, b: 255, label: { no: '50–100 cm', en: '50–100 cm' }, range: '50-100' },
  { r: 0,   g: 85,  b: 255, label: { no: '100–150 cm', en: '100–150 cm' }, range: '100-150' },
  { r: 0,   g: 0,   b: 255, label: { no: '150–200 cm', en: '150–200 cm' }, range: '150-200' },
  { r: 0,   g: 0,   b: 204, label: { no: '200–400 cm', en: '200–400 cm' }, range: '200-400' },
  { r: 0,   g: 0,   b: 128, label: { no: 'Over 400 cm', en: 'Over 400 cm' }, range: '>400' },
];

function matchSnowColor(r, g, b) {
  if (r < 5 && g < 5 && b < 5) return null; // black = no data
  let best = null, bestDist = Infinity;
  for (const c of SNOW_DEPTH_COLORS) {
    const dist = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best;
}

router.get('/snowdepth-at', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    const raster = await getTodaySnowRaster();
    const d = 0.005; // ~500m bbox around point
    let url = 'https://gis3.nve.no/image/rest/services/seNorgeGrid/sd/ImageServer/exportImage'
      + `?bbox=${lon - d},${lat - d},${parseFloat(lon) + d},${parseFloat(lat) + d}`
      + '&bboxSR=4326&size=1,1&format=png32&f=image&transparent=true'
      + '&interpolation=RSP_NearestNeighbor';
    if (raster.objectId) {
      const rule = JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [raster.objectId] });
      url += '&mosaicRule=' + encodeURIComponent(rule);
    }
    const response = await fetch(url);
    if (!response.ok) return res.json({ depth: null });
    const buf = Buffer.from(await response.arrayBuffer());
    const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const match = matchSnowColor(data[0], data[1], data[2]);
    if (!match || data[3] < 10) return res.json({ depth: null });
    res.json({ depth: match.range, label: match.label, date: raster.date });
  } catch {
    res.json({ depth: null });
  }
});

// CartoDB dark tile cache (for mini-map export)
const cartoCache = new Map();
const CARTO_CACHE_MAX = 1000;
const CARTO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function cartoCacheGet(key) {
  const entry = cartoCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CARTO_CACHE_TTL) { cartoCache.delete(key); return null; }
  return entry.buf;
}

function cartoCacheSet(key, buf) {
  if (cartoCache.size >= CARTO_CACHE_MAX) {
    const oldest = cartoCache.keys().next().value;
    cartoCache.delete(oldest);
  }
  cartoCache.set(key, { buf, ts: Date.now() });
}

// Static map image generator — combines tiles into a single image
router.get('/static-map', async (req, res) => {
  try {
    const { lat, lng, zoom, width, height } = req.query;
    const centerLat = parseFloat(lat);
    const centerLng = parseFloat(lng);
    const z = Math.min(18, Math.max(0, parseInt(zoom) || 11));
    const w = Math.min(2000, Math.max(100, parseInt(width) || 600));
    const h = Math.min(2000, Math.max(100, parseInt(height) || 400));

    if (isNaN(centerLat) || isNaN(centerLng)) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    const tileSize = 256;
    const scale = Math.pow(2, z);

    // Convert center to pixel coordinates
    const centerX = ((centerLng + 180) / 360) * scale * tileSize;
    const latRad = centerLat * Math.PI / 180;
    const centerY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale * tileSize;

    // Calculate tile range needed
    const halfW = w / 2;
    const halfH = h / 2;
    const minTileX = Math.floor((centerX - halfW) / tileSize);
    const maxTileX = Math.floor((centerX + halfW) / tileSize);
    const minTileY = Math.floor((centerY - halfH) / tileSize);
    const maxTileY = Math.floor((centerY + halfH) / tileSize);

    // Tile images are @2x, so actual tile size is 512
    const actualTileSize = 512;
    const numTilesX = maxTileX - minTileX + 1;
    const numTilesY = maxTileY - minTileY + 1;

    // Fetch all needed tiles and organize by row
    const tileGrid = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const rowPromises = [];
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const subdomain = ['a', 'b', 'c'][(tx + ty) % 3];
        const url = `https://${subdomain}.basemaps.cartocdn.com/dark_all/${z}/${tx}/${ty}@2x.png`;
        rowPromises.push(
          fetch(url)
            .then(r => r.ok ? r.arrayBuffer() : null)
            .then(buf => buf ? sharp(Buffer.from(buf)).resize(actualTileSize, actualTileSize).png().toBuffer() : null)
            .catch(() => null)
        );
      }
      tileGrid.push(Promise.all(rowPromises));
    }

    const rows = await Promise.all(tileGrid);

    // Create placeholder for missing tiles
    const placeholder = await sharp({
      create: { width: actualTileSize, height: actualTileSize, channels: 4, background: { r: 30, g: 41, b: 59, alpha: 1 } }
    }).png().toBuffer();

    // Join tiles horizontally for each row, then vertically
    const rowImages = await Promise.all(rows.map(async (row) => {
      const tiles = row.map(t => t || placeholder);
      if (tiles.length === 1) return tiles[0];
      // Join horizontally
      const first = tiles[0];
      const rest = tiles.slice(1).map(t => ({ input: t, gravity: 'east' }));
      return sharp(first)
        .extend({ right: actualTileSize * (tiles.length - 1), background: { r: 30, g: 41, b: 59, alpha: 1 } })
        .composite(rest.map((t, i) => ({ input: t.input, left: actualTileSize * (i + 1), top: 0 })))
        .png()
        .toBuffer();
    }));

    // Join rows vertically
    let compositeImage;
    if (rowImages.length === 1) {
      compositeImage = rowImages[0];
    } else {
      const first = rowImages[0];
      compositeImage = await sharp(first)
        .extend({ bottom: actualTileSize * (rowImages.length - 1), background: { r: 30, g: 41, b: 59, alpha: 1 } })
        .composite(rowImages.slice(1).map((img, i) => ({ input: img, left: 0, top: actualTileSize * (i + 1) })))
        .png()
        .toBuffer();
    }

    // Calculate crop region centered on our point
    const compositeWidth = numTilesX * actualTileSize;
    const compositeHeight = numTilesY * actualTileSize;
    const centerInCompositeX = (centerX - minTileX * tileSize) * 2;
    const centerInCompositeY = (centerY - minTileY * tileSize) * 2;
    const extractLeft = Math.max(0, Math.round(centerInCompositeX - w));
    const extractTop = Math.max(0, Math.round(centerInCompositeY - h));
    const extractWidth = Math.min(w * 2, compositeWidth - extractLeft);
    const extractHeight = Math.min(h * 2, compositeHeight - extractTop);

    if (extractWidth <= 0 || extractHeight <= 0) {
      return res.status(400).json({ error: 'Invalid extract dimensions' });
    }

    const result = await sharp(compositeImage)
      .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
      .resize(w, h)
      .png()
      .toBuffer();

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result);
  } catch (err) {
    console.error('Static map error:', err);
    res.status(500).json({ error: 'Static map generation failed' });
  }
});

// CartoDB dark tiles proxy — enables canvas export without CORS issues
router.get('/carto-dark/:z/:x/:y.png', async (req, res) => {
  try {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);
    const cacheKey = `carto/${z}/${x}/${y}`;

    const cached = cartoCacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached);
    }

    // Use one of the CartoDB subdomains
    const subdomain = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
    const url = `https://${subdomain}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`;

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('Tile fetch error');

    const buf = Buffer.from(await response.arrayBuffer());
    cartoCacheSet(cacheKey, buf);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    res.status(502).send('CartoDB proxy error');
  }
});

export default router;
