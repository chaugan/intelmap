// Generate a 64-point circle polygon from center [lng, lat] + radius in km
export function generateCirclePolygon(center, radiusKm) {
  const coords = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon = (radiusKm / (111.32 * Math.cos(center[1] * Math.PI / 180))) * Math.sin(angle);
    coords.push([center[0] + dLon, center[1] + dLat]);
  }
  return coords;
}
