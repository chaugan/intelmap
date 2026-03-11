import { useEffect, useRef, useCallback } from 'react';
import { declutter } from '../../lib/declutter.js';

/**
 * Compute where a line from origin (ox,oy) to center (cx,cy) intersects
 * the bounding box edge (halfW × halfH around cx,cy).
 * Returns the intersection point + a small gap inward.
 */
function lineBoxIntersection(ox, oy, cx, cy, halfW, halfH, gap = 3) {
  const dx = ox - cx;
  const dy = oy - cy;
  if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return { x: cx, y: cy };

  // Scale factor to reach the box edge along the direction (cx,cy) → (ox,oy)
  const sx = halfW / Math.abs(dx || 0.001);
  const sy = halfH / Math.abs(dy || 0.001);
  const s = Math.min(sx, sy); // whichever edge is hit first

  // Point on box edge
  const ex = cx + dx * s;
  const ey = cy + dy * s;

  // Add a small gap outward (toward origin)
  const dist = Math.sqrt(dx * dx + dy * dy);
  const gx = (dx / dist) * gap;
  const gy = (dy / dist) * gap;

  return { x: ex + gx, y: ey + gy };
}

/**
 * DeclutterOverlay — projects markers + text drawings to screen space,
 * runs the declutter algorithm, and pushes offsets to parent.
 */
export default function DeclutterOverlay({ map, markers, localMarkers, drawings, active, onOffsetsChange, onLinesChange }) {
  const dragOverridesRef = useRef(new Map());
  const frameRef = useRef(null);

  const compute = useCallback(() => {
    if (!map || !active) return;

    const items = [];
    const itemMeta = new Map(); // id → { type, w, h }

    // Markers — NATO symbols are roughly 60×50, with labels/designation they grow taller
    const allMarkers = [...(markers || []), ...(localMarkers || [])];
    for (const m of allMarkers) {
      try {
        const pt = map.project([m.lon, m.lat]);
        const hasLabel = m.customLabel || m.designation;
        const w = hasLabel ? Math.max(65, (m.customLabel || m.designation || '').length * 8 + 20) : 60;
        const h = hasLabel ? 60 : 50;
        items.push({ id: `marker:${m.id}`, cx: pt.x, cy: pt.y, w, h });
        itemMeta.set(`marker:${m.id}`, { type: 'marker', w, h });
      } catch {}
    }

    // Text drawings + labeled drawings
    for (const d of (drawings || [])) {
      const geom = d.geometry;
      if (!geom) continue;

      if (geom.type === 'Point' && d.drawingType === 'text') {
        try {
          const pt = map.project(geom.coordinates);
          const text = d.properties?.text || '';
          const w = Math.max(50, text.length * 10 + 16);
          items.push({ id: `drawing:${d.id}`, cx: pt.x, cy: pt.y, w, h: 26 });
          itemMeta.set(`drawing:${d.id}`, { type: 'text', w, h: 26 });
        } catch {}
      } else if (d.properties?.label) {
        let cx, cy;
        try {
          if (geom.type === 'LineString') {
            const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
            const pt = map.project(mid);
            cx = pt.x; cy = pt.y - 10;
          } else if (geom.type === 'Polygon') {
            const ring = geom.coordinates[0];
            const avgLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
            const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
            const pt = map.project([avgLng, avgLat]);
            cx = pt.x; cy = pt.y;
          }
          if (cx != null) {
            const label = d.properties.label;
            const w = Math.max(50, label.length * 10 + 16);
            items.push({ id: `drawing:${d.id}`, cx, cy, w, h: 26 });
            itemMeta.set(`drawing:${d.id}`, { type: 'text', w, h: 26 });
          }
        } catch {}
      }
    }

    // Run algorithm
    const computed = declutter(items);

    // Merge drag overrides
    for (const [id, override] of dragOverridesRef.current) {
      computed.set(id, override);
    }

    onOffsetsChange(computed);

    // Build leader lines — end at bounding box edge, not center
    const lines = [];

    for (const m of allMarkers) {
      const off = computed.get(`marker:${m.id}`);
      if (!off || (Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1)) continue;
      try {
        const pt = map.project([m.lon, m.lat]);
        const meta = itemMeta.get(`marker:${m.id}`);
        const cx = pt.x + off.dx;
        const cy = pt.y + off.dy;
        // Line ends at the displaced marker's bounding box edge
        const anchor = lineBoxIntersection(pt.x, pt.y, cx, cy, meta.w / 2, meta.h / 2, 4);
        lines.push({ key: `marker:${m.id}`, ox: pt.x, oy: pt.y, tx: anchor.x, ty: anchor.y });
      } catch {}
    }

    for (const d of (drawings || [])) {
      const off = computed.get(`drawing:${d.id}`);
      if (!off || (Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1)) continue;
      const geom = d.geometry;
      if (!geom) continue;
      try {
        let ox, oy;
        if (geom.type === 'Point') {
          const pt = map.project(geom.coordinates);
          ox = pt.x; oy = pt.y;
        } else if (geom.type === 'LineString') {
          const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
          const pt = map.project(mid);
          ox = pt.x; oy = pt.y - 10;
        } else if (geom.type === 'Polygon') {
          const ring = geom.coordinates[0];
          const avgLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          const pt = map.project([avgLng, avgLat]);
          ox = pt.x; oy = pt.y;
        }
        if (ox != null) {
          const meta = itemMeta.get(`drawing:${d.id}`);
          const cx = ox + off.dx;
          const cy = oy + off.dy;
          // Line ends at the displaced text's bounding box edge
          const anchor = lineBoxIntersection(ox, oy, cx, cy, (meta?.w || 50) / 2, (meta?.h || 26) / 2, 2);
          lines.push({ key: `drawing:${d.id}`, ox, oy, tx: anchor.x, ty: anchor.y });
        }
      } catch {}
    }

    onLinesChange(lines);
  }, [map, active, markers, localMarkers, drawings, onOffsetsChange, onLinesChange]);

  // Recompute on map move
  useEffect(() => {
    if (!map || !active) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      return;
    }

    const onMove = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(compute);
    };

    compute();
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [map, active, compute]);

  // Clear when deactivated
  useEffect(() => {
    if (!active) {
      dragOverridesRef.current.clear();
      onOffsetsChange(null);
      onLinesChange([]);
    }
  }, [active, onOffsetsChange, onLinesChange]);

  return null;
}

/**
 * DeclutterLines — renders leader line SVG.
 * Rendered outside <Map> at z-[3] (below drawings z-[4]).
 * Lines stop at item bounding box edges so they don't overlap symbols/text.
 */
export function DeclutterLines({ lines }) {
  if (!lines || lines.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 z-[3]"
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {lines.map((l) => (
        <g key={l.key}>
          <line
            x1={l.ox} y1={l.oy} x2={l.tx} y2={l.ty}
            stroke="#000000" strokeWidth="3.5" strokeDasharray="8 5" opacity="0.9"
          />
          <circle cx={l.ox} cy={l.oy} r="5" fill="#000000" opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}
