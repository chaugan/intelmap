import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { declutter } from '../../lib/declutter.js';

/**
 * DeclutterOverlay — projects markers + text drawings to screen space,
 * runs the declutter algorithm, renders leader lines, and pushes offsets to parent.
 *
 * Props:
 *   map              — MapLibre map instance
 *   markers          — array of visible markers (with id, lon, lat)
 *   localMarkers     — array of local markers
 *   drawings         — array of visible drawings (text + labeled)
 *   active           — boolean, whether declutter is active
 *   onOffsetsChange  — callback(Map<id, {dx,dy}> | null)
 */
export default function DeclutterOverlay({ map, markers, localMarkers, drawings, active, onOffsetsChange }) {
  const dragOverridesRef = useRef(new Map()); // id → {dx, dy}
  const offsetsRef = useRef(null);
  const frameRef = useRef(null);

  const compute = useCallback(() => {
    if (!map || !active) return;

    const items = [];

    // Markers — NATO symbols are roughly 60×50, with labels/designation they grow taller
    const allMarkers = [...(markers || []), ...(localMarkers || [])];
    for (const m of allMarkers) {
      try {
        const pt = map.project([m.lon, m.lat]);
        const hasLabel = m.customLabel || m.designation;
        const w = hasLabel ? Math.max(65, (m.customLabel || m.designation || '').length * 8 + 20) : 60;
        const h = hasLabel ? 60 : 50;
        items.push({ id: `marker:${m.id}`, cx: pt.x, cy: pt.y, w, h });
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
          // fontSize 18, bold — approximate character width ~10px
          const w = Math.max(50, text.length * 10 + 16);
          items.push({ id: `drawing:${d.id}`, cx: pt.x, cy: pt.y, w, h: 26 });
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

    offsetsRef.current = computed;
    onOffsetsChange(computed);
  }, [map, active, markers, localMarkers, drawings, onOffsetsChange]);

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

    compute(); // initial
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [map, active, compute]);

  // Clear overrides and offsets when deactivated
  useEffect(() => {
    if (!active) {
      dragOverridesRef.current.clear();
      offsetsRef.current = null;
      onOffsetsChange(null);
    }
  }, [active, onOffsetsChange]);

  // Render leader lines SVG
  if (!active || !map || !offsetsRef.current) return null;

  const lines = [];
  const offsets = offsetsRef.current;

  const allMarkers = [...(markers || []), ...(localMarkers || [])];
  for (const m of allMarkers) {
    const off = offsets.get(`marker:${m.id}`);
    if (!off || (Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1)) continue;
    try {
      const pt = map.project([m.lon, m.lat]);
      lines.push({ key: `marker:${m.id}`, ox: pt.x, oy: pt.y, tx: pt.x + off.dx, ty: pt.y + off.dy });
    } catch {}
  }

  for (const d of (drawings || [])) {
    const off = offsets.get(`drawing:${d.id}`);
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
        lines.push({ key: `drawing:${d.id}`, ox, oy, tx: ox + off.dx, ty: oy + off.dy });
      }
    } catch {}
  }

  return (
    <svg className="absolute inset-0 z-[3]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
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
