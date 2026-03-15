import { Router } from 'express';
import * as fzstd from 'fzstd';

const router = Router();

// ADS-B Exchange cache/backoff state
let adsbxCachedFeatures = null;
let adsbxCacheTime = 0;
let adsbxLastFetch = 0;
let adsbxBackoffUntil = 0;

// airplanes.live cache/backoff state
let aplCachedFeatures = [];
let aplCacheTime = 0;
let aplLastFetch = 0;
let aplBackoffUntil = 0;

// Merged response cache
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 15000; // 15 seconds
const MIN_FETCH_INTERVAL = 3000; // 3 seconds between upstream requests

/**
 * Decode binCraft binary format from ADS-B Exchange.
 * Ported from tar1090 formatter.js wqi() function.
 */
function decodeBinCraft(decompressed) {
  // fzstd may return a Uint8Array with non-zero byteOffset — copy to a clean buffer
  const buffer = new ArrayBuffer(decompressed.byteLength);
  new Uint8Array(buffer).set(decompressed);

  const headerU32 = new Uint32Array(buffer, 0, 13);
  const stride = headerU32[2]; // bytes per record (typically 112)
  const binCraftVersion = headerU32[10];

  const aircraft = [];
  for (let off = stride; off + stride <= buffer.byteLength; off += stride) {
    const s32 = new Int32Array(buffer, off, stride / 4);
    const u16 = new Uint16Array(buffer, off, stride / 2);
    const s16 = new Int16Array(buffer, off, stride / 2);
    const u8 = new Uint8Array(buffer, off, stride);

    // Validity bits (u8[73..75]) gate each field
    const v73 = u8[73];
    const v74 = u8[74];

    // Position validity: bit 6 of u8[73]
    if (!(v73 & 64)) continue;

    // ICAO hex: s32[0] & 0xFFFFFF
    const hex = (s32[0] & 0xFFFFFF).toString(16).padStart(6, '0');

    // Longitude: s32[2] / 1e6, Latitude: s32[3] / 1e6
    const lon = s32[2] / 1e6;
    const lat = s32[3] / 1e6;
    if (lat === 0 && lon === 0) continue;

    // Airground: u8[68] & 15 — 1 = ground
    const airground = u8[68] & 15;
    const onGround = airground === 1;

    // Baro altitude: s16[10] * 25 feet (gated by v73 bit 4)
    const altBaro = (v73 & 16) ? s16[10] * 25 : null;

    // Ground speed: s16[17] / 10 knots (gated by v73 bit 7)
    const gs = (v73 & 128) ? s16[17] / 10 : null;

    // Track: s16[20] / 90 degrees (gated by v74 bit 3)
    const track = (v74 & 8) ? s16[20] / 90 : null;

    // Squawk: u16[16] as hex
    const squawkRaw = u16[16];
    let squawk = null;
    if (squawkRaw > 0) {
      const s = squawkRaw.toString(16).padStart(4, '0');
      squawk = (s[0] > '9') ? String(parseInt(s[0], 16)) + s[1] + s[2] + s[3] : s;
    }

    // Category: u8[64] as hex string (e.g. 0xA7 -> "A7")
    const category = u8[64] ? u8[64].toString(16).toUpperCase() : null;

    // Emergency: u8[67] & 15
    const emergencyRaw = u8[67] & 15;
    const emergencyMap = ['none', 'general', 'lifeguard', 'minfuel', 'nordo', 'unlawful', 'downed', 'reserved'];
    const emergency = emergencyRaw > 0 ? (emergencyMap[emergencyRaw] || 'unknown') : null;

    // Callsign: u8[78..85] ASCII 8 bytes (gated by v73 bit 3)
    let callsign = null;
    if (v73 & 8) {
      callsign = '';
      for (let c = 78; c < 86; c++) {
        if (u8[c] === 0) break;
        callsign += String.fromCharCode(u8[c]);
      }
      callsign = callsign.trim() || null;
    }

    // Type code: u8[88..91] ASCII 4 bytes
    let typeCode = '';
    for (let c = 88; c < 92; c++) {
      if (u8[c] === 0) break;
      typeCode += String.fromCharCode(u8[c]);
    }
    typeCode = typeCode.trim() || null;

    // Registration: u8[92..103] ASCII 12 bytes
    let registration = '';
    for (let c = 92; c < 104; c++) {
      if (u8[c] === 0) break;
      registration += String.fromCharCode(u8[c]);
    }
    registration = registration.trim() || null;

    // dbFlags: u16[43] — bit 0 = military, bit 1 = special/government
    const dbFlags = u16[43];
    const military = !!(dbFlags & 1);
    const special = !!(dbFlags & 2);

    aircraft.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        hex,
        callsign,
        registration,
        type: typeCode,
        altBaro,
        groundSpeed: gs,
        track,
        squawk,
        military,
        special,
        helicopter: category === 'A7',
        onGround,
        emergency,
        category,
      },
    });
  }

  return aircraft;
}

/**
 * Convert bounding box to center point + radius in nautical miles for airplanes.live API.
 */
function bboxToCenterRadius(south, north, west, east) {
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  const dLat = Math.abs(north - south) / 2;
  const dLon = Math.abs(east - west) / 2;
  const radiusLat = dLat * 60; // 1 deg lat ≈ 60nm
  const radiusLon = dLon * 60 * Math.cos(lat * Math.PI / 180);
  const radius = Math.min(Math.ceil(Math.max(radiusLat, radiusLon)), 250);
  return { lat, lon, radius };
}

/**
 * Normalize an airplanes.live aircraft object to our GeoJSON feature format.
 */
function normalizeAirplanesLive(a) {
  if (a.lat == null || a.lon == null) return null;
  const dbFlags = a.dbFlags || 0;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    properties: {
      hex: a.hex || '',
      callsign: a.flight ? a.flight.trim() || null : null,
      registration: a.r || null,
      type: a.t || null,
      altBaro: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      groundSpeed: typeof a.gs === 'number' ? a.gs : null,
      track: typeof a.track === 'number' ? a.track : null,
      squawk: a.squawk || null,
      military: !!(dbFlags & 1),
      special: !!(dbFlags & 2),
      helicopter: a.category === 'A7',
      onGround: a.alt_baro === 'ground',
      emergency: null,
      category: a.category || null,
    },
  };
}

/**
 * Fetch aircraft from airplanes.live API.
 * Returns normalized GeoJSON features array. Errors are handled internally.
 */
async function fetchAirplanesLive(south, north, west, east) {
  if (process.env.AIRPLANES_LIVE_DISABLED === '1') return [];

  const now = Date.now();
  if (now < aplBackoffUntil) return aplCachedFeatures;
  if (now - aplLastFetch < MIN_FETCH_INTERVAL) return aplCachedFeatures;
  if (aplCachedFeatures.length > 0 && now - aplCacheTime < CACHE_TTL) return aplCachedFeatures;

  aplLastFetch = now;

  try {
    const { lat, lon, radius } = bboxToCenterRadius(south, north, west, east);
    const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (response.status === 429) {
      aplBackoffUntil = Date.now() + 30000;
      console.warn('airplanes.live: 429 rate limited, backing off 30s');
      return aplCachedFeatures;
    }
    if (!response.ok) throw new Error(`airplanes.live ${response.status}`);

    const json = await response.json();
    const ac = json.ac || [];
    const features = ac.map(normalizeAirplanesLive).filter(Boolean);

    aplCachedFeatures = features;
    aplCacheTime = Date.now();
    return features;
  } catch (err) {
    console.error('airplanes.live error:', err.message);
    return aplCachedFeatures;
  }
}

/**
 * Fetch aircraft from ADS-B Exchange. Returns GeoJSON features array.
 */
async function fetchAdsbExchange(south, north, west, east) {
  const now = Date.now();
  if (now < adsbxBackoffUntil) return adsbxCachedFeatures || [];
  if (now - adsbxLastFetch < MIN_FETCH_INTERVAL) return adsbxCachedFeatures || [];
  if (adsbxCachedFeatures && now - adsbxCacheTime < CACHE_TTL) return adsbxCachedFeatures;

  adsbxLastFetch = now;

  const url = `https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=${south.toFixed(4)},${north.toFixed(4)},${west.toFixed(4)},${east.toFixed(4)}`;
  const response = await fetch(url, {
    headers: {
      'Referer': 'https://globe.adsbexchange.com/',
      'x-requested-with': 'XMLHttpRequest',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (response.status === 429 || response.status === 403) {
    adsbxBackoffUntil = Date.now() + 30000;
    console.warn(`ADS-B Exchange: ${response.status} rate limited, backing off 30s`);
    return adsbxCachedFeatures || [];
  }

  if (!response.ok) throw new Error(`ADS-B Exchange ${response.status}`);

  const compressedBuf = await response.arrayBuffer();
  const decompressed = fzstd.decompress(new Uint8Array(compressedBuf));
  const features = decodeBinCraft(decompressed);

  adsbxCachedFeatures = features;
  adsbxCacheTime = Date.now();
  return features;
}

router.get('/', async (req, res) => {
  try {
    const south = parseFloat(req.query.south);
    const north = parseFloat(req.query.north);
    const west = parseFloat(req.query.west);
    const east = parseFloat(req.query.east);

    if (isNaN(south) || isNaN(north) || isNaN(west) || isNaN(east)) {
      return res.status(400).json({ error: 'south, north, west, east are required' });
    }

    // Serve from cache if fresh enough (skip cache when fresh=1 for activity analysis)
    const skipCache = req.query.fresh === '1';
    if (!skipCache && cachedData && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedData);
    }

    // Fetch both sources in parallel — each handles its own errors/backoff
    const [adsbxFeatures, aplFeatures] = await Promise.all([
      fetchAdsbExchange(south, north, west, east).catch(() => adsbxCachedFeatures || []),
      fetchAirplanesLive(south, north, west, east).catch(() => aplCachedFeatures),
    ]);

    // Merge: ADS-B Exchange is primary — wins all conflicts
    const featureMap = new Map();
    for (const f of adsbxFeatures) featureMap.set(f.properties.hex, f);
    for (const f of aplFeatures) {
      if (!featureMap.has(f.properties.hex)) featureMap.set(f.properties.hex, f);
    }

    const features = Array.from(featureMap.values());
    const geojson = {
      type: 'FeatureCollection',
      meta: {
        total: features.length,
        fetchedAt: new Date().toISOString(),
        sources: { adsbx: adsbxFeatures.length, airplaneslive: aplFeatures.length },
      },
      features,
    };

    cachedData = geojson;
    cacheTime = Date.now();

    res.json(geojson);
  } catch (err) {
    console.error('Aircraft API error:', err.message);
    if (cachedData) return res.json(cachedData);
    res.status(502).json({ error: err.message });
  }
});

// --- Trace endpoint: per-aircraft historical flight path ---

const traceCache = new Map(); // hex -> { data, time }
const TRACE_CACHE_TTL = 60000; // 60 seconds
const TRACE_CACHE_MAX = 200;

router.get('/trace/:hex', async (req, res) => {
  const hex = req.params.hex.toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    return res.status(400).json({ error: 'Invalid hex — must be 6 hex characters' });
  }

  // Check cache
  const cached = traceCache.get(hex);
  if (cached && Date.now() - cached.time < TRACE_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const last2 = hex.slice(-2);
    const headers = {
      'Referer': 'https://globe.adsbexchange.com/',
      'x-requested-with': 'XMLHttpRequest',
    };

    // Fetch both trace_full (history) and trace_recent (latest positions) in parallel
    const [fullRes, recentRes] = await Promise.all([
      fetch(`https://globe.adsbexchange.com/data/traces/${last2}/trace_full_${hex}.json`, {
        headers, signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://globe.adsbexchange.com/data/traces/${last2}/trace_recent_${hex}.json`, {
        headers, signal: AbortSignal.timeout(10000),
      }).catch(() => null), // recent is optional
    ]);

    if (fullRes.status === 404) {
      // Fallback: try OpenSky Network tracks API
      try {
        const osRes = await fetch(`https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`, {
          signal: AbortSignal.timeout(8000),
        });
        if (osRes.ok) {
          const osJson = await osRes.json();
          const path = osJson.path || [];
          if (path.length >= 2) {
            // path format: [timestamp, lat, lon, baro_alt, track, on_ground]
            // Detect current flight: walk backwards for ground/gap boundary
            const GAP_THRESHOLD_OS = 300;
            let flightStartOS = 0;
            for (let i = path.length - 1; i >= 1; i--) {
              if (path[i - 1][5]) { flightStartOS = i; break; } // on_ground
              if (path[i][0] - path[i - 1][0] > GAP_THRESHOLD_OS) { flightStartOS = i; break; }
            }
            const coords = [];
            for (let i = flightStartOS; i < path.length; i++) {
              const [, lat, lon] = path[i];
              if (lat != null && lon != null) coords.push([lon, lat]);
            }
            if (coords.length >= 2) {
              const geojson = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { hex, pointCount: coords.length, departureTime: path[flightStartOS][0], source: 'opensky' },
              };
              if (traceCache.size >= TRACE_CACHE_MAX) {
                const oldest = traceCache.keys().next().value;
                traceCache.delete(oldest);
              }
              traceCache.set(hex, { data: geojson, time: Date.now() });
              return res.json(geojson);
            }
          }
        }
      } catch (osErr) {
        // OpenSky also failed — fall through to 404
      }
      return res.status(404).json({ error: 'No trace data for this aircraft' });
    }
    if (!fullRes.ok) {
      throw new Error(`ADS-B Exchange trace ${fullRes.status}`);
    }

    const fullJson = await fullRes.json();
    const baseTimestamp = fullJson.timestamp || 0;
    let trace = fullJson.trace || [];

    // Append trace_recent points that come after trace_full
    if (recentRes && recentRes.ok) {
      const recentJson = await recentRes.json();
      const recentTrace = recentJson.trace || [];
      const lastFullTime = trace.length > 0 ? trace[trace.length - 1][0] : -Infinity;
      for (const pt of recentTrace) {
        if (pt[0] > lastFullTime) trace.push(pt);
      }
    }

    // Find start of current flight by walking backwards.
    // trace format: [time_offset, lat, lon, alt_baro, gs, track, flags, ...]
    // Detect flight boundary by:
    //   1. alt_baro === "ground" (aircraft was on the ground)
    //   2. Time gap > 5 minutes between consecutive points (transponder off/on)
    //   3. Null lat/lon (data gap)
    const GAP_THRESHOLD = 300; // 5 minutes in seconds
    let flightStart = 0;
    for (let i = trace.length - 1; i >= 1; i--) {
      const point = trace[i];
      const prev = trace[i - 1];

      // Ground status
      if (prev[3] === 'ground') {
        flightStart = i;
        break;
      }
      // Time gap between consecutive points
      if (point[0] - prev[0] > GAP_THRESHOLD) {
        flightStart = i;
        break;
      }
      // Null position gap
      if (prev[1] == null || prev[2] == null) {
        flightStart = i;
        break;
      }
    }

    // Filter valid lat/lon and build coordinates [lon, lat]
    const coordinates = [];
    for (let i = flightStart; i < trace.length; i++) {
      const point = trace[i];
      const lat = point[1];
      const lon = point[2];
      if (lat != null && lon != null && typeof lat === 'number' && typeof lon === 'number') {
        coordinates.push([lon, lat]);
      }
    }

    // Departure time: Unix seconds of the first point in the current flight
    const departureTime = trace[flightStart] ? baseTimestamp + trace[flightStart][0] : null;

    const geojson = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { hex, pointCount: coordinates.length, departureTime },
    };

    // Evict oldest if at capacity
    if (traceCache.size >= TRACE_CACHE_MAX) {
      const oldest = traceCache.keys().next().value;
      traceCache.delete(oldest);
    }
    traceCache.set(hex, { data: geojson, time: Date.now() });

    res.json(geojson);
  } catch (err) {
    console.error('Trace API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// --- Batch trace endpoint for activity analysis ---

const batchTraceCache = new Map(); // hex -> { data, time }
const BATCH_TRACE_CACHE_TTL = 300000; // 5 minutes
const BATCH_TRACE_CACHE_MAX = 200;

router.post('/traces/batch', async (req, res) => {
  const { hexes } = req.body;
  if (!Array.isArray(hexes) || hexes.length === 0) {
    return res.status(400).json({ error: 'hexes array is required' });
  }
  if (hexes.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 hex codes per batch' });
  }

  const validHexes = hexes.filter(h => typeof h === 'string' && /^[0-9a-f]{6}$/i.test(h)).map(h => h.toLowerCase());
  const traces = {};
  const errors = [];
  const toFetch = [];

  // Check cache first
  for (const hex of validHexes) {
    const cached = batchTraceCache.get(hex);
    if (cached && Date.now() - cached.time < BATCH_TRACE_CACHE_TTL) {
      traces[hex] = cached.data;
    } else {
      toFetch.push(hex);
    }
  }

  // Fetch in batches of 5 with 200ms delay between batches
  const FETCH_BATCH_SIZE = 5;
  for (let i = 0; i < toFetch.length; i += FETCH_BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const batch = toFetch.slice(i, i + FETCH_BATCH_SIZE);

    await Promise.all(batch.map(async (hex) => {
      try {
        const last2 = hex.slice(-2);
        const headers = {
          'Referer': 'https://globe.adsbexchange.com/',
          'x-requested-with': 'XMLHttpRequest',
        };

        const [fullRes, recentRes] = await Promise.all([
          fetch(`https://globe.adsbexchange.com/data/traces/${last2}/trace_full_${hex}.json`, {
            headers, signal: AbortSignal.timeout(10000),
          }),
          fetch(`https://globe.adsbexchange.com/data/traces/${last2}/trace_recent_${hex}.json`, {
            headers, signal: AbortSignal.timeout(10000),
          }).catch(() => null),
        ]);

        if (!fullRes.ok) {
          errors.push({ hex, error: `HTTP ${fullRes.status}` });
          return;
        }

        const fullJson = await fullRes.json();
        const baseTimestamp = fullJson.timestamp || 0;
        let trace = fullJson.trace || [];

        // Append recent points
        if (recentRes && recentRes.ok) {
          const recentJson = await recentRes.json();
          const recentTrace = recentJson.trace || [];
          const lastFullTime = trace.length > 0 ? trace[trace.length - 1][0] : -Infinity;
          for (const pt of recentTrace) {
            if (pt[0] > lastFullTime) trace.push(pt);
          }
        }

        // Build enriched trackPoints from ALL trace data
        // trace format: [time_offset, lat, lon, alt_baro, gs, track, flags, ...]
        const trackPoints = [];
        const coordinates = [];
        for (const pt of trace) {
          const lat = pt[1];
          const lon = pt[2];
          if (lat == null || lon == null || typeof lat !== 'number' || typeof lon !== 'number') continue;

          const altRaw = pt[3];
          const onGround = altRaw === 'ground';
          const altitude = onGround ? 0 : (typeof altRaw === 'number' ? altRaw : null);

          trackPoints.push({
            coordinates: [lon, lat],
            timestamp: new Date((baseTimestamp + pt[0]) * 1000).toISOString(),
            altitude,
            speed: typeof pt[4] === 'number' ? pt[4] : null,
            track: typeof pt[5] === 'number' ? pt[5] : null,
            onGround,
          });
          coordinates.push([lon, lat]);
        }

        const geojson = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { hex, pointCount: coordinates.length, trackPoints },
        };

        traces[hex] = geojson;

        // Cache
        if (batchTraceCache.size >= BATCH_TRACE_CACHE_MAX) {
          const oldest = batchTraceCache.keys().next().value;
          batchTraceCache.delete(oldest);
        }
        batchTraceCache.set(hex, { data: geojson, time: Date.now() });
      } catch (err) {
        errors.push({ hex, error: err.message });
      }
    }));
  }

  res.json({ traces, errors });
});

// --- Route/airport lookup via adsbdb.com ---

const routeCache = new Map(); // callsign -> { data, time }
const ROUTE_CACHE_TTL = 300000; // 5 minutes
const ROUTE_CACHE_MAX = 500;

function cacheRoute(callsign, data) {
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    routeCache.delete(oldest);
  }
  routeCache.set(callsign, { data, time: Date.now() });
}

function mapAirport(ap) {
  if (!ap) return null;
  return {
    icao: ap.icao_code || null,
    iata: ap.iata_code || null,
    name: ap.name || null,
    municipality: ap.municipality || null,
    country: ap.country_name || null,
  };
}

// Look up airport details by ICAO code via adsbdb
async function lookupAirport(icao) {
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/airport/${icao}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { icao, iata: null, name: null, municipality: null, country: null };
    const json = await res.json();
    const ap = json?.response?.airport;
    return ap ? mapAirport(ap) : { icao, iata: null, name: null, municipality: null, country: null };
  } catch {
    return { icao, iata: null, name: null, municipality: null, country: null };
  }
}

// Fallback: OpenSky Network routes API
async function fetchOpenSkyRoute(callsign) {
  try {
    const res = await fetch(`https://opensky-network.org/api/routes?callsign=${callsign}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.route || json.route.length < 2) return null;
    const depIcao = json.route[0];
    const arrIcao = json.route[json.route.length - 1];
    if (!depIcao || !arrIcao || depIcao === arrIcao) return null;

    // Look up airport details in parallel
    const [departure, arrival] = await Promise.all([
      lookupAirport(depIcao),
      lookupAirport(arrIcao),
    ]);

    const airline = json.operatorIata
      ? { name: null, icao: null, iata: json.operatorIata }
      : null;

    return {
      route: `${depIcao}-${arrIcao}`,
      departure,
      arrival,
      airline,
    };
  } catch {
    return null;
  }
}

router.get('/route/:callsign', async (req, res) => {
  const callsign = req.params.callsign.toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(callsign)) {
    return res.status(400).json({ error: 'Invalid callsign' });
  }

  const cached = routeCache.get(callsign);
  if (cached && Date.now() - cached.time < ROUTE_CACHE_TTL) {
    return res.json(cached.data);
  }

  const negResult = { route: null, departure: null, arrival: null, airline: null };

  try {
    // Primary: adsbdb
    const apiRes = await fetch(`https://api.adsbdb.com/v0/callsign/${callsign}`, {
      signal: AbortSignal.timeout(5000),
    });

    let result = null;

    if (apiRes.ok) {
      const json = await apiRes.json();
      const fr = json?.response?.flightroute;

      if (fr?.origin && fr?.destination) {
        const departure = mapAirport(fr.origin);
        const arrival = mapAirport(fr.destination);

        // Check for same origin/destination (stale data)
        if (departure?.icao && arrival?.icao && departure.icao !== arrival.icao) {
          const route = `${departure.icao}-${arrival.icao}`;
          const airline = fr.airline
            ? { name: fr.airline.name || null, icao: fr.airline.icao || null, iata: fr.airline.iata || null }
            : null;
          result = { route, departure, arrival, airline };
        }
      }
    }

    // Fallback: OpenSky Network if adsbdb returned no data or same origin/dest
    if (!result) {
      result = await fetchOpenSkyRoute(callsign);
    }

    const final = result || negResult;
    cacheRoute(callsign, final);
    res.json(final);
  } catch (err) {
    console.error('Route API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
