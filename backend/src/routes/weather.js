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

// Wind grid — MET Norway for surface (10m), Open-Meteo for higher altitudes
const ALTITUDE_PRESETS = {
  '10':    { source: 'met' },
  '80':    { source: 'openmeteo', speedKey: 'wind_speed_80m',     dirKey: 'wind_direction_80m' },
  '180':   { source: 'openmeteo', speedKey: 'wind_speed_180m',    dirKey: 'wind_direction_180m' },
  'FL50':  { source: 'openmeteo', speedKey: 'wind_speed_850hPa',  dirKey: 'wind_direction_850hPa' },
  'FL100': { source: 'openmeteo', speedKey: 'wind_speed_700hPa',  dirKey: 'wind_direction_700hPa' },
  'FL180': { source: 'openmeteo', speedKey: 'wind_speed_500hPa',  dirKey: 'wind_direction_500hPa' },
};

// Current hour index in the Open-Meteo hourly array (Europe/Oslo)
function getCurrentHourIndex() {
  const now = new Date();
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  return oslo.getHours();
}

// Fetch Open-Meteo wind for multiple points in a single batched request
async function fetchOpenMeteoBatch(points, preset, altKey) {
  const { speedKey, dirKey } = preset;
  const cacheKey = `wind-batch-${altKey}-${points.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const lats = points.map(p => p.lat.toFixed(4)).join(',');
  const lons = points.map(p => p.lon.toFixed(4)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${speedKey},${dirKey}&wind_speed_unit=ms&forecast_days=1&timezone=auto`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
  const data = await resp.json();
  // Single point returns an object, multiple returns an array
  const arr = Array.isArray(data) ? data : [data];
  cache.set(cacheKey, { data: arr, ts: Date.now() });
  return arr;
}

router.get('/wind-grid', async (req, res) => {
  try {
    const { north, south, east, west } = req.query;
    if (!north || !south || !east || !west) {
      return res.status(400).json({ error: 'Bounds required: north, south, east, west' });
    }

    const altKey = ALTITUDE_PRESETS[req.query.altitude] ? req.query.altitude : '10';
    const preset = ALTITUDE_PRESETS[altKey];

    // Clamp to Norway's geographic extent so grid points aren't wasted over ocean/abroad
    const n = Math.min(parseFloat(north), 71.5);
    const s = Math.max(parseFloat(south), 57.5);
    const e = Math.min(parseFloat(east), 32);
    const w = Math.max(parseFloat(west), 4);
    const gridSize = 20;
    const latStep = (n - s) / (gridSize - 1);
    const lonStep = (e - w) / (gridSize - 1);

    const points = [];
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        points.push({ lat: s + i * latStep, lon: w + j * lonStep });
      }
    }

    let results;

    if (preset.source === 'met') {
      // MET Norway: per-point requests with concurrency limit
      results = [];
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
                lat: pt.lat, lon: pt.lon,
                u: -speed * Math.sin(dirRad), v: -speed * Math.cos(dirRad),
                speed, direction: dir,
              };
            } catch {
              return { lat: pt.lat, lon: pt.lon, u: 0, v: 0, speed: 0, direction: 0 };
            }
          })
        );
        results.push(...batchResults);
      }
    } else {
      // Open-Meteo: batched multi-coordinate requests (max ~80 per request to stay within URL limits)
      const { speedKey, dirKey } = preset;
      const hourIdx = getCurrentHourIndex();
      results = [];
      const batchSize = 80;
      for (let b = 0; b < points.length; b += batchSize) {
        const batch = points.slice(b, b + batchSize);
        try {
          const arr = await fetchOpenMeteoBatch(batch, preset, altKey);
          for (let i = 0; i < batch.length; i++) {
            const loc = arr[i];
            const speed = loc?.hourly?.[speedKey]?.[hourIdx] ?? 0;
            const dir = loc?.hourly?.[dirKey]?.[hourIdx] ?? 0;
            const dirRad = (dir * Math.PI) / 180;
            results.push({
              lat: batch[i].lat, lon: batch[i].lon,
              u: -speed * Math.sin(dirRad), v: -speed * Math.cos(dirRad),
              speed, direction: dir,
            });
          }
        } catch {
          // Fill batch with zeros on failure
          for (const pt of batch) {
            results.push({ lat: pt.lat, lon: pt.lon, u: 0, v: 0, speed: 0, direction: 0 });
          }
        }
      }
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
