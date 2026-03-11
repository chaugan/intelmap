import { useEffect, useRef, useCallback } from 'react';
import { declutter } from '../../lib/declutter.js';

/**
 * Build item descriptors for the declutter algorithm.
 * Returns { items, meta, sources } where sources maps id → geo info for re-projection.
 */
function buildItems(map, markers, localMarkers, drawings) {
  const items = [];
  const meta = new Map();
  const sources = new Map(); // id → { type: 'marker'|'drawing', coords, geomType, w, h, gap }

  const allMarkers = [...(markers || []), ...(localMarkers || [])];
  for (const m of allMarkers) {
    try {
      const pt = map.project([m.lon, m.lat]);
      const hasLabel = m.customLabel || m.designation;
      const w = hasLabel ? Math.max(65, (m.customLabel || m.designation || '').length * 8 + 20) : 60;
      const h = hasLabel ? 60 : 50;
      const id = `marker:${m.id}`;
      items.push({ id, cx: pt.x, cy: pt.y, w, h });
      meta.set(id, { type: 'marker', w, h });
      sources.set(id, { coords: [m.lon, m.lat], w, h, gap: 4 });
    } catch {}
  }

  for (const d of (drawings || [])) {
    const geom = d.geometry;
    if (!geom) continue;
    const id = `drawing:${d.id}`;

    if (geom.type === 'Point' && d.drawingType === 'text') {
      try {
        const pt = map.project(geom.coordinates);
        const text = d.properties?.text || '';
        const w = Math.max(50, text.length * 10 + 16);
        items.push({ id, cx: pt.x, cy: pt.y, w, h: 26 });
        meta.set(id, { type: 'text', w, h: 26 });
        sources.set(id, { coords: geom.coordinates, w, h: 26, gap: 2, yOffset: 0 });
      } catch {}
    } else if (d.properties?.label) {
      let cx, cy, coords, yOffset = 0;
      try {
        if (geom.type === 'LineString') {
          coords = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
          const pt = map.project(coords);
          cx = pt.x; cy = pt.y - 10;
          yOffset = -10;
        } else if (geom.type === 'Polygon') {
          const ring = geom.coordinates[0];
          coords = [
            ring.reduce((s, c) => s + c[0], 0) / ring.length,
            ring.reduce((s, c) => s + c[1], 0) / ring.length,
          ];
          const pt = map.project(coords);
          cx = pt.x; cy = pt.y;
        }
        if (cx != null) {
          const label = d.properties.label;
          const w = Math.max(50, label.length * 10 + 16);
          items.push({ id, cx, cy, w, h: 26 });
          meta.set(id, { type: 'text', w, h: 26 });
          sources.set(id, { coords, w, h: 26, gap: 2, yOffset: yOffset || 0 });
        }
      } catch {}
    }
  }

  return { items, meta, sources };
}

/**
 * DeclutterOverlay — runs the declutter algorithm ONCE (not per frame),
 * stores offsets in a ref, and updates leader lines via direct DOM manipulation
 * on map move (no React state updates during pan/zoom).
 */
export default function DeclutterOverlay({ map, markers, localMarkers, drawings, active, onOffsetsChange }) {
  const offsetsRef = useRef(null); // Map<id, {dx,dy}>
  const sourcesRef = useRef(null); // Map<id, source descriptor>
  const metaRef = useRef(null);
  const svgRef = useRef(null); // direct ref to SVG element
  const frameRef = useRef(null);

  // Run the declutter algorithm (expensive — only on activation or data change)
  const solve = useCallback(() => {
    if (!map || !active) return;

    const { items, meta, sources } = buildItems(map, markers, localMarkers, drawings);
    const offsets = declutter(items);

    offsetsRef.current = offsets;
    sourcesRef.current = sources;
    metaRef.current = meta;

    // Push offsets to parent (one-time, triggers re-render for marker offset props)
    onOffsetsChange(offsets);
  }, [map, active, markers, localMarkers, drawings, onOffsetsChange]);

  // Update leader line SVG positions (cheap — direct DOM, no React)
  const updateLines = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !map || !offsetsRef.current || !sourcesRef.current) return;

    const offsets = offsetsRef.current;
    const sources = sourcesRef.current;

    // Build line data
    const lineData = [];
    for (const [id, source] of sources) {
      const off = offsets.get(id);
      if (!off || (Math.abs(off.dx) < 1 && Math.abs(off.dy) < 1)) continue;
      try {
        const pt = map.project(source.coords);
        const ox = pt.x;
        const oy = pt.y + (source.yOffset || 0);
        const cx = ox + off.dx;
        const cy = oy + off.dy;
        lineData.push({ ox, oy, tx: cx, ty: cy });
      } catch {}
    }

    // Update SVG DOM directly (no React reconciliation)
    // Clear existing children
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    for (const l of lineData) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', l.ox);
      line.setAttribute('y1', l.oy);
      line.setAttribute('x2', l.tx);
      line.setAttribute('y2', l.ty);
      line.setAttribute('stroke', '#000000');
      line.setAttribute('stroke-width', '3.5');
      line.setAttribute('stroke-dasharray', '8 5');
      line.setAttribute('opacity', '0.9');
      svg.appendChild(line);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', l.ox);
      circle.setAttribute('cy', l.oy);
      circle.setAttribute('r', '5');
      circle.setAttribute('fill', '#000000');
      circle.setAttribute('opacity', '0.9');
      svg.appendChild(circle);
    }
  }, [map]);

  // Run algorithm once on activation or data change
  useEffect(() => {
    if (!map || !active) return;
    solve();
  }, [solve]);

  // On map move: only re-project leader lines (cheap)
  useEffect(() => {
    if (!map || !active) return;

    const onMove = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(updateLines);
    };

    // Initial draw
    updateLines();
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [map, active, updateLines]);

  // Clear when deactivated
  useEffect(() => {
    if (!active) {
      offsetsRef.current = null;
      sourcesRef.current = null;
      metaRef.current = null;
      onOffsetsChange(null);
      // Clear SVG
      const svg = svgRef.current;
      if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
    }
  }, [active, onOffsetsChange]);

  if (!active) return null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-[3]"
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
