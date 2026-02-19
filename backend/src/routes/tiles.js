import { Router } from 'express';
import sharp from 'sharp';

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
      return res.json({ elevation: data.punkter?.[0]?.z ?? data.hoyde ?? null });
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

export default router;
