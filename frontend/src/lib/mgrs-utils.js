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
 * Resolve MGRS digit input to candidate grid references sorted by distance from map center.
 * @param {string} input - Raw user input like "123 456"
 * @param {{ lng: number, lat: number }} center - Current map center
 * @returns {Array<{ mgrs: string, lon: number, lat: number, distance: number }>}
 */
export function resolveMgrs(input, center) {
  const parsed = parseMgrsInput(input);
  if (!parsed) return [];

  const { easting, northing } = parsed;
  const zb = getZoneBand(center.lng, center.lat);
  if (!zb) return [];

  // Check current zone and adjacent zones for boundary cases
  const zonesToCheck = new Set();
  zonesToCheck.add(zb.zone);
  if (zb.zone > 1) zonesToCheck.add(zb.zone - 1);
  if (zb.zone < 60) zonesToCheck.add(zb.zone + 1);

  const candidates = [];

  for (const zone of zonesToCheck) {
    // Get band from center (approximate — usually same band for adjacent zones)
    const band = zb.band;
    const setIdx = (zone - 1) % 3;
    const colLetters = COL_SETS[setIdx];

    for (const col of colLetters) {
      for (const row of ROW_LETTERS) {
        const mgrsStr = `${zone}${band}${col}${row}${easting}${northing}`;
        try {
          const [minLon, minLat, maxLon, maxLat] = toPoint(mgrsStr);
          const lon = (minLon + maxLon) / 2;
          const lat = (minLat + maxLat) / 2;

          // Calculate distance from map center (rough km)
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

  // Sort by distance, return top 5
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
