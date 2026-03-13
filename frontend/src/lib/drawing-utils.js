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
// rotationDeg = clockwise rotation in degrees (optional)
export function generateEllipsePolygon(center, edgePoint, rotationDeg = 0) {
  const dLng = Math.abs(edgePoint[0] - center[0]);
  const dLat = Math.abs(edgePoint[1] - center[1]);
  const rxDeg = Math.max(dLng, 0.00001);
  const ryDeg = Math.max(dLat, 0.00001);
  const rotRad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const coords = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    const x = rxDeg * Math.cos(angle);
    const y = ryDeg * Math.sin(angle);
    coords.push([
      center[0] + x * cosR - y * sinR,
      center[1] + x * sinR + y * cosR,
    ]);
  }
  return coords;
}

// Extract ellipse parameters (center, rx, ry, rotation) from a 64-point ring
export function getEllipseParams(ring) {
  const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const dx0 = ring[0][0] - cx, dy0 = ring[0][1] - cy;
  const dx16 = ring[16][0] - cx, dy16 = ring[16][1] - cy;
  const rx = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const ry = Math.sqrt(dx16 * dx16 + dy16 * dy16);
  const rotationDeg = Math.atan2(dy0, dx0) * 180 / Math.PI;
  return { cx, cy, rx, ry, rotationDeg };
}
