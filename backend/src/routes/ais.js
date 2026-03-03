import { Router } from 'express';
import { getBarentsWatchClientId, getBarentsWatchClientSecret } from '../config.js';

const router = Router();

// --- OAuth2 token management ---
let accessToken = null;
let tokenExpiry = 0;
let tokenPromise = null; // promise-lock to prevent concurrent refreshes

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  // If another request is already refreshing, wait for it
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const clientId = getBarentsWatchClientId();
    const clientSecret = getBarentsWatchClientSecret();
    if (!clientId || !clientSecret) {
      throw new Error('BarentsWatch credentials not configured');
    }

    // Try 'ais' scope first, fall back to 'api', then no scope
    let res;
    for (const scope of ['ais', 'api', '']) {
      const params = {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      };
      if (scope) params.scope = scope;

      res = await fetch('https://id.barentswatch.no/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) break;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`BarentsWatch token error ${res.status}: ${text}`);
    }

    const data = await res.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return accessToken;
  })();

  try {
    const token = await tokenPromise;
    return token;
  } finally {
    tokenPromise = null;
  }
}

// --- Vessel positions cache ---
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

// Ship type category from first digit of shipType code
function getShipTypeCategory(shipType) {
  if (shipType == null) return 'Other';
  const code = Number(shipType);
  if (code === 30) return 'Fishing';
  if (code === 36 || code === 37) return 'Sailing/Pleasure';
  const firstDigit = Math.floor(code / 10);
  switch (firstDigit) {
    case 4: return 'High-speed';
    case 6: return 'Passenger';
    case 7: return 'Cargo';
    case 8: return 'Tanker';
    default: return 'Other';
  }
}

// Navigational status text
const NAV_STATUS_TEXT = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (HSC)',
  10: 'Reserved (WIG)',
  11: 'Power-driven towing astern',
  12: 'Power-driven pushing/towing',
  14: 'AIS-SART',
  15: 'Undefined',
};

router.get('/', async (req, res) => {
  try {
    const south = parseFloat(req.query.south);
    const north = parseFloat(req.query.north);
    const west = parseFloat(req.query.west);
    const east = parseFloat(req.query.east);

    if (isNaN(south) || isNaN(north) || isNaN(west) || isNaN(east)) {
      return res.status(400).json({ error: 'south, north, west, east are required' });
    }

    // Refresh cache if stale
    if (!cachedData || Date.now() - cacheTime > CACHE_TTL) {
      const token = await getAccessToken();
      const apiRes = await fetch('https://live.ais.barentswatch.no/v1/latest/combined', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!apiRes.ok) {
        throw new Error(`BarentsWatch AIS ${apiRes.status}`);
      }

      const vessels = await apiRes.json();
      cachedData = vessels;
      cacheTime = Date.now();
    }

    // Filter by bbox and map to GeoJSON
    const features = [];
    for (const v of cachedData) {
      const lat = v.latitude;
      const lon = v.longitude;
      if (lat == null || lon == null) continue;
      if (lat < south || lat > north) continue;
      // Handle antimeridian: if west > east, accept lon >= west OR lon <= east
      if (west <= east) {
        if (lon < west || lon > east) continue;
      } else {
        if (lon < west && lon > east) continue;
      }

      const shipType = v.shipType;
      const category = getShipTypeCategory(shipType);

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          mmsi: v.mmsi,
          name: v.name || null,
          callSign: v.callSign || null,
          imoNumber: v.imoNumber || null,
          shipType: shipType,
          shipTypeCategory: category,
          speedOverGround: v.speedOverGround ?? null,
          courseOverGround: v.courseOverGround ?? null,
          trueHeading: v.trueHeading ?? null,
          navigationalStatus: v.navigationalStatus ?? null,
          navStatusText: NAV_STATUS_TEXT[v.navigationalStatus] || 'Unknown',
          destination: v.destination || null,
          eta: v.eta || null,
          draught: v.draught ?? null,
          shipLength: v.shipLength ?? null,
          shipWidth: v.shipWidth ?? null,
          countryCode: v.countryCode || null,
          military: shipType === 35,
          lawEnforcement: shipType === 55,
        },
      });
    }

    res.json({
      type: 'FeatureCollection',
      meta: { total: features.length, fetchedAt: new Date().toISOString() },
      features,
    });
  } catch (err) {
    console.error('AIS API error:', err.message);
    if (cachedData) {
      // Return stale cache on error
      return res.json({
        type: 'FeatureCollection',
        meta: { total: 0, fetchedAt: new Date().toISOString() },
        features: [],
      });
    }
    res.status(502).json({ error: err.message });
  }
});

// --- Trace endpoint: vessel historical track ---
const traceCache = new Map();
const TRACE_CACHE_TTL = 120000; // 2 minutes
const TRACE_CACHE_MAX = 100;

router.get('/trace/:mmsi', async (req, res) => {
  const mmsi = req.params.mmsi;
  if (!/^\d{9}$/.test(mmsi)) {
    return res.status(400).json({ error: 'Invalid MMSI — must be 9 digits' });
  }

  const cached = traceCache.get(mmsi);
  if (cached && Date.now() - cached.time < TRACE_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const token = await getAccessToken();

    // 3-day window
    const now = new Date();
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString();
    const toStr = now.toISOString();

    const apiRes = await fetch(
      `https://historic.ais.barentswatch.no/v1/historic/tracks/${mmsi}/${fromStr}/${toStr}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (apiRes.status === 404) {
      return res.status(404).json({ error: 'No track data for this vessel' });
    }
    if (!apiRes.ok) {
      throw new Error(`BarentsWatch track ${apiRes.status}`);
    }

    const points = await apiRes.json();

    // Build LineString from points, preserving timestamp/speed data for deep analysis
    const trackPoints = [];
    for (const pt of points) {
      if (pt.latitude != null && pt.longitude != null) {
        trackPoints.push({
          coordinates: [pt.longitude, pt.latitude],
          timestamp: pt.msgtime,
          speed: pt.speedOverGround ?? null,
          course: pt.courseOverGround ?? null,
          heading: pt.trueHeading ?? null,
        });
      }
    }

    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trackPoints.map(p => p.coordinates),
      },
      properties: {
        mmsi,
        pointCount: trackPoints.length,
        trackPoints, // Full data for deep analysis
      },
    };

    // Evict oldest if at capacity
    if (traceCache.size >= TRACE_CACHE_MAX) {
      const oldest = traceCache.keys().next().value;
      traceCache.delete(oldest);
    }
    traceCache.set(mmsi, { data: geojson, time: Date.now() });

    res.json(geojson);
  } catch (err) {
    console.error('AIS trace error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// --- Vessel details endpoint: enriched data from myshiptracking.com ---
const vesselDetailsCache = new Map();
const VESSEL_DETAILS_TTL = 300000; // 5 minutes

router.get('/vessel/:mmsi', async (req, res) => {
  const mmsi = req.params.mmsi;
  if (!/^\d{9}$/.test(mmsi)) {
    return res.status(400).json({ error: 'Invalid MMSI — must be 9 digits' });
  }

  // Check cache
  const cached = vesselDetailsCache.get(mmsi);
  if (cached && Date.now() - cached.time < VESSEL_DETAILS_TTL) {
    return res.json(cached.data);
  }

  try {
    const apiRes = await fetch(
      `https://www.myshiptracking.com/requests/vesseldetailsTEST.php?type=json&mmsi=${mmsi}&return=&lang=`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!apiRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch vessel details' });
    }

    const data = await apiRes.json();

    // Cache result (evict oldest if at capacity)
    if (vesselDetailsCache.size >= 100) {
      const oldest = vesselDetailsCache.keys().next().value;
      vesselDetailsCache.delete(oldest);
    }
    vesselDetailsCache.set(mmsi, { data, time: Date.now() });

    res.json(data);
  } catch (err) {
    console.error('Vessel details error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
