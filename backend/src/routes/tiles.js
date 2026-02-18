import { Router } from 'express';

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

    const url = 'https://nve.geodataonline.no/arcgis/services/SkredSnoForsvaret/MapServer/WMSServer'
      + '?service=WMS&request=GetMap&version=1.3.0'
      + '&layers=Utlosningsomrade,Utlopsomrade&styles=&crs=EPSG:4326'
      + `&bbox=${wmsBbox}&width=256&height=256`
      + '&format=image/png&transparent=true';

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('WMS error');

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).send('Avalanche proxy error');
  }
});

// Avalanche data source info (NVE does not expose a usable update date)
router.get('/avalanche-date', (_req, res) => {
  res.json({ date: null, source: 'NVE / NGU' });
});

export default router;
