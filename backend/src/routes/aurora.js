import { Router } from 'express';

const router = Router();

// NOAA Aurora/Kp endpoints
const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

// Cache
let auroraCache = { data: null, ts: 0 };
let kpForecastCache = { data: null, ts: 0 };
const AURORA_TTL = 15 * 60 * 1000; // 15 minutes
const KP_TTL = 30 * 60 * 1000; // 30 minutes

// Aurora probability level mapping (0-100% scale)
function getIntensityLevel(value) {
  if (value < 10) return { level: 'none', en: 'None', no: 'Ingen' };
  if (value < 30) return { level: 'low', en: 'Low', no: 'Lav' };
  if (value < 60) return { level: 'moderate', en: 'Moderate', no: 'Moderat' };
  return { level: 'high', en: 'High', no: 'Høy' };
}

// Kp activity mapping
function getKpActivity(kp) {
  if (kp < 2) return { level: 'quiet', en: 'Quiet', no: 'Rolig' };
  if (kp < 4) return { level: 'unsettled', en: 'Unsettled', no: 'Ustabil' };
  if (kp < 5) return { level: 'active', en: 'Active', no: 'Aktiv' };
  if (kp < 6) return { level: 'minor_storm', en: 'Minor Storm', no: 'Mindre storm' };
  if (kp < 8) return { level: 'moderate_storm', en: 'Moderate Storm', no: 'Moderat storm' };
  return { level: 'severe_storm', en: 'Severe Storm', no: 'Kraftig storm' };
}

// Aurora visibility latitude based on Kp
function getAuroraLatitude(kp) {
  // Approximate latitude where aurora becomes visible
  const latitudes = [70, 68, 66, 65, 63, 60, 57, 54, 50, 45];
  return latitudes[Math.min(Math.floor(kp), 9)];
}

async function fetchAuroraData() {
  if (auroraCache.data && Date.now() - auroraCache.ts < AURORA_TTL) {
    return auroraCache.data;
  }

  const res = await fetch(OVATION_URL);
  if (!res.ok) throw new Error(`NOAA OVATION API ${res.status}`);
  const raw = await res.json();

  // OVATION data format: { Observation Time, Forecast Time, Data Products: [...], coordinates: [[lon, lat, intensity], ...] }
  const coords = raw.coordinates || [];

  // Build GeoJSON with points for heatmap layer
  const features = [];
  for (const [lon, lat, intensity] of coords) {
    // Filter: only visible aurora (intensity > 3) and Northern Hemisphere (lat > 50)
    if (intensity <= 3 || lat < 50) continue;

    // NOAA OVATION uses 0-360 longitude, convert to -180 to 180
    const normLon = lon > 180 ? lon - 360 : lon;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [normLon, lat],
      },
      properties: {
        intensity,
        ...getIntensityLevel(intensity),
      },
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    features,
    meta: {
      observationTime: raw['Observation Time'],
      forecastTime: raw['Forecast Time'],
      fetchedAt: new Date().toISOString(),
    },
  };

  auroraCache = { data: geojson, ts: Date.now() };
  return geojson;
}

async function fetchKpForecast() {
  if (kpForecastCache.data && Date.now() - kpForecastCache.ts < KP_TTL) {
    return kpForecastCache.data;
  }

  const res = await fetch(KP_FORECAST_URL);
  if (!res.ok) throw new Error(`NOAA Kp API ${res.status}`);
  const raw = await res.json();

  // Format: [["time_tag", "kp", "observed", "noaa_scale"], [...], ...]
  // First row is header, rest is data
  const rows = raw.slice(1).map((row) => ({
    time: row[0],
    kp: parseFloat(row[1]),
    observed: row[2], // "observed", "estimated", or "predicted"
    noaaScale: row[3], // e.g., "G1" for storm levels
  }));

  // Find current Kp (most recent observed/estimated)
  const now = new Date();
  let currentKp = null;
  let currentEntry = null;
  for (const entry of rows) {
    const entryTime = new Date(entry.time);
    if (entryTime <= now) {
      currentKp = entry.kp;
      currentEntry = entry;
    }
  }

  // Get forecasts for different time offsets
  const getKpAtOffset = (hoursOffset) => {
    const targetTime = new Date(now.getTime() + hoursOffset * 60 * 60 * 1000);
    let best = null;
    let bestDiff = Infinity;
    for (const entry of rows) {
      const entryTime = new Date(entry.time);
      const diff = Math.abs(entryTime - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = entry;
      }
    }
    return best;
  };

  // Get daily average Kp for tomorrow and day after
  const getDailyAverage = (daysOffset) => {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysOffset);
    const dayStr = targetDate.toISOString().slice(0, 10);

    const dayEntries = rows.filter((e) => e.time.startsWith(dayStr));
    if (dayEntries.length === 0) return null;

    const avgKp = dayEntries.reduce((sum, e) => sum + e.kp, 0) / dayEntries.length;
    const maxKp = Math.max(...dayEntries.map((e) => e.kp));
    return { avgKp, maxKp, count: dayEntries.length };
  };

  const result = {
    current: currentKp,
    currentActivity: currentKp != null ? getKpActivity(currentKp) : null,
    currentEntry,
    forecasts: {
      plus1h: getKpAtOffset(1),
      plus3h: getKpAtOffset(3),
      tomorrow: getDailyAverage(1),
      dayAfter: getDailyAverage(2),
    },
    // 24-hour forecast for chart (starting from current time, not beginning of data)
    hourly: (() => {
      let startIdx = 0;
      for (let i = 0; i < rows.length; i++) {
        if (new Date(rows[i].time) <= now) startIdx = i;
        else break;
      }
      return rows.slice(startIdx, startIdx + 24);
    })().map((e) => ({
      time: e.time,
      kp: e.kp,
      activity: getKpActivity(e.kp),
    })),
    auroraLatitude: currentKp != null ? getAuroraLatitude(currentKp) : null,
    fetchedAt: new Date().toISOString(),
  };

  kpForecastCache = { data: result, ts: Date.now() };
  return result;
}

// Fetch raw OVATION data (for grid endpoint)
async function fetchRawOvation() {
  // Return raw data without caching transform
  const res = await fetch(OVATION_URL);
  if (!res.ok) throw new Error(`NOAA OVATION API ${res.status}`);
  return res.json();
}

// GET /api/aurora - Full aurora grid GeoJSON
router.get('/', async (req, res) => {
  try {
    const data = await fetchAuroraData();
    res.json(data);
  } catch (err) {
    console.error('Aurora fetch error:', err);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/aurora/grid - Structured grid for canvas interpolation
router.get('/grid', async (req, res) => {
  try {
    const raw = await fetchRawOvation();
    const coords = raw.coordinates || [];

    // OVATION data is 1° resolution from -180 to 180 lon, 0 to 90 lat
    // Filter to Northern Hemisphere aurora zone (lat > 50)
    const minLat = 50, maxLat = 90;
    const minLon = -180, maxLon = 180;
    const latStep = 1, lonStep = 1;

    const latSize = (maxLat - minLat) / latStep + 1; // 41 rows
    const lonSize = (maxLon - minLon) / lonStep + 1; // 361 columns

    // Build 2D grid array
    const grid = new Array(latSize * lonSize).fill(0);

    for (const [lon, lat, intensity] of coords) {
      if (lat < minLat || lat > maxLat) continue;
      // NOAA OVATION uses 0-360 longitude, convert to -180 to 180
      const normLon = lon > 180 ? lon - 360 : lon;
      const latIdx = Math.round((lat - minLat) / latStep);
      const lonIdx = Math.round((normLon - minLon) / lonStep);
      if (latIdx >= 0 && latIdx < latSize && lonIdx >= 0 && lonIdx < lonSize) {
        grid[latIdx * lonSize + lonIdx] = intensity;
      }
    }

    res.json({
      bounds: { north: maxLat, south: minLat, east: maxLon, west: minLon },
      gridSize: { lat: latSize, lon: lonSize },
      data: grid,
      meta: {
        observationTime: raw['Observation Time'],
        forecastTime: raw['Forecast Time'],
      },
    });
  } catch (err) {
    console.error('Aurora grid fetch error:', err);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/aurora/kp - Current + forecast Kp index
router.get('/kp', async (req, res) => {
  try {
    const data = await fetchKpForecast();
    res.json(data);
  } catch (err) {
    console.error('Kp fetch error:', err);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/aurora/at?lat=X&lon=X - Point lookup for context menu
router.get('/at', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon required' });
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    // Fetch both aurora grid and Kp data
    const [auroraData, kpData] = await Promise.all([
      fetchAuroraData(),
      fetchKpForecast(),
    ]);

    // Find nearest point
    let nearestIntensity = 0;
    let nearestDist = Infinity;

    for (const feature of auroraData.features) {
      const [ptLon, ptLat] = feature.geometry.coordinates;

      const dist = Math.sqrt(
        Math.pow(ptLon - lonNum, 2) + Math.pow(ptLat - latNum, 2)
      );

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIntensity = feature.properties.intensity;
      }
    }

    // If point is too far from any aurora data (> 2 degrees), it's outside forecast area
    const isOutside = nearestDist > 2;

    const level = getIntensityLevel(nearestIntensity);

    res.json({
      intensity: isOutside ? 0 : nearestIntensity,
      ...level,
      kp: kpData.current,
      kpActivity: kpData.currentActivity,
      auroraLatitude: kpData.auroraLatitude,
      isOutside,
    });
  } catch (err) {
    console.error('Aurora at-point error:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
