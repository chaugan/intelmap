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

// Generate a 64-point ellipse polygon from center [lng, lat] + edge point [lng, lat]
// rx = horizontal distance (lng diff), ry = vertical distance (lat diff)
export function generateEllipsePolygon(center, edgePoint) {
  const dLng = Math.abs(edgePoint[0] - center[0]);
  const dLat = Math.abs(edgePoint[1] - center[1]);
  const rxDeg = Math.max(dLng, 0.00001);
  const ryDeg = Math.max(dLat, 0.00001);
  const coords = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    coords.push([
      center[0] + rxDeg * Math.cos(angle),
      center[1] + ryDeg * Math.sin(angle),
    ]);
  }
  return coords;
}
