/**
 * Wind chill calculation using Environment Canada / NWS formula.
 * @param {number} tempC - Temperature in Celsius
 * @param {number} windMs - Wind speed in m/s
 * @returns {number|null} Wind chill in °C, or null if conditions don't apply
 */
export function calcWindChill(tempC, windMs) {
  if (tempC == null || windMs == null) return null;
  const windKmh = windMs * 3.6;
  if (tempC > 10 || windKmh <= 4.8) return null;
  const wc = 13.12 + 0.6215 * tempC - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * tempC * Math.pow(windKmh, 0.16);
  return Math.round(wc * 10) / 10;
}
