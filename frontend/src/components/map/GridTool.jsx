import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

// Latitude-corrected rectangle area
function calculateRectArea(c1, c2) {
  const R = 6371;
  const midLat = (c1.lat + c2.lat) / 2;
  const height = R * Math.abs(c2.lat - c1.lat) * Math.PI / 180;
  const width = R * Math.abs(c2.lng - c1.lng) * Math.PI / 180 * Math.cos(midLat * Math.PI / 180);
  return { area: width * height, widthKm: width, heightKm: height };
}

// Column label: 0→A, 1→B, ..., 25→Z, 26→AA, 27→AB, ...
function colLabel(n) {
  let s = '';
  n++;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export default function GridTool() {
  const mapRef = useMapStore((s) => s.mapRef);
  const gridToolVisible = useMapStore((s) => s.gridToolVisible);
  const drawingActiveMode = useMapStore((s) => s.drawingActiveMode);
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);

  const [phase, setPhase] = useState('idle'); // 'idle' | 'drawing' | 'dialog'
  const [corner1, setCorner1] = useState(null);
  const [corner2, setCorner2] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [columns, setColumns] = useState(5);
  const [, setTick] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const corner1Ref = useRef(corner1);
  corner1Ref.current = corner1;

  // Reset when tool hidden
  useEffect(() => {
    if (!gridToolVisible) {
      setPhase('idle');
      setCorner1(null);
      setCorner2(null);
      setMousePos(null);
      setColumns(5);
    }
  }, [gridToolVisible]);

  // Snap to square: given corner1 and a raw cursor position, adjust c2
  // so the rectangle has equal width and height in km (latitude-corrected)
  const snapToSquare = useCallback((c1, raw) => {
    const cosLat = Math.cos(((c1.lat + raw.lat) / 2) * Math.PI / 180);
    const dLng = raw.lng - c1.lng;
    const dLat = raw.lat - c1.lat;
    // Width in degrees that equals the same km distance as dLat
    // 1° lat ≈ 111.32 km, 1° lng ≈ 111.32 * cos(lat) km
    // We want |dLng| * cosLat = |dLat|  →  |dLng| = |dLat| / cosLat
    const absDLat = Math.abs(dLat);
    const squareDLng = absDLat / (cosLat || 1);
    return {
      lng: c1.lng + Math.sign(dLng) * squareDLng,
      lat: raw.lat,
    };
  }, []);

  const handleClick = useCallback((e) => {
    if (drawingActiveMode) return;
    const { lng, lat } = e.lngLat;

    if (phaseRef.current === 'idle') {
      setCorner1({ lng, lat });
      setPhase('drawing');
    } else if (phaseRef.current === 'drawing') {
      const c1 = corner1Ref.current;
      if (c1) {
        const snapped = snapToSquare(c1, { lng, lat });
        setCorner2(snapped);
      } else {
        setCorner2({ lng, lat });
      }
      setPhase('dialog');
    }
  }, [drawingActiveMode, snapToSquare]);

  const handleMouseMove = useCallback((e) => {
    if (phaseRef.current === 'drawing') {
      const c1 = corner1Ref.current;
      if (c1) {
        setMousePos(snapToSquare(c1, { lng: e.lngLat.lng, lat: e.lngLat.lat }));
      } else {
        setMousePos({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      }
    }
  }, [snapToSquare]);

  // Escape key handling
  useEffect(() => {
    if (!gridToolVisible) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (phaseRef.current === 'dialog') {
          setPhase('drawing');
          setCorner2(null);
        } else if (phaseRef.current === 'drawing') {
          setPhase('idle');
          setCorner1(null);
          setMousePos(null);
        } else {
          useMapStore.getState().toggleGridTool();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gridToolVisible]);

  // Map event listeners
  useEffect(() => {
    if (!mapRef || !gridToolVisible || phase === 'dialog') return;

    mapRef.on('click', handleClick);
    mapRef.on('mousemove', handleMouseMove);

    const onMove = () => setTick((n) => n + 1);
    mapRef.on('move', onMove);

    mapRef.doubleClickZoom.disable();
    mapRef.getCanvas().style.cursor = 'crosshair';

    return () => {
      mapRef.off('click', handleClick);
      mapRef.off('mousemove', handleMouseMove);
      mapRef.off('move', onMove);
      mapRef.doubleClickZoom.enable();
      mapRef.getCanvas().style.cursor = '';
    };
  }, [mapRef, gridToolVisible, phase, handleClick, handleMouseMove]);

  const handleCreate = useCallback(() => {
    if (!corner1 || !corner2 || !columns) return;

    const c1 = corner1;
    const c2 = corner2;

    socket.emit('client:drawing:add', {
      projectId: activeProjectId,
      layerId: activeLayerId || null,
      drawingType: 'grid',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [c1.lng, c1.lat],
          [c2.lng, c1.lat],
          [c2.lng, c2.lat],
          [c1.lng, c2.lat],
          [c1.lng, c1.lat],
        ]],
      },
      properties: { columns, color: '#3b82f6', strokeWidth: 2 },
      source: 'user',
      createdBy: socket.id,
    });

    // Reset
    setPhase('idle');
    setCorner1(null);
    setCorner2(null);
    setMousePos(null);
    setColumns(5);
  }, [corner1, corner2, columns, activeProjectId, activeLayerId]);

  if (!gridToolVisible || !mapRef) return null;

  const project = (coord) => {
    try {
      const p = mapRef.project([coord.lng, coord.lat]);
      return { x: p.x, y: p.y };
    } catch {
      return null;
    }
  };

  // Compute preview rectangle corners
  const previewC2 = phase === 'drawing' ? mousePos : corner2;
  const c1 = corner1;
  const showRect = c1 && previewC2;

  let rectArea = null;
  if (showRect) {
    rectArea = calculateRectArea(c1, previewC2);
  }

  // Dialog data — always square so rows = columns
  const dialogArea = corner1 && corner2 ? calculateRectArea(corner1, corner2) : null;
  const rows = columns;

  return (
    <>
      {/* SVG overlay for rectangle preview */}
      {showRect && phase !== 'dialog' && (() => {
        const sw = [c1.lng, c1.lat];
        const se = [previewC2.lng, c1.lat];
        const ne = [previewC2.lng, previewC2.lat];
        const nw = [c1.lng, previewC2.lat];

        const pts = [sw, se, ne, nw].map(c => {
          try { const p = mapRef.project(c); return { x: p.x, y: p.y }; }
          catch { return null; }
        }).filter(Boolean);

        if (pts.length < 4) return null;

        return (
          <svg className="absolute inset-0 z-[5]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
            <polygon
              points={pts.map(p => `${p.x},${p.y}`).join(' ')}
              fill="#3b82f6"
              fillOpacity="0.1"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="8 4"
            />
            {/* Area label */}
            {rectArea && (() => {
              const cx = (pts[0].x + pts[2].x) / 2;
              const cy = (pts[0].y + pts[2].y) / 2;
              return (
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="central"
                  fill="#ffffff" fontSize="14" fontWeight="600"
                  stroke="#000000" strokeWidth="3" paintOrder="stroke"
                >
                  {rectArea.area < 1 ? `${(rectArea.area * 1000000).toFixed(0)} m²` : `${rectArea.area.toFixed(2)} km²`}
                </text>
              );
            })()}
          </svg>
        );
      })()}

      {/* Hint text */}
      {phase === 'idle' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-slate-800/90 text-white px-4 py-2 rounded shadow-lg text-sm">
          {!activeProjectId ? t('grid.noProject', lang) : t('grid.clickFirst', lang)}
        </div>
      )}
      {phase === 'drawing' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-slate-800/90 text-white px-4 py-2 rounded shadow-lg text-sm">
          {t('grid.clickSecond', lang)}
        </div>
      )}

      {/* Column count dialog */}
      {phase === 'dialog' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) { setPhase('drawing'); setCorner2(null); } }}>
          <div className="bg-slate-800 rounded-lg shadow-2xl p-6 min-w-[340px] text-white" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t('layer.grid', lang)}</h3>

            <label className="block text-sm text-slate-300 mb-2">{t('grid.columns', lang)}</label>
            <input
              type="number"
              min={2}
              max={52}
              value={columns}
              onChange={(e) => setColumns(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white mb-4 focus:outline-none focus:border-blue-500"
              autoFocus
            />

            {/* Preview info */}
            <div className="bg-slate-700/50 rounded p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">{t('grid.preview', lang)}:</span>
                <span className="font-medium">{columns} × {rows}</span>
              </div>
              {dialogArea && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t('grid.area', lang)}:</span>
                    <span>{dialogArea.area < 1 ? `${(dialogArea.area * 1000000).toFixed(0)} m²` : `${dialogArea.area.toFixed(2)} km²`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t('grid.cellSize', lang)}:</span>
                    <span>
                      {(dialogArea.widthKm / columns) < 1
                        ? `${(dialogArea.widthKm / columns * 1000).toFixed(0)} m`
                        : `${(dialogArea.widthKm / columns).toFixed(2)} km`}
                      {' × '}
                      {(dialogArea.heightKm / rows) < 1
                        ? `${(dialogArea.heightKm / rows * 1000).toFixed(0)} m`
                        : `${(dialogArea.heightKm / rows).toFixed(2)} km`}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Grid preview graphic */}
            <div className="bg-slate-900 rounded p-3 mb-4 flex justify-center">
              <svg width="200" height={200 * (rows / columns)} viewBox={`0 0 ${columns} ${rows}`} className="max-h-[150px]">
                <rect x="0" y="0" width={columns} height={rows} fill="none" stroke="#3b82f6" strokeWidth="0.06" />
                {Array.from({ length: columns - 1 }, (_, i) => (
                  <line key={`v${i}`} x1={i + 1} y1={0} x2={i + 1} y2={rows} stroke="#3b82f6" strokeWidth="0.03" opacity="0.6" />
                ))}
                {Array.from({ length: rows - 1 }, (_, i) => (
                  <line key={`h${i}`} x1={0} y1={i + 1} x2={columns} y2={i + 1} stroke="#3b82f6" strokeWidth="0.03" opacity="0.6" />
                ))}
                {Array.from({ length: columns }, (_, i) => (
                  <text key={`c${i}`} x={i + 0.5} y={-0.15} textAnchor="middle" fill="#93c5fd" fontSize="0.4" fontWeight="bold">{colLabel(i)}</text>
                ))}
                {Array.from({ length: rows }, (_, i) => (
                  <text key={`r${i}`} x={-0.15} y={i + 0.6} textAnchor="end" fill="#93c5fd" fontSize="0.4" fontWeight="bold">{i + 1}</text>
                ))}
              </svg>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setPhase('drawing'); setCorner2(null); }}
                className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded transition-colors"
              >
                {t('grid.cancel', lang)}
              </button>
              <button
                onClick={handleCreate}
                disabled={!columns}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors font-medium"
              >
                {t('grid.create', lang)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
