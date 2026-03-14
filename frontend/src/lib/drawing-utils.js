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
// rxDeg/ryDeg define the semi-axes in degree-space (longitude/latitude).
// Rotation is performed in a uniform (metric-corrected) coordinate system so the
// ellipse maintains its visual shape at any angle, even at high latitudes.
export function generateEllipsePolygon(center, edgePoint, rotationDeg = 0) {
  const dLng = Math.abs(edgePoint[0] - center[0]);
  const dLat = Math.abs(edgePoint[1] - center[1]);
  const rxDeg = Math.max(dLng, 0.00001);
  const ryDeg = Math.max(dLat, 0.00001);
  const rotRad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // Latitude correction: at this latitude, 1° lng is cos(lat) times shorter than 1° lat
  const latFactor = Math.cos(center[1] * Math.PI / 180);

  // Convert degree-space radii to uniform (metric-equivalent) space
  const rxUniform = rxDeg * latFactor;
  const ryUniform = ryDeg;

  const coords = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    // Parametric ellipse point in uniform space
    const xu = rxUniform * Math.cos(angle);
    const yu = ryUniform * Math.sin(angle);
    // Rotate in uniform space (preserves visual shape)
    const xRot = xu * cosR - yu * sinR;
    const yRot = xu * sinR + yu * cosR;
    // Convert back to degree-space
    coords.push([
      center[0] + xRot / latFactor,
      center[1] + yRot,
    ]);
  }
  return coords;
}

// Generate a sector/fan polygon from center, radius, and two bearings (radians, 0=north, clockwise)
export function generateSectorPolygon(center, radiusKm, startBearingRad, endBearingRad) {
  const ARC_POINTS = 64;
  const coords = [center];

  // Normalize: sweep clockwise from start to end
  let start = ((startBearingRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let end = ((endBearingRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (end <= start) end += 2 * Math.PI;

  const latFactor = Math.cos(center[1] * Math.PI / 180);
  for (let i = 0; i <= ARC_POINTS; i++) {
    const angle = start + (i / ARC_POINTS) * (end - start);
    // Bearing convention: 0=north, clockwise → dLat=cos, dLon=sin
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon = (radiusKm / (111.32 * latFactor)) * Math.sin(angle);
    coords.push([center[0] + dLon, center[1] + dLat]);
  }
  coords.push(center);
  return coords;
}

// Extract sector parameters from a stored sector polygon ring
// ring = [center, ...arcPoints(65), center]
export function getSectorParams(ring) {
  const center = ring[0];
  const arcStart = ring[1];
  const arcEnd = ring[ring.length - 2];

  // Haversine distance for radius
  const R = 6371;
  const dLat = ((arcStart[1] - center[1]) * Math.PI) / 180;
  const dLon = ((arcStart[0] - center[0]) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(center[1] * Math.PI / 180) * Math.cos(arcStart[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Bearing from center to point (geodetic: 0=north, clockwise)
  function bearingRad(c, p) {
    const dL = (p[0] - c[0]) * Math.PI / 180;
    const lat1 = c[1] * Math.PI / 180;
    const lat2 = p[1] * Math.PI / 180;
    const y = Math.sin(dL) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dL);
    return Math.atan2(y, x);
  }

  return {
    center,
    radiusKm,
    startBearingRad: bearingRad(center, arcStart),
    endBearingRad: bearingRad(center, arcEnd),
  };
}

// Extract ellipse parameters (center, rx, ry, rotation) from a 64-point ring
// Returns rx/ry in degree-space and rotation in the uniform (metric-corrected) space
export function getEllipseParams(ring) {
  // Use only the 64 unique points (exclude the duplicate closing point)
  const n = ring.length - 1;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += ring[i][0];
    sumY += ring[i][1];
  }
  const cx = sumX / n;
  const cy = sumY / n;

  const latFactor = Math.cos(cy * Math.PI / 180);

  // ring[0] is at angle=0 (along the rx axis after rotation)
  // ring[16] is at angle=π/2 (along the ry axis after rotation)
  const dx0 = ring[0][0] - cx, dy0 = ring[0][1] - cy;
  const dx16 = ring[16][0] - cx, dy16 = ring[16][1] - cy;

  // Convert to uniform space to extract correct radii and rotation
  const dx0u = dx0 * latFactor;
  const dx16u = dx16 * latFactor;

  // rx in uniform space, then convert back to degree-space
  const rxUniform = Math.sqrt(dx0u * dx0u + dy0 * dy0);
  const rx = rxUniform / latFactor;

  // ry is already in latitude-degree scale
  const ry = Math.sqrt(dx16u * dx16u + dy16 * dy16);

  // Rotation angle from uniform-space direction of ring[0]
  const rotationDeg = Math.atan2(dy0, dx0u) * 180 / Math.PI;

  return { cx, cy, rx, ry, rotationDeg };
}
