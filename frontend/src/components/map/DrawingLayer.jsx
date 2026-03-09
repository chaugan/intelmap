import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore, getAllVisibleDrawings } from '../../stores/useTacticalStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
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
  const drawingToolsVisible = useMapStore((s) => s.drawingToolsVisible);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const tacticalState = useTacticalStore();
  const drawings = getAllVisibleDrawings(tacticalState);
  const user = useAuthStore((s) => s.user);
  const [localDrawings, setLocalDrawings] = useState([]);
  const [activeMode, setActiveMode] = useState(null);
  const [drawColor, setDrawColor] = useState('#3b82f6');
  const [drawPoints, setDrawPoints] = useState([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [cursorPoint, setCursorPoint] = useState(null); // [lng, lat] for circle preview
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

  // Share active drawing mode with store so MeasuringTool can yield
  useEffect(() => {
    useMapStore.setState({ drawingActiveMode: activeMode });
    return () => useMapStore.setState({ drawingActiveMode: null });
  }, [activeMode]);

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

    const currentState = useTacticalStore.getState();
    const currentProjectId = currentState.activeProjectId;
    const currentLayerId = currentState.activeLayerId;
    const currentUser = useAuthStore.getState().user;

    if (geometry) {
      if (currentProjectId) {
        // Logged in with active project - save to server
        socket.emit('client:drawing:add', {
          projectId: currentProjectId,
          drawingType,
          geometry,
          layerId: currentLayerId || null,
          properties: {
            color,
            lineType: mode === 'arrow' ? 'arrow' : 'solid',
            fillOpacity: 0.15,
            label: label || undefined,
          },
          source: 'user',
          createdBy: socket.id,
        });
      } else if (!currentUser) {
        // Not logged in - add to local drawings (not saved)
        setLocalDrawings((prev) => [...prev, {
          id: `local-${Date.now()}`,
          drawingType,
          geometry,
          properties: {
            color,
            lineType: mode === 'arrow' ? 'arrow' : 'solid',
            fillOpacity: 0.15,
            label: label || undefined,
          },
          _local: true,
        }]);
      }
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
        const textState = useTacticalStore.getState();
        const currentPid = textState.activeProjectId;
        const currentLid = textState.activeLayerId;
        const currentUser = useAuthStore.getState().user;
        if (text) {
          if (currentPid) {
            // Logged in with active project - save to server
            socket.emit('client:drawing:add', {
              projectId: currentPid,
              drawingType: 'text',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              layerId: currentLid || null,
              properties: { text, color: drawColorRef.current },
              source: 'user',
              createdBy: socket.id,
            });
          } else if (!currentUser) {
            // Not logged in - add to local drawings
            setLocalDrawings((prev) => [...prev, {
              id: `local-${Date.now()}`,
              drawingType: 'text',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: { text, color: drawColorRef.current },
              _local: true,
            }]);
          }
        }
        setActiveMode(null);
        return;
      }

      if (activeModeRef.current === 'circle' && drawPointsRef.current.length === 1) {
        // Second click: set edge point and auto-finish
        setDrawPoints(prev => [...prev, [lng, lat]]);
        setCursorPoint(null);
        // Use setTimeout so drawPoints state updates before finishDrawing reads it
        setTimeout(() => finishDrawing(), 0);
        return;
      }

      setDrawPoints(prev => [...prev, [lng, lat]]);
    };

    mapRefValue.on('click', handler);
    return () => mapRefValue.off('click', handler);
  }, [mapRefValue, lang, placementMode, selectMode, finishDrawing]);

  // Circle preview: follow cursor after center is placed
  useEffect(() => {
    if (!mapRefValue) return;
    const handler = (e) => {
      if (activeModeRef.current !== 'circle') return;
      if (drawPointsRef.current.length !== 1) return;
      const { lng, lat } = e.lngLat;
      setCursorPoint([lng, lat]);
    };
    mapRefValue.on('mousemove', handler);
    return () => mapRefValue.off('mousemove', handler);
  }, [mapRefValue]);

  // Rectangle selection drag handlers
  useEffect(() => {
    if (!selectMode || !mapRefValue) return;

    const canvas = mapRefValue.getCanvas();

    canvas.style.touchAction = 'none';

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect({ startX: x, startY: y, endX: x, endY: y });
      // Disable map drag during selection
      mapRefValue.dragPan.disable();
    };

    const onPointerMove = (e) => {
      if (!isDraggingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect(prev => prev ? { ...prev, endX: x, endY: y } : null);
    };

    const onPointerUp = (e) => {
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

        // Find drawings that intersect the box (from all visible projects)
        const state = useTacticalStore.getState();
        const allDrawings = getAllVisibleDrawings(state);
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

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.style.touchAction = '';
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
    if (selectedIds.size === 0 || !activeProjectId) return;
    socket.emit('client:drawing:delete-batch', { projectId: activeProjectId, ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
  }, [selectedIds, activeProjectId]);

  const deleteAll = useCallback(() => {
    if (!activeProjectId) return;
    const ok = confirm(t('draw.confirmDeleteAll', lang));
    if (!ok) return;
    const allIds = drawings.map(d => d.id);
    if (allIds.length > 0) {
      socket.emit('client:drawing:delete-batch', { projectId: activeProjectId, ids: allIds });
    }
    exitSelectMode();
  }, [lang, exitSelectMode, activeProjectId, drawings]);

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

  // Cancel in-progress drawing when tools are hidden
  useEffect(() => {
    if (!drawingToolsVisible) {
      setActiveMode(null);
      setDrawPoints([]);
      setCursorPoint(null);
      if (selectMode) exitSelectMode();
    }
  }, [drawingToolsVisible]);

  // Keyboard shortcuts: Enter to finish, Escape to cancel
  useEffect(() => {
    if (!activeMode) return;
    const onKeyDown = (e) => {
      if (e.key === 'Enter' && activeModeRef.current && activeModeRef.current !== 'text' && drawPointsRef.current.length >= 2) {
        e.preventDefault();
        finishDrawing();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setActiveMode(null);
        setDrawPoints([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeMode]);

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
      {drawingToolsVisible && <div className="absolute top-16 left-4 z-10 flex flex-col gap-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              if (selectMode) exitSelectMode();
              if (activeMode === tool.id) {
                finishDrawing();
              } else {
                setDrawPoints([]);
                setCursorPoint(null);
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

        {/* Finish / Cancel buttons */}
        {activeMode && (
          <div className="flex flex-col gap-3 mt-2">
            {activeMode !== 'text' && drawPoints.length >= 2 && (
              <button
                onClick={finishDrawing}
                className="w-10 h-10 flex items-center justify-center rounded bg-emerald-600 text-white text-sm font-bold shadow-lg hover:bg-emerald-500"
                title="Finish (Enter)"
              >
                {'\u2713'}
              </button>
            )}
            <button
              onClick={() => { setActiveMode(null); setDrawPoints([]); }}
              className="w-10 h-10 flex items-center justify-center rounded bg-red-800 text-white text-sm font-bold shadow-lg hover:bg-red-700"
              title="Cancel (Esc)"
            >
              {'\u2715'}
            </button>
          </div>
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

        {/* Delete all button (server drawings) */}
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

        {/* Clear local drawings button */}
        {localDrawings.length > 0 && (
          <button
            onClick={() => {
              const ok = confirm(lang === 'no' ? 'Slett alle lokale tegninger?' : 'Delete all local drawings?');
              if (ok) setLocalDrawings([]);
            }}
            className="w-10 h-10 flex items-center justify-center rounded bg-amber-700 text-white hover:bg-amber-600 text-sm font-bold transition-colors shadow-lg"
            title={lang === 'no' ? 'Slett lokale tegninger' : 'Clear local drawings'}
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
              <div className="absolute left-12 top-0 bg-slate-800 p-2 rounded shadow-xl border border-slate-600">
                <div className="grid grid-cols-5 gap-1 mb-2">
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
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="color"
                    value={drawColor}
                    onChange={(e) => { setDrawColor(e.target.value); }}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent p-0"
                  />
                  <span className="text-[10px] text-slate-400">{lang === 'no' ? 'Egendefinert' : 'Custom'}</span>
                </label>
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

        {/* Not logged in warning */}
        {!user && !activeProjectId && (
          <div className="bg-amber-600/90 rounded px-2 py-1 mt-2 text-[10px] text-white max-w-[120px] text-center">
            {lang === 'no' ? 'Ikke lagret (ikke innlogget)' : 'Not saved (not logged in)'}
          </div>
        )}

        {/* Local drawings count */}
        {localDrawings.length > 0 && (
          <div className="text-[10px] text-center text-amber-400 mt-1">
            {localDrawings.length} {lang === 'no' ? 'lokal' : 'local'}
          </div>
        )}
      </div>}

      {/* Drawing preview — SVG overlay on top of the map */}
      {(screenPoints.length > 0 || (activeMode === 'circle' && drawPoints.length === 1 && cursorPoint)) && (
        <svg className="absolute inset-0 pointer-events-none z-[6]" style={{ width: '100%', height: '100%' }}>
          {/* Circle preview — follows cursor after center is placed */}
          {activeMode === 'circle' && screenPoints.length >= 1 && (() => {
            const cx = screenPoints[0].x;
            const cy = screenPoints[0].y;
            // Use cursor position for live preview, or second clicked point
            let ep = screenPoints.length >= 2 ? screenPoints[screenPoints.length - 1] : null;
            if (!ep && cursorPoint && mapRefValue) {
              try { const p = mapRefValue.project(cursorPoint); ep = { x: p.x, y: p.y }; } catch {}
            }
            if (!ep) return null;
            const r = Math.sqrt((ep.x - cx) ** 2 + (ep.y - cy) ** 2);
            return (
              <>
                <circle cx={cx} cy={cy} r={r} fill={drawColor} fillOpacity="0.12" stroke={drawColor} strokeWidth="3" strokeDasharray="8 4" opacity="0.8" />
                <line x1={cx} y1={cy} x2={ep.x} y2={ep.y} stroke={drawColor} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
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
            <>
              <polyline
                points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={drawColor}
                strokeWidth="3"
                strokeDasharray="8 4"
                opacity="0.8"
              />
              {activeMode === 'arrow' && (() => {
                const p1 = screenPoints[screenPoints.length - 2];
                const p2 = screenPoints[screenPoints.length - 1];
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const size = 18;
                const halfW = 10;
                const tip = p2;
                const leftX = tip.x - size * Math.cos(angle) + halfW * Math.sin(angle);
                const leftY = tip.y - size * Math.sin(angle) - halfW * Math.cos(angle);
                const rightX = tip.x - size * Math.cos(angle) - halfW * Math.sin(angle);
                const rightY = tip.y - size * Math.sin(angle) + halfW * Math.cos(angle);
                return (
                  <polygon
                    points={`${tip.x},${tip.y} ${leftX},${leftY} ${rightX},${rightY}`}
                    fill={drawColor}
                    opacity="0.8"
                  />
                );
              })()}
            </>
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

      {/* Local drawings SVG overlay (not saved - non-logged-in users) */}
      {mapRefValue && localDrawings.length > 0 && (
        <svg className="absolute inset-0 z-[5]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {localDrawings.map(d => {
            const color = d.properties?.color || '#3b82f6';
            const key = d.id;

            const projectCoord = (coord) => {
              try { const p = mapRefValue.project(coord); return { x: p.x, y: p.y }; }
              catch { return null; }
            };

            const projectCoords = (coords) => coords.map(c => projectCoord(c)).filter(Boolean);

            const handleDelete = (e) => {
              e.preventDefault();
              e.stopPropagation();
              setLocalDrawings((prev) => prev.filter((ld) => ld.id !== d.id));
            };

            if (d.geometry.type === 'LineString') {
              const pts = projectCoords(d.geometry.coordinates);
              if (pts.length < 2) return null;
              const midPt = pts[Math.floor(pts.length / 2)];
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={handleDelete}>
                  {/* Local indicator dot */}
                  <circle cx={pts[0].x} cy={pts[0].y} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  {/* Invisible wider stroke for easier clicking */}
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="12"
                  />
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeDasharray={d.properties?.lineType === 'dashed' ? '8 4' : 'none'}
                  />
                  {(d.properties?.lineType === 'arrow' || d.drawingType === 'arrow') && (() => {
                    const p1 = pts[pts.length - 2];
                    const p2 = pts[pts.length - 1];
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const size = 18, halfW = 10;
                    return (
                      <polygon
                        points={`${p2.x},${p2.y} ${p2.x - size * Math.cos(angle) + halfW * Math.sin(angle)},${p2.y - size * Math.sin(angle) - halfW * Math.cos(angle)} ${p2.x - size * Math.cos(angle) - halfW * Math.sin(angle)},${p2.y - size * Math.sin(angle) + halfW * Math.cos(angle)}`}
                        fill={color}
                      />
                    );
                  })()}
                  {d.properties?.label && (
                    <text x={midPt.x} y={midPt.y - 10} textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (d.geometry.type === 'Polygon') {
              const ring = d.geometry.coordinates[0];
              const pts = projectCoords(ring);
              if (pts.length < 3) return null;
              const centroid = {
                x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
                y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
              };
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={handleDelete}>
                  {/* Local indicator dot */}
                  <circle cx={pts[0].x} cy={pts[0].y} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  <polygon
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={color}
                    fillOpacity={d.properties?.fillOpacity ?? 0.15}
                    stroke={color}
                    strokeWidth="2"
                  />
                  {d.properties?.label && (
                    <text x={centroid.x} y={centroid.y} textAnchor="middle" dominantBaseline="central"
                      fill="#ffffff" fontSize="16" fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (d.geometry.type === 'Point' && d.drawingType === 'text') {
              const pt = projectCoord(d.geometry.coordinates);
              if (!pt) return null;
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={handleDelete}>
                  {/* Local indicator dot */}
                  <circle cx={pt.x - 10} cy={pt.y - 10} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central"
                    fill="#ffffff" fontSize="18" fontWeight="700"
                    stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties?.text || ''}</text>
                </g>
              );
            }

            return null;
          })}
        </svg>
      )}
    </>
  );
}
