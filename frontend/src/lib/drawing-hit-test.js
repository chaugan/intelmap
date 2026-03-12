// Hit-testing helpers for drawings — shared between DrawingLayer and TacticalMap

export function screenDist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return screenDist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return screenDist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function pointInPolygonScreen(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function hitTestDrawing(drawing, clickScreen, map, threshold = 12) {
  if (drawing.geometry.type === 'Point') {
    try {
      const pt = map.project(drawing.geometry.coordinates);
      return screenDist(clickScreen, pt) <= threshold;
    } catch { return false; }
  }

  if (drawing.geometry.type === 'LineString') {
    const pts = drawing.geometry.coordinates.map(c => { try { return map.project(c); } catch { return null; } }).filter(Boolean);
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegment(clickScreen, pts[i], pts[i + 1]) <= threshold) return true;
    }
    return false;
  }

  if (drawing.geometry.type === 'Polygon') {
    const ring = drawing.geometry.coordinates[0].map(c => { try { return map.project(c); } catch { return null; } }).filter(Boolean);
    if (pointInPolygonScreen(clickScreen, ring)) return true;
    for (let i = 0; i < ring.length - 1; i++) {
      if (distToSegment(clickScreen, ring[i], ring[i + 1]) <= threshold) return true;
    }
    return false;
  }
  return false;
}
