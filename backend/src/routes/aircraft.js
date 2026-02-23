import { Router } from 'express';
import * as fzstd from 'fzstd';

const router = Router();

// Single shared cache entry — one active query at a time is enough
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 15000; // 15 seconds
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 3000; // 3 seconds between upstream requests
let backoffUntil = 0; // timestamp until we stop retrying after 429

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

router.get('/', async (req, res) => {
  try {
    const south = parseFloat(req.query.south);
    const north = parseFloat(req.query.north);
    const west = parseFloat(req.query.west);
    const east = parseFloat(req.query.east);

    if (isNaN(south) || isNaN(north) || isNaN(west) || isNaN(east)) {
      return res.status(400).json({ error: 'south, north, west, east are required' });
    }

    // Serve from cache if fresh enough
    if (cachedData && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedData);
    }

    // If we're in backoff from a 429/403, serve stale cache or empty
    if (Date.now() < backoffUntil) {
      if (cachedData) return res.json(cachedData);
      return res.json({ type: 'FeatureCollection', meta: { total: 0, fetchedAt: new Date().toISOString() }, features: [] });
    }

    // Rate-limit guard
    const now = Date.now();
    const elapsed = now - lastFetchTime;
    if (elapsed < MIN_FETCH_INTERVAL) {
      if (cachedData) return res.json(cachedData);
      await new Promise((resolve) => setTimeout(resolve, MIN_FETCH_INTERVAL - elapsed));
    }
    lastFetchTime = Date.now();

    const url = `https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=${south.toFixed(4)},${north.toFixed(4)},${west.toFixed(4)},${east.toFixed(4)}`;
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://globe.adsbexchange.com/',
        'x-requested-with': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 429 || response.status === 403) {
      backoffUntil = Date.now() + 30000;
      console.warn(`Aircraft API: ${response.status} rate limited, backing off 30s`);
      if (cachedData) return res.json(cachedData);
      return res.json({ type: 'FeatureCollection', meta: { total: 0, fetchedAt: new Date().toISOString() }, features: [] });
    }

    if (!response.ok) throw new Error(`ADS-B Exchange ${response.status}`);

    const compressedBuf = await response.arrayBuffer();
    const decompressed = fzstd.decompress(new Uint8Array(compressedBuf));
    const features = decodeBinCraft(decompressed);

    const geojson = {
      type: 'FeatureCollection',
      meta: {
        total: features.length,
        fetchedAt: new Date().toISOString(),
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

export default router;
