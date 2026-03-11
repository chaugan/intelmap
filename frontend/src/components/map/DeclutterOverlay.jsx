import { useEffect, useRef, useCallback, useState } from 'react';
import { declutter } from '../../lib/declutter.js';

/**
 * DeclutterOverlay — projects markers + text drawings to screen space,
 * runs the declutter algorithm, and pushes offsets to parent.
 * Does NOT render leader lines (those are rendered via DeclutterLines inside <Map>).
 */
export default function DeclutterOverlay({ map, markers, localMarkers, drawings, active, onOffsetsChange, onLinesChange }) {
  const dragOverridesRef = useRef(new Map());
  const frameRef = useRef(null);

  const compute = useCallback(() => {
    if (!map || !active) return;

    const items = [];
    const itemMeta = new Map(); // id → { type, w, h } for line anchor calculation

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

    // Build leader lines with smart anchor points
    const lines = [];

    for (const m of allMarkers) {
      const off = computed.get(`marker:${m.id}`);
      if (!off || (Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1)) continue;
      try {
        const pt = map.project([m.lon, m.lat]);
        lines.push({ key: `marker:${m.id}`, ox: pt.x, oy: pt.y, tx: pt.x + off.dx, ty: pt.y + off.dy });
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
          const tx = ox + off.dx;
          const ty = oy + off.dy;

          // For text items, connect line to the closest edge (left, right, or center)
          let anchorX = tx;
          if (meta?.type === 'text') {
            const halfW = meta.w / 2;
            const relX = ox - tx; // origin relative to displaced text center
            // If origin is clearly to the left, anchor to left edge
            // If clearly to the right, anchor to right edge
            // Otherwise anchor to center
            if (relX < -halfW * 0.3) {
              anchorX = tx - halfW; // left edge
            } else if (relX > halfW * 0.3) {
              anchorX = tx + halfW; // right edge
            }
            // else stays at center
          }

          lines.push({ key: `drawing:${d.id}`, ox, oy, tx: anchorX, ty });
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

  return null; // rendering is done via DeclutterLines
}

/**
 * DeclutterLines — renders leader line SVG.
 * Designed to be placed INSIDE <Map> before <NatoMarkerLayer>
 * so lines render behind all markers/symbols.
 */
export function DeclutterLines({ lines }) {
  if (!lines || lines.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0, // below maplibre markers (which get z-index based on lat)
      }}
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
