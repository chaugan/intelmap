import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { DRAW_COLORS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';

// Check if any coordinate of a drawing falls inside a geo bounding box
function drawingIntersectsBox(drawing, box) {
  const { minLng, maxLng, minLat, maxLat } = box;
  const geom = drawing.geometry;

  function pointInBox(coord) {
    const [lng, lat] = coord;
    return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }

  if (geom.type === 'Point') {
    return pointInBox(geom.coordinates);
  }
  if (geom.type === 'LineString') {
    return geom.coordinates.some(pointInBox);
  }
  if (geom.type === 'Polygon') {
    return geom.coordinates[0].some(pointInBox);
  }
  return false;
}

export default function DrawingLayer() {
  const lang = useMapStore((s) => s.lang);
  const mapRefValue = useMapStore((s) => s.mapRef);
  const placementMode = useMapStore((s) => s.placementMode);
  const drawings = useTacticalStore((s) => s.drawings);
  const [activeMode, setActiveMode] = useState(null);
  const [drawColor, setDrawColor] = useState('#3b82f6');
  const [drawPoints, setDrawPoints] = useState([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [, forceUpdate] = useState(0);
  const activeModeRef = useRef(activeMode);
  const drawColorRef = useRef(drawColor);
  const drawPointsRef = useRef(drawPoints);

  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectionRect, setSelectionRect] = useState(null); // { startX, startY, endX, endY }
  const [selectedIds, setSelectedIds] = useState(new Set());
  const isDraggingRef = useRef(false);

  // Keep refs in sync
  activeModeRef.current = activeMode;
  drawColorRef.current = drawColor;
  drawPointsRef.current = drawPoints;

  const finishDrawing = useCallback(() => {
    const pts = drawPointsRef.current;
    const mode = activeModeRef.current;
    const color = drawColorRef.current;
    if (pts.length < 2 && mode !== 'text') return;

    // Prompt for optional label
    const label = prompt(lang === 'no' ? 'Legg til etikett (valgfritt):' : 'Add label (optional):');

    let geometry, drawingType;
    if (mode === 'line' || mode === 'arrow') {
      geometry = { type: 'LineString', coordinates: pts };
      drawingType = mode;
    } else if (mode === 'polygon') {
      const closed = [...pts, pts[0]];
      geometry = { type: 'Polygon', coordinates: [closed] };
      drawingType = 'polygon';
    } else if (mode === 'circle' && pts.length >= 2) {
      const [c, edge] = pts;
      const R = 6371;
      const dLat = ((edge[1] - c[1]) * Math.PI) / 180;
      const dLon = ((edge[0] - c[0]) * Math.PI) / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(c[1]*Math.PI/180)*Math.cos(edge[1]*Math.PI/180)*Math.sin(dLon/2)**2;
      const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const coords = [];
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * 2 * Math.PI;
        const dLat2 = (radiusKm / 111.32) * Math.cos(angle);
        const dLon2 = (radiusKm / (111.32 * Math.cos(c[1] * Math.PI / 180))) * Math.sin(angle);
        coords.push([c[0] + dLon2, c[1] + dLat2]);
      }
      geometry = { type: 'Polygon', coordinates: [coords] };
      drawingType = 'circle';
    }

    if (geometry) {
      socket.emit('client:drawing:add', {
        drawingType,
        geometry,
        properties: {
          color,
          lineType: mode === 'arrow' ? 'arrow' : 'solid',
          fillOpacity: 0.15,
          label: label || undefined,
        },
        source: 'user',
        createdBy: socket.id,
      });
    }

    setDrawPoints([]);
    setActiveMode(null);
  }, [lang]);

  // Register click handler on map
  useEffect(() => {
    if (!mapRefValue) return;

    const handler = (e) => {
      if (selectMode || !activeModeRef.current || placementMode) return;
      const { lng, lat } = e.lngLat;

      if (activeModeRef.current === 'text') {
        const text = prompt(lang === 'no' ? 'Skriv inn tekst:' : 'Enter text:');
        if (text) {
          socket.emit('client:drawing:add', {
            drawingType: 'text',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { text, color: drawColorRef.current },
            source: 'user',
            createdBy: socket.id,
          });
        }
        setActiveMode(null);
        return;
      }

      setDrawPoints(prev => [...prev, [lng, lat]]);
    };

    mapRefValue.on('click', handler);
    return () => mapRefValue.off('click', handler);
  }, [mapRefValue, lang, placementMode, selectMode]);

  // Rectangle selection drag handlers
  useEffect(() => {
    if (!selectMode || !mapRefValue) return;

    const canvas = mapRefValue.getCanvas();

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect({ startX: x, startY: y, endX: x, endY: y });
      // Disable map drag during selection
      mapRefValue.dragPan.disable();
    };

    const onMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect(prev => prev ? { ...prev, endX: x, endY: y } : null);
    };

    const onMouseUp = (e) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      mapRefValue.dragPan.enable();

      setSelectionRect(prev => {
        if (!prev) return null;
        const { startX, startY, endX, endY } = prev;
        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        // Only select if rectangle is big enough (not just a click)
        if (maxX - minX < 5 || maxY - minY < 5) {
          setSelectedIds(new Set());
          return null;
        }

        // Convert screen rect to geo bounds
        const sw = mapRefValue.unproject([minX, maxY]);
        const ne = mapRefValue.unproject([maxX, minY]);
        const box = {
          minLng: sw.lng,
          maxLng: ne.lng,
          minLat: sw.lat,
          maxLat: ne.lat,
        };

        // Find drawings that intersect the box
        const allDrawings = useTacticalStore.getState().drawings;
        const ids = new Set();
        for (const d of allDrawings) {
          if (drawingIntersectsBox(d, box)) {
            ids.add(d.id);
          }
        }
        setSelectedIds(ids);
        return null;
      });
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      mapRefValue.dragPan.enable();
    };
  }, [selectMode, mapRefValue]);

  // Exit select mode resets selection
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectionRect(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    socket.emit('client:drawing:delete-batch', { ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
  }, [selectedIds]);

  const deleteAll = useCallback(() => {
    const ok = confirm(t('draw.confirmDeleteAll', lang));
    if (!ok) return;
    const allIds = useTacticalStore.getState().drawings.map(d => d.id);
    if (allIds.length > 0) {
      socket.emit('client:drawing:delete-batch', { ids: allIds });
    }
    exitSelectMode();
  }, [lang, exitSelectMode]);

  // Force re-render on map move so preview SVG stays in sync with map
  useEffect(() => {
    if (!mapRefValue || drawPoints.length === 0) return;
    const onMove = () => forceUpdate((n) => n + 1);
    mapRefValue.on('move', onMove);
    return () => mapRefValue.off('move', onMove);
  }, [mapRefValue, drawPoints.length > 0]);

  // Project draw points to screen coordinates for SVG preview
  const screenPoints = [];
  if (mapRefValue && drawPoints.length > 0) {
    for (const pt of drawPoints) {
      try {
        const sp = mapRefValue.project(pt);
        screenPoints.push({ x: sp.x, y: sp.y });
      } catch {
        screenPoints.push({ x: 0, y: 0 });
      }
    }
  }

  const tools = [
    { id: 'line', icon: '/', shortcut: 'L' },
    { id: 'polygon', icon: '\u2B21', shortcut: 'P' },
    { id: 'circle', icon: '\u25EF', shortcut: 'O' },
    { id: 'arrow', icon: '\u2192', shortcut: 'A' },
    { id: 'text', icon: 'T', shortcut: 'T' },
  ];

  return (
    <>
      {/* Drawing tools panel */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              if (selectMode) exitSelectMode();
              if (activeMode === tool.id) {
                finishDrawing();
              } else {
                setDrawPoints([]);
                setActiveMode(tool.id);
              }
            }}
            className={`w-10 h-10 flex items-center justify-center rounded text-lg font-bold transition-colors shadow-lg ${
              activeMode === tool.id
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={`${t(`draw.${tool.id}`, lang)} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        ))}

        {/* Finish drawing button */}
        {activeMode && activeMode !== 'text' && drawPoints.length >= 2 && (
          <button
            onClick={finishDrawing}
            className="w-10 h-10 flex items-center justify-center rounded bg-emerald-600 text-white text-sm font-bold shadow-lg hover:bg-emerald-500"
            title="Finish (Enter)"
          >
            {'\u2713'}
          </button>
        )}

        {/* Cancel */}
        {activeMode && (
          <button
            onClick={() => { setActiveMode(null); setDrawPoints([]); }}
            className="w-10 h-10 flex items-center justify-center rounded bg-red-800 text-white text-sm font-bold shadow-lg hover:bg-red-700"
            title="Cancel (Esc)"
          >
            {'\u2715'}
          </button>
        )}

        {/* Separator */}
        <div className="border-t border-slate-600 my-1" />

        {/* Select/delete mode button */}
        <button
          onClick={() => {
            if (selectMode) {
              exitSelectMode();
            } else {
              setActiveMode(null);
              setDrawPoints([]);
              setSelectMode(true);
            }
          }}
          className={`w-10 h-10 flex items-center justify-center rounded text-sm font-bold transition-colors shadow-lg ${
            selectMode
              ? 'bg-amber-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
          title={t('draw.select', lang)}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
          </svg>
        </button>

        {/* Delete all button */}
        {drawings.length > 0 && (
          <button
            onClick={deleteAll}
            className="w-10 h-10 flex items-center justify-center rounded bg-slate-800 text-red-400 hover:bg-red-800 hover:text-white text-sm font-bold transition-colors shadow-lg"
            title={t('draw.deleteAll', lang)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Delete selected button */}
        {selectedIds.size > 0 && (
          <button
            onClick={deleteSelected}
            className="w-10 h-10 flex items-center justify-center rounded bg-red-700 text-white text-xs font-bold shadow-lg hover:bg-red-600 animate-pulse"
            title={t('draw.deleteSelected', lang)}
          >
            <div className="flex flex-col items-center leading-tight">
              <span>{selectedIds.size}</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
          </button>
        )}

        {/* Color picker */}
        {!selectMode && (
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-10 h-10 flex items-center justify-center rounded bg-slate-800 shadow-lg hover:bg-slate-700"
              title={t('draw.color', lang)}
            >
              <div className="w-6 h-6 rounded" style={{ backgroundColor: drawColor }} />
            </button>
            {showColorPicker && (
              <div className="absolute left-12 top-0 flex gap-1 bg-slate-800 p-2 rounded shadow-xl border border-slate-600">
                {DRAW_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setDrawColor(c.color); setShowColorPicker(false); }}
                    className={`w-8 h-8 rounded border-2 ${drawColor === c.color ? 'border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c.color }}
                    title={lang === 'no' ? c.label : c.labelEn}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Point count indicator */}
        {activeMode && drawPoints.length > 0 && (
          <div className="text-[10px] text-center text-emerald-400 mt-1">
            {drawPoints.length} pts
          </div>
        )}

        {/* Active mode hint */}
        {activeMode && (
          <div className="bg-slate-800/90 rounded px-2 py-1 mt-1 text-[10px] text-slate-300 max-w-[120px]">
            {activeMode === 'text'
              ? (lang === 'no' ? 'Klikk for tekst' : 'Click to place text')
              : (lang === 'no' ? 'Klikk for punkter, \u2713 for \u00e5 fullf\u00f8re' : 'Click to add points, \u2713 to finish')
            }
          </div>
        )}

        {/* Select mode hint */}
        {selectMode && (
          <div className="bg-slate-800/90 rounded px-2 py-1 mt-1 text-[10px] text-slate-300 max-w-[120px]">
            {selectedIds.size > 0
              ? `${selectedIds.size} ${t('draw.selected', lang)}`
              : t('draw.selectArea', lang)
            }
          </div>
        )}
      </div>

      {/* Drawing preview — SVG overlay on top of the map */}
      {screenPoints.length > 0 && (
        <svg className="absolute inset-0 pointer-events-none z-[6]" style={{ width: '100%', height: '100%' }}>
          {/* Circle preview */}
          {activeMode === 'circle' && screenPoints.length >= 2 && (() => {
            const cx = screenPoints[0].x;
            const cy = screenPoints[0].y;
            const ex = screenPoints[screenPoints.length - 1].x;
            const ey = screenPoints[screenPoints.length - 1].y;
            const r = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
            return (
              <>
                <circle cx={cx} cy={cy} r={r} fill={drawColor} fillOpacity="0.12" stroke={drawColor} strokeWidth="3" strokeDasharray="8 4" opacity="0.8" />
                {/* Radius line */}
                <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={drawColor} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
              </>
            );
          })()}
          {/* Polygon preview */}
          {activeMode === 'polygon' && screenPoints.length >= 2 && (
            <polygon
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill={drawColor}
              fillOpacity="0.12"
              stroke={drawColor}
              strokeWidth="3"
              strokeDasharray="8 4"
              opacity="0.8"
            />
          )}
          {/* Line / arrow preview */}
          {(activeMode === 'line' || activeMode === 'arrow') && screenPoints.length >= 2 && (
            <polyline
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={drawColor}
              strokeWidth="3"
              strokeDasharray="8 4"
              opacity="0.8"
            />
          )}
          {/* Preview points */}
          {screenPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="5"
              fill={drawColor}
              stroke="white"
              strokeWidth="2"
            />
          ))}
        </svg>
      )}

      {/* Selection rectangle overlay */}
      {selectionRect && (
        <svg className="absolute inset-0 pointer-events-none z-[7]" style={{ width: '100%', height: '100%' }}>
          <rect
            x={Math.min(selectionRect.startX, selectionRect.endX)}
            y={Math.min(selectionRect.startY, selectionRect.endY)}
            width={Math.abs(selectionRect.endX - selectionRect.startX)}
            height={Math.abs(selectionRect.endY - selectionRect.startY)}
            fill="#fbbf24"
            fillOpacity="0.15"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeDasharray="6 3"
          />
        </svg>
      )}
    </>
  );
}
