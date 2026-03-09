import { forward, toPoint } from 'mgrs';

/**
 * Parse raw easting/northing digit input (e.g. "123 456" or "12345 67890").
 * Both groups must have equal length (2-5 digits).
 * Returns { easting, northing } padded to 5 digits, or null.
 */
export function parseMgrsInput(input) {
  const m = input.match(/^\s*(\d{2,5})\s+(\d{2,5})\s*$/);
  if (!m) return null;
  const [, e, n] = m;
  if (e.length !== n.length) return null;
  // Pad to 5 digits by appending zeros
  const easting = e.padEnd(5, '0');
  const northing = n.padEnd(5, '0');
  return { easting, northing, precision: e.length };
}

/**
 * Parse full UTM coordinates (e.g. "537327 6613704").
 * Easting: 6 digits (100000-999999), Northing: 6-7 digits.
 * Returns { utmEasting, utmNorthing } or null.
 */
function parseUtmInput(input) {
  const m = input.match(/^\s*(\d{6})\s+(\d{6,7})\s*$/);
  if (!m) return null;
  return { utmEasting: parseInt(m[1]), utmNorthing: parseInt(m[2]) };
}

/**
 * Convert UTM coordinates to lat/lon (WGS84).
 */
function utmToLatLon(easting, northing, zone, northern = true) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const x = easting - 500000;
  const y = northern ? northing : northing - 10000000;

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720
  );

  const lon = (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / cosPhi1;

  const latDeg = lat * 180 / Math.PI;
  const lonDeg = lon * 180 / Math.PI + (zone - 1) * 6 - 180 + 3;

  return { lat: latDeg, lon: lonDeg };
}

// Column letters per zone set (repeats every 3 zones)
const COL_SETS = [
  'ABCDEFGH',  // zones 1,4,7,...
  'JKLMNPQR',  // zones 2,5,8,...
  'STUVWXYZ',  // zones 3,6,9,...
];

// Row letters (A-V, skip I and O) — 20 letters
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/**
 * Get the UTM zone and band letter for a given lon/lat using the mgrs library.
 */
function getZoneBand(lon, lat) {
  const mgrs = forward([lon, lat], 5);
  const m = mgrs.match(/^(\d{1,2})([A-Z])/);
  if (!m) return null;
  return { zone: parseInt(m[1]), band: m[2] };
}

/**
 * Main entry: resolve coordinate input to candidates.
 * Supports both MGRS digit pairs (e.g. "123 456") and full UTM (e.g. "537327 6613704").
 * @param {string} input - Raw user input
 * @param {{ lng: number, lat: number }} center - Current map center
 * @returns {Array<{ mgrs: string, mgrsFormatted: string, lon: number, lat: number, distance: number }>}
 */
export function resolveMgrs(input, center) {
  // Try full UTM first (more specific pattern)
  const utm = parseUtmInput(input);
  if (utm) return resolveUtm(utm, center);

  // Then try MGRS grid digits
  const parsed = parseMgrsInput(input);
  if (!parsed) return [];
  return resolveMgrsDigits(parsed, center);
}

/**
 * Resolve full UTM easting/northing to a single candidate per zone.
 */
function resolveUtm(utm, center) {
  const { utmEasting, utmNorthing } = utm;
  const zb = getZoneBand(center.lng, center.lat);
  if (!zb) return [];

  // Northern hemisphere if center lat >= 0
  const northern = center.lat >= 0;

  const zonesToCheck = [zb.zone];
  if (zb.zone > 1) zonesToCheck.push(zb.zone - 1);
  if (zb.zone < 60) zonesToCheck.push(zb.zone + 1);

  const candidates = [];
  for (const zone of zonesToCheck) {
    try {
      const { lat, lon } = utmToLatLon(utmEasting, utmNorthing, zone, northern);
      // Sanity check — lat should be valid
      if (!isFinite(lat) || !isFinite(lon) || lat < -80 || lat > 84) continue;

      // Get MGRS string for this position
      const mgrsStr = forward([lon, lat], 5);
      const dLat = (lat - center.lat) * 111.32;
      const dLon = (lon - center.lng) * 111.32 * Math.cos(center.lat * Math.PI / 180);
      const distance = Math.sqrt(dLat * dLat + dLon * dLon);

      candidates.push({
        mgrs: mgrsStr,
        mgrsFormatted: formatMgrs(mgrsStr),
        lon,
        lat,
        distance,
        utmZone: zone,
      });
    } catch {
      // Invalid conversion — skip
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, 5);
}

/**
 * Resolve MGRS grid digits to candidate grid references sorted by distance.
 */
function resolveMgrsDigits(parsed, center) {
  const { easting, northing } = parsed;
  const zb = getZoneBand(center.lng, center.lat);
  if (!zb) return [];

  const zonesToCheck = new Set();
  zonesToCheck.add(zb.zone);
  if (zb.zone > 1) zonesToCheck.add(zb.zone - 1);
  if (zb.zone < 60) zonesToCheck.add(zb.zone + 1);

  const candidates = [];

  for (const zone of zonesToCheck) {
    const band = zb.band;
    const setIdx = (zone - 1) % 3;
    const colLetters = COL_SETS[setIdx];

    for (const col of colLetters) {
      for (const row of ROW_LETTERS) {
        const mgrsStr = `${zone}${band}${col}${row}${easting}${northing}`;
        try {
          const pt = toPoint(mgrsStr);
          // toPoint returns [lon, lat] or [minLon, minLat, maxLon, maxLat]
          const lon = pt.length === 4 ? (pt[0] + pt[2]) / 2 : pt[0];
          const lat = pt.length === 4 ? (pt[1] + pt[3]) / 2 : pt[1];
          if (!isFinite(lat) || !isFinite(lon)) continue;

          const dLat = (lat - center.lat) * 111.32;
          const dLon = (lon - center.lng) * 111.32 * Math.cos(center.lat * Math.PI / 180);
          const distance = Math.sqrt(dLat * dLat + dLon * dLon);

          candidates.push({ mgrs: mgrsStr, lon, lat, distance });
        } catch {
          // Invalid MGRS combination — skip
        }
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, 5).map((c) => ({
    ...c,
    mgrsFormatted: formatMgrs(c.mgrs),
  }));
}

/**
 * Format an MGRS string with spaces for readability: "32VKM1234567890" → "32V KM 12345 67890"
 */
function formatMgrs(mgrs) {
  const m = mgrs.match(/^(\d{1,2})([A-Z])([A-Z]{2})(\d+)$/);
  if (!m) return mgrs;
  const [, zone, band, sq, digits] = m;
  const half = digits.length / 2;
  const e = digits.slice(0, half);
  const n = digits.slice(half);
  return `${zone}${band} ${sq} ${e} ${n}`;
}
