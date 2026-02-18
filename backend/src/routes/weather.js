import { Router } from 'express';
import config from '../config.js';

const router = Router();
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

async function metFetch(url) {
  const cached = getCached(url);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: { 'User-Agent': config.metUserAgent },
  });
  if (!res.ok) throw new Error(`MET API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data;
}

// Forecast
router.get('/forecast', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;
    const data = await metFetch(url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Sun
router.get('/sun', async (req, res) => {
  try {
    const { lat, lon, date } = req.query;
    const d = date || new Date().toISOString().slice(0, 10);
    const url = `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${lat}&lon=${lon}&date=${d}`;
    const data = await metFetch(url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Moon
router.get('/moon', async (req, res) => {
  try {
    const { lat, lon, date } = req.query;
    const d = date || new Date().toISOString().slice(0, 10);
    const url = `https://api.met.no/weatherapi/sunrise/3.0/moon?lat=${lat}&lon=${lon}&date=${d}`;
    const data = await metFetch(url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Wind grid
router.get('/wind-grid', async (req, res) => {
  try {
    const { north, south, east, west } = req.query;
    if (!north || !south || !east || !west) {
      return res.status(400).json({ error: 'Bounds required: north, south, east, west' });
    }

    const n = parseFloat(north), s = parseFloat(south);
    const e = parseFloat(east), w = parseFloat(west);
    const gridSize = 20;
    const latStep = (n - s) / (gridSize - 1);
    const lonStep = (e - w) / (gridSize - 1);

    const points = [];
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        points.push({ lat: s + i * latStep, lon: w + j * lonStep });
      }
    }

    // Fetch wind data for each point (with concurrency limit)
    const results = [];
    const batchSize = 10;
    for (let b = 0; b < points.length; b += batchSize) {
      const batch = points.slice(b, b + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (pt) => {
          try {
            const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${pt.lat.toFixed(4)}&lon=${pt.lon.toFixed(4)}`;
            const data = await metFetch(url);
            const ts = data?.properties?.timeseries?.[0];
            const details = ts?.data?.instant?.details || {};
            const speed = details.wind_speed || 0;
            const dir = details.wind_from_direction || 0;
            const dirRad = (dir * Math.PI) / 180;
            return {
              lat: pt.lat,
              lon: pt.lon,
              u: -speed * Math.sin(dirRad),
              v: -speed * Math.cos(dirRad),
              speed,
              direction: dir,
            };
          } catch {
            return { lat: pt.lat, lon: pt.lon, u: 0, v: 0, speed: 0, direction: 0 };
          }
        })
      );
      results.push(...batchResults);
    }

    res.json({
      gridSize,
      bounds: { north: n, south: s, east: e, west: w },
      data: results,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
