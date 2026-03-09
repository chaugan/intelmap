import { useState, useEffect, useRef, useMemo } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

function calcGridDimensions(ring) {
  if (!ring || ring.length < 5) return null;
  const sw = ring[0], se = ring[1], ne = ring[2];
  const R = 6371;
  const midLat = (sw[1] + ne[1]) / 2;
  const widthKm = R * Math.abs(se[0] - sw[0]) * Math.PI / 180 * Math.cos(midLat * Math.PI / 180);
  const heightKm = R * Math.abs(ne[1] - se[1]) * Math.PI / 180;
  return { widthKm, heightKm };
}

function fmtDist(km) {
  return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
}

export default function GridSettingsPanel({ visibleDrawings }) {
  const selectedDrawingId = useMapStore((s) => s.selectedDrawingId);
  const setSelectedDrawingId = useMapStore((s) => s.setSelectedDrawingId);
  const lang = useMapStore((s) => s.lang);

  const drawing = visibleDrawings.find(
    (d) => d.id === selectedDrawingId && d.drawingType === 'grid'
  );

  const [columns, setColumns] = useState('');
  const [opacity, setOpacity] = useState(0.5);
  const debounceRef = useRef(null);

  // Sync local state when selected drawing changes
  useEffect(() => {
    if (drawing) {
      setColumns(drawing.properties?.columns || 5);
      setOpacity(drawing.properties?.opacity ?? 0.05);
    }
  }, [drawing?.id]);

  if (!drawing) return null;

  const emitUpdate = (props) => {
    socket.emit('client:drawing:update', {
      projectId: drawing._projectId,
      id: drawing.id,
      properties: { ...drawing.properties, ...props },
    });
  };

  const handleColumnsChange = (e) => {
    const raw = e.target.value;
    if (raw === '') { setColumns(''); return; }
    const n = parseInt(raw);
    if (isNaN(n)) return;
    const clamped = Math.max(2, Math.min(52, n));
    setColumns(clamped);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      emitUpdate({ columns: clamped });
    }, 300);
  };

  const handleOpacityChange = (e) => {
    const val = parseFloat(e.target.value);
    setOpacity(val);
    emitUpdate({ opacity: val });
  };

  return (
    <div className="absolute top-4 right-4 z-20 w-72 bg-slate-900/95 rounded-lg shadow-xl border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <h3 className="text-sm font-semibold text-white">{t('grid.settings', lang)}</h3>
        <button
          onClick={() => setSelectedDrawingId(null)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Columns input */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('grid.size', lang)}</label>
          <input
            type="number"
            min={2}
            max={52}
            value={columns}
            onChange={handleColumnsChange}
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Cell size info */}
        {columns >= 2 && (() => {
          const dims = calcGridDimensions(drawing.geometry?.coordinates?.[0]);
          if (!dims) return null;
          const cellW = dims.widthKm / columns;
          const cellH = dims.heightKm / columns;
          return (
            <div className="text-xs text-slate-400">
              {t('grid.cellSize', lang)}: {fmtDist(cellW)} × {fmtDist(cellH)}
            </div>
          );
        })()}

        {/* Opacity slider */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            {t('grid.opacity', lang)}: {Math.round(opacity * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={handleOpacityChange}
            className="w-full accent-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
