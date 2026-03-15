import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { generateSymbolSvg } from '../../lib/milsymbol-utils.js';
import QRCodeOverlay from '../common/QRCodeOverlay.jsx';
import AuditLogDialog from './AuditLogDialog.jsx';
import LayerTableView from './LayerTableView.jsx';

// Drawing type icon component for the item list
function DrawingIcon({ type, color }) {
  const size = 14;
  if (type === 'ellipse') {
    return (<svg width={size} height={size} viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="7" ry="4.5" fill="none" stroke={color} strokeWidth="1.5" /></svg>);
  }
  if (type === 'note') {
    return (<svg width={size} height={size} viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.5" fill="none" stroke={color} strokeWidth="1.3" /><line x1="5" y1="5" x2="11" y2="5" stroke={color} strokeWidth="1" /><line x1="5" y1="8" x2="11" y2="8" stroke={color} strokeWidth="1" /><line x1="5" y1="11" x2="9" y2="11" stroke={color} strokeWidth="1" /></svg>);
  }
  if (type === 'needle') {
    return (<svg width={size} height={size} viewBox="0 0 16 16"><path d="M8 1C5.5 1 3.5 3 3.5 5.5C3.5 9 8 15 8 15s4.5-6 4.5-9.5C12.5 3 10.5 1 8 1z" fill="none" stroke={color} strokeWidth="1.3" /><circle cx="8" cy="5.5" r="1.5" fill={color} /></svg>);
  }
  if (type === 'grid') {
    return (<svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="0.5" /><line x1="5" y1="1" x2="5" y2="13" /><line x1="9" y1="1" x2="9" y2="13" /><line x1="1" y1="5" x2="13" y2="5" /><line x1="1" y1="9" x2="13" y2="9" /></svg>);
  }
  const TEXT_ICONS = { line: '/', arrow: '→', polygon: '⬡', circle: '◯', text: 'T' };
  return <span style={{ color }}>{TEXT_ICONS[type] || '?'}</span>;
}

function getDrawingLabel(d, lang) {
  if (d.drawingType === 'text' && d.properties?.text) return d.properties.text;
  if (d.properties?.label) return d.properties.label;
  if (d.drawingType === 'note' && d.properties?.markdown) {
    const preview = d.properties.markdown.replace(/[#*_~`>\-|]/g, '').trim();
    return preview.length > 30 ? preview.slice(0, 30) + '…' : preview;
  }
  const typeLabels = {
    line: { en: 'Line', no: 'Linje' },
    arrow: { en: 'Arrow', no: 'Pil' },
    polygon: { en: 'Polygon', no: 'Polygon' },
    circle: { en: 'Circle', no: 'Sirkel' },
    ellipse: { en: 'Ellipse', no: 'Ellipse' },
    text: { en: 'Text', no: 'Tekst' },
    needle: { en: 'Pin', no: 'Nål' },
    note: { en: 'Note', no: 'Notat' },
    grid: { en: 'Grid', no: 'Rutenett' },
  };
  return typeLabels[d.drawingType]?.[lang] || d.drawingType || 'Drawing';
}

function getDrawingCenter(d) {
  if (d.geometry.type === 'Point') return d.geometry.coordinates;
  if (d.geometry.type === 'LineString') {
    const mid = d.geometry.coordinates[Math.floor(d.geometry.coordinates.length / 2)];
    return mid;
  }
  if (d.geometry.type === 'Polygon') {
    const ring = d.geometry.coordinates[0];
    const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    return [lng, lat];
  }
  return null;
}

// Portal-rendered copy dropdown positioned next to the trigger button
function CopyDropdown({ anchorRef, copyTargets, item, lang, onCopy, onClose }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const dropW = 180, dropH = 200;
    const left = Math.min(rect.right, window.innerWidth - dropW - 8);
    const top = rect.bottom + 4 + dropH > window.innerHeight
      ? Math.max(8, rect.top - dropH - 4)
      : rect.bottom + 4;
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          anchorRef?.current && !anchorRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[99999] bg-slate-800 border border-slate-600 rounded shadow-xl py-1 w-[180px] text-[11px] max-h-48 overflow-y-auto"
      style={{ top: pos.top, left: pos.left }}
    >
      {copyTargets.map((ct) => (
        <div key={ct.projectId}>
          <div className="px-2 py-0.5 text-slate-500 font-medium truncate">{ct.projectName}</div>
          <button
            onClick={() => onCopy(item, ct.projectId, null)}
            className="w-full text-left px-3 py-0.5 hover:bg-slate-700 text-slate-400 italic"
          >
            {lang === 'no' ? '(Intet lag)' : '(No layer)'}
          </button>
          {ct.layers.map((l) => (
            <button
              key={l.id}
              onClick={() => onCopy(item, ct.projectId, l.id)}
              className="w-full text-left px-3 py-0.5 hover:bg-slate-700 text-slate-300 truncate"
            >
              {l.name}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}

function ItemList({ markers, drawings, viewsheds = [], rfCoverages = [], firingRanges = [], vulnerabilityAreas = [], lang, mapRef, projectId, copyTargets, copyingItemId, setCopyingItemId, onCopyItem, canEdit = true, focusedItemId, onSelectMarker, onSelectDrawing }) {
  const copyBtnRefs = useRef({});

  if (markers.length === 0 && drawings.length === 0 && viewsheds.length === 0 && rfCoverages.length === 0 && firingRanges.length === 0 && vulnerabilityAreas.length === 0) {
    return <div className="text-[10px] text-slate-600 italic pl-2 py-0.5">{lang === 'no' ? 'Tomt' : 'Empty'}</div>;
  }

  const flyTo = (coords) => {
    if (!mapRef || !coords) return;
    mapRef.flyTo({ center: coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
  };

  return (
    <div className="space-y-px pl-1.5 max-h-48 overflow-y-auto">
      {markers.map((m) => {
        const name = m.designation || m.customLabel || getSymbolName(m.sidc, lang);
        const sym = generateSymbolSvg(m.sidc, { size: 16 });
        const isCopying = copyingItemId === m.id;
        return (
          <div key={m.id} data-item-id={m.id} className={`relative ${focusedItemId === m.id ? 'drawer-focus-pulse' : ''}`}>
            <div className="flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50">
              <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: sym.svg }} />
              <span
                className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
                onClick={() => { flyTo([m.lon, m.lat]); if (onSelectMarker) onSelectMarker(m.id); }}
                title={name}
              >
                {name}
              </span>
              <button
                onClick={() => flyTo([m.lon, m.lat])}
                className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
                title={lang === 'no' ? 'Fly til' : 'Fly to'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
              {canEdit && copyTargets && onCopyItem && (
                <button
                  ref={(el) => { copyBtnRefs.current[m.id] = el; }}
                  onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : m.id); }}
                  className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                  title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => {
                    const msg = lang === 'no' ? `Slett "${name}"?` : `Delete "${name}"?`;
                    if (!confirm(msg)) return;
                    socket.emit('client:marker:delete', { projectId, id: m.id });
                  }}
                  className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                  title={lang === 'no' ? 'Slett' : 'Delete'}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[m.id] }} copyTargets={copyTargets} item={{ ...m, _type: 'marker' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
      {drawings.map((d) => {
        const label = getDrawingLabel(d, lang);
        const center = getDrawingCenter(d);
        const color = d.properties?.color || '#3b82f6';
        const isCopying = copyingItemId === d.id;
        return (
          <div key={d.id} data-item-id={d.id} className={`flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50 ${focusedItemId === d.id ? 'drawer-focus-pulse' : ''}`}>
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-xs font-bold rounded">
              <DrawingIcon type={d.drawingType} color={color} />
            </span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => { flyTo(center); if (onSelectDrawing) onSelectDrawing(d.id); }}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo(center)}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            {canEdit && copyTargets && onCopyItem && (
              <button
                ref={(el) => { copyBtnRefs.current[d.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : d.id); }}
                className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  const msg = lang === 'no' ? `Slett "${label}"?` : `Delete "${label}"?`;
                  if (!confirm(msg)) return;
                  socket.emit('client:drawing:delete-batch', { projectId, ids: [d.id] });
                }}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[d.id] }} copyTargets={copyTargets} item={{ ...d, _type: 'drawing' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
      {viewsheds.map((v) => {
        const isHorizon = v.type === 'horizon';
        const radiusStr = v.radiusKm ? `${Math.round(v.radiusKm * 10) / 10}km` : '';
        const typeLabel = isHorizon
          ? `${lang === 'no' ? 'Horisont' : 'Horizon'} ${radiusStr}`
          : `${lang === 'no' ? 'Siktanalyse' : 'Viewshed'} ${radiusStr}`;
        const label = v.label ? `${v.label} (${radiusStr})` : typeLabel;
        const isCopying = copyingItemId === v.id;
        return (
          <div key={v.id} className={`flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50 ${focusedItemId === v.id ? 'drawer-focus-pulse' : ''}`}>
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" stroke={isHorizon ? '#a855f7' : '#ef4444'} viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => flyTo([v.longitude, v.latitude])}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo([v.longitude, v.latitude])}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            {canEdit && copyTargets && onCopyItem && (
              <button
                ref={(el) => { copyBtnRefs.current[v.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : v.id); }}
                className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => { const msg = lang === 'no' ? `Slett "${label}"?` : `Delete "${label}"?`; if (!confirm(msg)) return; socket.emit('client:viewshed:delete', { projectId, id: v.id }); }}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[v.id] }} copyTargets={copyTargets} item={{ ...v, _type: 'viewshed' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
      {rfCoverages.map((c) => {
        const label = `RF ${c.frequencyMHz || '?'}MHz ${c.txPowerWatts || '?'}W`;
        const isCopying = copyingItemId === c.id;
        return (
          <div key={c.id} className={`flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50 ${focusedItemId === c.id ? 'drawer-focus-pulse' : ''}`}>
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" stroke="#a855f7" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m0-12a4 4 0 100-8 4 4 0 000 8zm-6 2l-2 2m16-4l-2 2M6 16l-2 2m16-4l-2 2" />
              </svg>
            </span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => flyTo([c.longitude, c.latitude])}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo([c.longitude, c.latitude])}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            {canEdit && copyTargets && onCopyItem && (
              <button
                ref={(el) => { copyBtnRefs.current[c.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : c.id); }}
                className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => { const msg = lang === 'no' ? `Slett "${label}"?` : `Delete "${label}"?`; if (!confirm(msg)) return; socket.emit('client:rfcoverage:delete', { projectId, id: c.id }); }}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[c.id] }} copyTargets={copyTargets} item={{ ...c, _type: 'rfcoverage' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
      {firingRanges.map((fr) => {
        const presetLabel = fr.weaponPreset && fr.weaponPreset !== 'custom' ? fr.weaponPreset.toUpperCase() : '';
        const rangeStr = fr.maxRangeKm ? `${Math.round(fr.maxRangeKm * 10) / 10}km` : '';
        const typeLabel = `${lang === 'no' ? 'Artilleri' : 'Artillery'} ${presetLabel} ${rangeStr}`.trim();
        const label = fr.label ? `${fr.label} (${rangeStr})` : typeLabel;
        const isCopying = copyingItemId === fr.id;
        return (
          <div key={fr.id} className={`flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50 ${focusedItemId === fr.id ? 'drawer-focus-pulse' : ''}`}>
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" stroke={fr.color || '#22c55e'} viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
              </svg>
            </span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => flyTo([fr.longitude, fr.latitude])}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo([fr.longitude, fr.latitude])}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            {canEdit && copyTargets && onCopyItem && (
              <button
                ref={(el) => { copyBtnRefs.current[fr.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : fr.id); }}
                className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => { const msg = lang === 'no' ? `Slett "${label}"?` : `Delete "${label}"?`; if (!confirm(msg)) return; socket.emit('client:firing-range:delete', { projectId, id: fr.id }); }}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[fr.id] }} copyTargets={copyTargets} item={{ ...fr, _type: 'firingrange' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
      {vulnerabilityAreas.map((va) => {
        const presetLabel = va.weaponPreset && va.weaponPreset !== 'custom' ? va.weaponPreset.toUpperCase() : '';
        const rangeStr = va.maxRangeKm ? `${Math.round(va.maxRangeKm * 10) / 10}km` : '';
        const typeLabel = `${lang === 'no' ? 'Sårbarhet' : 'Vulnerability'} ${presetLabel} ${rangeStr}`.trim();
        const label = va.label ? `${va.label} (${rangeStr})` : typeLabel;
        const isCopying = copyingItemId === va.id;
        return (
          <div key={va.id} className={`flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50 ${focusedItemId === va.id ? 'drawer-focus-pulse' : ''}`}>
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" stroke={va.color || '#ef4444'} viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 9v4m0 4h.01M3.262 17.094l7.464-12.93a1.5 1.5 0 012.548 0l7.464 12.93A1.5 1.5 0 0119.464 19H4.536a1.5 1.5 0 01-1.274-2.294z" />
              </svg>
            </span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => flyTo([va.longitude, va.latitude])}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo([va.longitude, va.latitude])}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            {canEdit && copyTargets && onCopyItem && (
              <button
                ref={(el) => { copyBtnRefs.current[va.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setCopyingItemId(isCopying ? null : va.id); }}
                className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => { const msg = lang === 'no' ? `Slett "${label}"?` : `Delete "${label}"?`; if (!confirm(msg)) return; socket.emit('client:vulnerability:delete', { projectId, id: va.id }); }}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {isCopying && copyTargets && (
              <CopyDropdown anchorRef={{ current: copyBtnRefs.current[va.id] }} copyTargets={copyTargets} item={{ ...va, _type: 'vulnerability' }} lang={lang} onCopy={onCopyItem} onClose={() => setCopyingItemId(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectDrawer() {
  const lang = useMapStore((s) => s.lang);
  const toggleProjectDrawer = useMapStore((s) => s.toggleProjectDrawer);
  const user = useAuthStore((s) => s.user);
  const myProjects = useProjectStore((s) => s.myProjects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const shareProject = useProjectStore((s) => s.shareProject);
  const unshareProject = useProjectStore((s) => s.unshareProject);
  const unshareFromGroup = useProjectStore((s) => s.unshareFromGroup);
  const copyProject = useProjectStore((s) => s.copyProject);
  const shareWithOrg = useProjectStore((s) => s.shareWithOrg);
  const unshareFromOrg = useProjectStore((s) => s.unshareFromOrg);
  const groups = useProjectStore((s) => s.groups);
  const fetchGroups = useProjectStore((s) => s.fetchGroups);
  const loading = useProjectStore((s) => s.loading);

  const projects = useTacticalStore((s) => s.projects);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const showProject = useTacticalStore((s) => s.showProject);
  const hideProject = useTacticalStore((s) => s.hideProject);
  const setActiveProject = useTacticalStore((s) => s.setActiveProject);
  const reorderProjects = useTacticalStore((s) => s.reorderProjects);
  const reorderMyProjects = useProjectStore((s) => s.reorderMyProjects);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const setActiveLayer = useTacticalStore((s) => s.setActiveLayer);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useTacticalStore((s) => s.toggleLayerVisibility);
  const labelVisibility = useTacticalStore((s) => s.labelVisibility);
  const toggleLabelVisibility = useTacticalStore((s) => s.toggleLabelVisibility);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [expandedProject, setExpandedProject] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [sharingId, setSharingId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [renamingLayerId, setRenamingLayerId] = useState(null);
  const [renameLayerVal, setRenameLayerVal] = useState('');
  const [qrProject, setQrProject] = useState(null);
  const [qrLayerIds, setQrLayerIds] = useState(null);
  const [auditProject, setAuditProject] = useState(null);
  const [shareTokensProject, setShareTokensProject] = useState(null);
  const [shareTokens, setShareTokens] = useState([]);
  const [viewSavedId, setViewSavedId] = useState(null); // flash "saved" feedback
  const [expandedLayerId, setExpandedLayerId] = useState(null); // show items in layer
  const [expandedUnassigned, setExpandedUnassigned] = useState(null); // projectId for unassigned items
  const [copyingLayerId, setCopyingLayerId] = useState(null); // which layer's copy dropdown is open
  const [copyingItemId, setCopyingItemId] = useState(null); // which item's copy dropdown is open
  const [notInUseCollapsed, setNotInUseCollapsed] = useState({}); // { projectId: bool }
  const [tableViewLayer, setTableViewLayer] = useState(null); // { projectId, layerId, layerName } or null
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const mapRef = useMapStore((s) => s.mapRef);
  const selectedMarkerId = useMapStore((s) => s.selectedMarkerId);
  const selectedDrawingId = useMapStore((s) => s.selectedDrawingId);
  const setSelectedMarkerId = useMapStore((s) => s.setSelectedMarkerId);
  const setSelectedDrawingId = useMapStore((s) => s.setSelectedDrawingId);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedItemId, setFocusedItemId] = useState(null);
  const focusTimerRef = useRef(null);

  useEffect(() => {
    if (user) {
      fetchProjects();
      fetchGroups();
    }
  }, [user]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError('');
    try {
      const project = await createProject(newName.trim());
      setNewName('');
      showProject(project.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('projects.confirmDelete', lang))) return;
    try {
      hideProject(id);
      await deleteProject(id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRename = async (id) => {
    if (!renameVal.trim()) return;
    try {
      await renameProject(id, renameVal.trim());
      setRenamingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleShare = async (projectId) => {
    if (!selectedGroupId) return;
    try {
      await shareProject(projectId, selectedGroupId);
      setSharingId(null);
      setSelectedGroupId('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRenameLayer = (projectId, layerId) => {
    if (!renameLayerVal.trim()) return;
    socket.emit('client:layer:update', { projectId, id: layerId, name: renameLayerVal.trim() });
    setRenamingLayerId(null);
  };

  const handleCopyLayer = async (sourceProjectId, layerId, targetProjectId, targetCategory) => {
    try {
      const res = await fetch(`/api/projects/${sourceProjectId}/layers/${layerId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId, targetCategory }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Copy failed');
      const data = await res.json();
      // Refresh target project data
      if (targetProjectId && targetProjectId !== sourceProjectId) {
        socket.emit('client:project:join', { projectId: targetProjectId });
      }
      setCopyingLayerId(null);
    } catch (err) {
      console.error('Layer copy error:', err);
    }
  };

  const moveLayerCategory = (projectId, layerId, newCategory) => {
    socket.emit('client:layer:update', { projectId, id: layerId, category: newCategory });
    if (newCategory === 'not_in_use') {
      const { layerVisibility: lv } = useTacticalStore.getState();
      if (lv[layerId] !== false) toggleLayerVisibility(layerId);
    }
  };

  const handleSaveView = async (project) => {
    if (!mapRef) return;
    const confirmMsg = lang === 'no'
      ? `Lagre nåværende kartvisning for "${project.name}"?`
      : `Save current map view for "${project.name}"?`;
    if (!confirm(confirmMsg)) return;
    const ms = useMapStore.getState();
    const savedView = {
      // Camera
      longitude: mapRef.getCenter().lng,
      latitude: mapRef.getCenter().lat,
      zoom: mapRef.getZoom(),
      pitch: mapRef.getPitch(),
      bearing: mapRef.getBearing(),
      // Base map
      baseLayer: ms.baseLayer,
      // Data layer visibility
      windVisible: ms.windVisible,
      webcamsVisible: ms.webcamsVisible,
      avalancheVisible: ms.avalancheVisible,
      avalancheWarningsVisible: ms.avalancheWarningsVisible,
      snowDepthVisible: ms.snowDepthVisible,
      aircraftVisible: ms.aircraftVisible,
      vesselsVisible: ms.vesselsVisible,
      roadRestrictionsVisible: ms.roadRestrictionsVisible,
      trafficFlowVisible: ms.trafficFlowVisible,
      trafficInfoVisible: ms.trafficInfoVisible,
      sunlightVisible: ms.sunlightVisible,
      auroraVisible: ms.auroraVisible,
      infraVisible: ms.infraVisible,
      hillshadeVisible: ms.hillshadeVisible,
      terrainVisible: ms.terrainVisible,
      wmsTransportVisible: ms.wmsTransportVisible,
      wmsPlacenamesVisible: ms.wmsPlacenamesVisible,
      wmsContoursVisible: ms.wmsContoursVisible,
      wmsBordersVisible: ms.wmsBordersVisible,
    };
    try {
      await updateProjectSettings(project.id, { ...project.settings, savedView });
      setViewSavedId(project.id);
      setTimeout(() => setViewSavedId(null), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFlyTo = (project) => {
    const view = project.settings?.savedView;
    if (!view || !mapRef) return;
    // Apply map state
    const mapState = {};
    if (view.baseLayer) mapState.baseLayer = view.baseLayer;
    const visKeys = [
      'windVisible', 'webcamsVisible', 'avalancheVisible', 'avalancheWarningsVisible',
      'snowDepthVisible', 'aircraftVisible', 'vesselsVisible', 'roadRestrictionsVisible',
      'trafficFlowVisible', 'trafficInfoVisible', 'sunlightVisible', 'auroraVisible',
      'infraVisible', 'hillshadeVisible', 'terrainVisible',
      'wmsTransportVisible', 'wmsPlacenamesVisible', 'wmsContoursVisible', 'wmsBordersVisible',
    ];
    for (const key of visKeys) {
      if (key in view) mapState[key] = view[key];
    }
    if (Object.keys(mapState).length > 0) {
      useMapStore.setState(mapState);
    }
    // Fly to camera position
    mapRef.flyTo({
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      pitch: view.pitch || 0,
      bearing: view.bearing || 0,
      duration: 2000,
    });
  };

  const handleClearView = async (project) => {
    try {
      const { savedView, ...rest } = project.settings || {};
      await updateProjectSettings(project.id, rest);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = async (id) => {
    try {
      const project = await copyProject(id);
      showProject(project.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOrgShare = async (id, orgRole) => {
    try {
      if (orgRole === 'revoke') {
        await unshareFromOrg(id);
      } else {
        await shareWithOrg(id, orgRole);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnshare = async (projectId) => {
    try {
      await unshareProject(projectId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnshareGroup = async (projectId, groupId) => {
    try {
      await unshareFromGroup(projectId, groupId);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchShareTokens = async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/share-tokens`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // Filter out expired tokens
        const now = new Date();
        setShareTokens(data.filter(t => !t.expires_at || new Date(t.expires_at) > now));
        setShareTokensProject(projectId);
      }
    } catch {}
  };

  const revokeShareToken = async (tokenId) => {
    try {
      await fetch(`/api/projects/share-token/${tokenId}`, { method: 'DELETE', credentials: 'include' });
      setShareTokens(prev => prev.filter(t => t.id !== tokenId));
    } catch {}
  };

  const handleCopyItem = useCallback((item, targetProjectId, targetLayerId) => {
    const type = item._type;
    if (type === 'marker') {
      socket.emit('client:marker:add', {
        projectId: targetProjectId,
        layerId: targetLayerId || null,
        sidc: item.sidc,
        lat: item.lat,
        lon: item.lon,
        designation: item.designation || '',
        higherFormation: item.higherFormation || '',
        additionalInfo: item.additionalInfo || '',
        customLabel: item.customLabel || '',
      });
    } else if (type === 'drawing') {
      socket.emit('client:drawing:add', {
        projectId: targetProjectId,
        layerId: targetLayerId || null,
        drawingType: item.drawingType,
        geometry: item.geometry,
        properties: item.properties || {},
      });
    } else if (type === 'viewshed') {
      socket.emit('client:viewshed:save', {
        projectId: targetProjectId,
        layerId: targetLayerId || null,
        longitude: item.longitude,
        latitude: item.latitude,
        observerHeight: item.observerHeight,
        radiusKm: item.radiusKm,
        type: item.type || 'viewshed',
        geojson: item.geojson,
      });
    } else if (type === 'rfcoverage') {
      fetch('/api/rfcoverage/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId: targetProjectId,
          layerId: targetLayerId || null,
          longitude: item.longitude,
          latitude: item.latitude,
          antennaHeight: item.antennaHeight,
          txPowerWatts: item.txPowerWatts,
          frequencyMHz: item.frequencyMHz,
          radiusKm: item.radiusKm,
          geojson: typeof item.geojson === 'string' ? item.geojson : JSON.stringify(item.geojson),
          stats: typeof item.stats === 'string' ? item.stats : JSON.stringify(item.stats || {}),
        }),
      }).catch(err => console.error('RF coverage copy error:', err));
    } else if (type === 'firingrange') {
      socket.emit('client:firing-range:save', {
        projectId: targetProjectId,
        layerId: targetLayerId || null,
        longitude: item.longitude,
        latitude: item.latitude,
        gunAltitude: item.gunAltitude,
        weaponPreset: item.weaponPreset,
        maxRangeKm: item.maxRangeKm,
        minElevationMils: item.minElevationMils,
        maxElevationMils: item.maxElevationMils,
        muzzleVelocity: item.muzzleVelocity,
        geojson: typeof item.geojson === 'string' ? item.geojson : JSON.stringify(item.geojson),
        stats: typeof item.stats === 'string' ? item.stats : JSON.stringify(item.stats || {}),
        color: item.color,
        label: item.label || '',
      });
    } else if (type === 'vulnerability') {
      socket.emit('client:vulnerability:save', {
        projectId: targetProjectId,
        layerId: targetLayerId || null,
        longitude: item.longitude,
        latitude: item.latitude,
        targetAltitude: item.targetAltitude,
        weaponPreset: item.weaponPreset,
        maxRangeKm: item.maxRangeKm,
        minElevationMils: item.minElevationMils,
        maxElevationMils: item.maxElevationMils,
        muzzleVelocity: item.muzzleVelocity,
        geojson: typeof item.geojson === 'string' ? item.geojson : JSON.stringify(item.geojson),
        stats: typeof item.stats === 'string' ? item.stats : JSON.stringify(item.stats || {}),
        color: item.color,
        label: item.label || '',
      });
    }
    setCopyingItemId(null);
  }, []);

  // Compute copy targets: writable projects with their layers
  const copyTargets = myProjects
    .filter((p) => visibleProjectIds.includes(p.id) && (p.role === 'admin' || p.role === 'editor'))
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      layers: projects[p.id]?.layers || [],
    }));

  const isVisible = (id) => visibleProjectIds.includes(id);
  const isActive = (id) => activeProjectId === id;

  // --- Search logic ---
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const results = [];
    for (const p of myProjects) {
      const projData = projects[p.id];
      // Match project name
      if (p.name.toLowerCase().includes(q)) {
        results.push({ type: 'project', id: p.id, label: p.name, project: p });
      }
      if (!projData) continue;
      // Match layers
      for (const layer of projData.layers) {
        if (layer.name.toLowerCase().includes(q)) {
          results.push({ type: 'layer', id: layer.id, label: layer.name, project: p, layer });
        }
      }
      // Match markers
      for (const m of projData.markers) {
        const name = m.designation || m.customLabel || getSymbolName(m.sidc, lang) || '';
        if (name.toLowerCase().includes(q)) {
          const layer = projData.layers.find(l => l.id === m.layerId);
          results.push({ type: 'marker', id: m.id, label: name, project: p, layer, coords: [m.lon, m.lat], item: m });
        }
      }
      // Match drawings
      for (const d of projData.drawings) {
        const label = getDrawingLabel(d, lang);
        if (label.toLowerCase().includes(q)) {
          const layer = projData.layers.find(l => l.id === d.layerId);
          const center = getDrawingCenter(d);
          results.push({ type: 'drawing', id: d.id, label, project: p, layer, coords: center, item: d });
        }
      }
      // Match viewsheds
      for (const v of (projData.viewsheds || [])) {
        const radiusStr = v.radiusKm ? `${Math.round(v.radiusKm * 10) / 10}km` : '';
        const typeLabel = v.type === 'horizon'
          ? `${lang === 'no' ? 'Horisont' : 'Horizon'} ${radiusStr}`
          : `${lang === 'no' ? 'Siktanalyse' : 'Viewshed'} ${radiusStr}`;
        const label = v.label ? `${v.label} (${radiusStr})` : typeLabel;
        if (label.toLowerCase().includes(q)) {
          const layer = projData.layers.find(l => l.id === v.layerId);
          results.push({ type: 'viewshed', id: v.id, label, project: p, layer, coords: [v.longitude, v.latitude], item: v });
        }
      }
      // Match RF coverages
      for (const c of (projData.rfCoverages || [])) {
        const label = `RF ${c.frequencyMHz || '?'}MHz ${c.txPowerWatts || '?'}W`;
        if (label.toLowerCase().includes(q)) {
          const layer = projData.layers.find(l => l.id === c.layerId);
          results.push({ type: 'rfcoverage', id: c.id, label, project: p, layer, coords: [c.longitude, c.latitude], item: c });
        }
      }
    }
    return results;
  }, [searchQuery, myProjects, projects, lang]);

  const triggerFocus = useCallback((itemId) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    setFocusedItemId(itemId);
    focusTimerRef.current = setTimeout(() => setFocusedItemId(null), 20000);
    // Scroll the focused item into view after React renders
    setTimeout(() => {
      const el = document.querySelector(`[data-item-id="${itemId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }, []);

  // Sync map selection → drawer: expand project/layer and focus item
  const revealItemInDrawer = useCallback((itemId) => {
    if (!itemId) return;
    // Find which project and layer this item belongs to
    for (const pid of visibleProjectIds) {
      const proj = projects[pid];
      if (!proj) continue;
      const marker = proj.markers.find(m => m.id === itemId);
      if (marker) {
        setExpandedProject(pid);
        if (marker.layerId) {
          setExpandedLayerId(marker.layerId);
        } else {
          setExpandedUnassigned(pid);
        }
        triggerFocus(itemId);
        return;
      }
      const drawing = proj.drawings.find(d => d.id === itemId);
      if (drawing) {
        setExpandedProject(pid);
        if (drawing.layerId) {
          setExpandedLayerId(drawing.layerId);
        } else {
          setExpandedUnassigned(pid);
        }
        triggerFocus(itemId);
        return;
      }
    }
  }, [visibleProjectIds, projects, triggerFocus]);

  useEffect(() => {
    if (selectedMarkerId) revealItemInDrawer(selectedMarkerId);
  }, [selectedMarkerId, revealItemInDrawer]);

  useEffect(() => {
    if (selectedDrawingId) revealItemInDrawer(selectedDrawingId);
  }, [selectedDrawingId, revealItemInDrawer]);

  const handleSearchFlyTo = useCallback((coords) => {
    if (!mapRef || !coords) return;
    mapRef.flyTo({ center: coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
  }, [mapRef]);

  const handleSearchNavigate = useCallback((result) => {
    setSearchQuery('');
    const p = result.project;
    if (result.type === 'project') {
      if (!visibleProjectIds.includes(p.id)) showProject(p.id, myProjects.map(pr => pr.id));
      setExpandedProject(p.id);
      triggerFocus(p.id);
      return;
    }
    // Ensure project is visible and expanded
    if (!visibleProjectIds.includes(p.id)) showProject(p.id, myProjects.map(pr => pr.id));
    setExpandedProject(p.id);
    if (result.type === 'layer') {
      setActiveProject(p.id);
      setActiveLayer(result.layer.id);
      triggerFocus(result.layer.id);
      return;
    }
    // Data item: expand project, expand layer, focus item
    setActiveProject(p.id);
    if (result.layer) {
      setActiveLayer(result.layer.id);
      setExpandedLayerId(result.layer.id);
    } else {
      setExpandedUnassigned(p.id);
    }
    if (result.coords) {
      mapRef?.flyTo({ center: result.coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
    }
    triggerFocus(result.id);
  }, [visibleProjectIds, showProject, myProjects, setActiveProject, setActiveLayer, mapRef, triggerFocus]);

  // Drag-reorder for drawer order (all projects) and z-ordering (visible projects)
  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOver = (e, overId) => {
    e.preventDefault();
    if (!draggedId || draggedId === overId) return;
    const projectIds = myProjects.map(p => p.id);
    const fromIdx = projectIds.indexOf(draggedId);
    const toIdx = projectIds.indexOf(overId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = [...projectIds];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedId);
    reorderMyProjects(newOrder);
    // Also update visible z-order to match drawer order
    const newVisibleOrder = newOrder.filter(id => visibleProjectIds.includes(id));
    reorderProjects(newVisibleOrder);
  };
  const handleDragEnd = () => setDraggedId(null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-semibold text-emerald-400">
          {t('drawer.title', lang)}
        </h2>
        <button
          onClick={toggleProjectDrawer}
          className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white rounded hover:bg-slate-700 transition-colors"
          title={t('general.close', lang)}
        >
          &times;
        </button>
      </div>

      {/* Create new project */}
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0">
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={t('projects.namePlaceholder', lang)}
            className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            +
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>

      {/* Search bar */}
      <div className="px-3 py-1.5 border-b border-slate-700 shrink-0">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
            placeholder={t('drawer.search', lang)}
            className="w-full pl-7 pr-6 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-sm"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Search results */}
      {searchResults ? (
        <div className="flex-1 overflow-y-auto">
          {searchResults.length === 0 ? (
            <p className="text-slate-500 text-sm p-3 italic">{t('drawer.noResults', lang)}</p>
          ) : (
            <div className="py-1">
              {searchResults.map((r) => {
                const typeIcons = {
                  project: '\u{1F4C1}',
                  layer: '\u{1F4CB}',
                  marker: '\u{1F4CD}',
                  drawing: '\u{270F}',
                  viewshed: '\u{1F441}',
                  rfcoverage: '\u{1F4E1}',
                };
                const hasCoords = r.coords && r.type !== 'project' && r.type !== 'layer';
                return (
                  <div key={`${r.type}-${r.id}`} className="px-3 py-1 hover:bg-slate-700/40 group/sr">
                    <div className="flex items-center gap-2">
                      <span className="text-xs shrink-0" style={{ fontSize: '11px' }}>{typeIcons[r.type] || '?'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{r.label}</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {r.project.name}{r.layer ? ` \u203A ${r.layer.name}` : ''}
                        </div>
                      </div>
                      {hasCoords && (
                        <button
                          onClick={() => handleSearchFlyTo(r.coords)}
                          className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors opacity-0 group-hover/sr:opacity-100"
                          title={lang === 'no' ? 'Fly til' : 'Fly to'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleSearchNavigate(r)}
                        className="shrink-0 text-slate-600 hover:text-emerald-400 transition-colors opacity-0 group-hover/sr:opacity-100"
                        title={lang === 'no' ? 'Naviger til' : 'Navigate to'}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      /* Project list */
      <div className="flex-1 overflow-y-auto">
        {loading && myProjects.length === 0 && (
          <p className="text-slate-500 text-sm p-3">{t('general.loading', lang)}</p>
        )}
        {myProjects.length === 0 && !loading && (
          <p className="text-slate-500 text-sm p-3">{t('projects.noProjects', lang)}</p>
        )}
        {myProjects.map((p) => {
          const visible = isVisible(p.id);
          const active = isActive(p.id);
          const expanded = expandedProject === p.id;
          const projData = projects[p.id];
          const canEditProject = p.role === 'admin' || p.role === 'editor';

          return (
            <div
              key={p.id}
              className={`border-b border-slate-700/50 ${active ? 'bg-emerald-900/20 border-l-2 border-l-emerald-400' : ''} ${focusedItemId === p.id ? 'drawer-focus-pulse' : ''}`}
              draggable
              onDragStart={() => handleDragStart(p.id)}
              onDragOver={(e) => handleDragOver(e, p.id)}
              onDragEnd={handleDragEnd}
            >
              {/* Main row — whole row clickable to expand/collapse */}
              <div
                className="flex items-center gap-2 px-3 py-2 group cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => setExpandedProject(expanded ? null : p.id)}
              >
                {/* Drag handle */}
                <span
                  className="text-slate-600 cursor-grab text-base"
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  &#x2630;
                </span>

                {/* Eye toggle (visibility) */}
                <button
                  onClick={(e) => { e.stopPropagation(); visible ? hideProject(p.id) : showProject(p.id, myProjects.map(pr => pr.id)); }}
                  className={`w-7 h-7 flex items-center justify-center rounded ${
                    visible ? 'text-emerald-400' : 'text-slate-600'
                  }`}
                  title={visible ? t('drawer.hide', lang) : t('drawer.show', lang)}
                >
                  {visible ? (
                    <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                    </svg>
                  )}
                </button>

                {/* Star (active project) */}
                {visible && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setActiveProject(active ? null : p.id); }}
                    className={`w-7 h-7 flex items-center justify-center text-base ${
                      active ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'
                    }`}
                    title={t('drawer.setActive', lang)}
                  >
                    {active ? '\u2605' : '\u2606'}
                  </button>
                )}

                {/* Project name */}
                <div className="flex-1 min-w-0 ml-1">
                  {renamingId === p.id ? (
                    <input
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(p.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="w-full px-1 py-0.5 bg-slate-900 border border-emerald-500 rounded text-sm text-white focus:outline-none"
                    />
                  ) : (
                    <div
                      className="text-sm truncate"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (p.role === 'admin') {
                          setRenamingId(p.id);
                          setRenameVal(p.name);
                        }
                      }}
                    >
                      {p.name}
                    </div>
                  )}
                  {(p.sharedGroups?.length > 0 || p.orgShared || p.ownerId !== user?.id) && (
                    <div className="text-xs text-slate-500 leading-snug">
                      {p.ownerId !== user?.id && <span>{p.ownerUsername}</span>}
                      {p.sharedGroups?.length > 0 && (
                        <span>{p.ownerId !== user?.id ? ' \u00b7 ' : ''}{p.sharedGroups.map(g => g.name).join(', ')}</span>
                      )}
                      {p.orgShared && (
                        <span className="text-cyan-500">{(p.ownerId !== user?.id || p.sharedGroups?.length > 0) ? ' \u00b7 ' : ''}{t('projects.orgShared', lang)} ({t(`projects.org${p.orgShared === 'viewer' ? 'Viewer' : 'Editor'}`, lang)})</span>
                      )}
                      {p.role !== 'admin' && <span className="text-slate-600"> ({p.role})</span>}
                    </div>
                  )}
                </div>

                {/* Expand / collapse indicator */}
                <div className="w-7 h-7 flex items-center justify-center text-slate-500">
                  <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 4l8 6-8 6V4z" />
                  </svg>
                </div>
              </div>

              {/* Expanded section */}
              {expanded && (
                <div className="px-6 pb-2.5 space-y-1">
                  {/* Layers (only when project is loaded) */}
                  {projData && projData.layers.length === 0 && (
                    <p className="text-xs text-slate-600">{t('layers.noLayers', lang)}</p>
                  )}
                  {projData && (() => {
                    const topLevelActive = projData.layers.filter(l => l.category !== 'not_in_use' && !l.parentId);
                    const niuLayers = projData.layers.filter(l => l.category === 'not_in_use' && !l.parentId);
                    const subLayersOf = (parentId) => projData.layers.filter(l => l.parentId === parentId);
                    const renderLayerRow = (layer, isNotInUse) => {
                      const vis = layerVisibility[layer.id] !== false;
                      const labelsOn = labelVisibility[layer.id] !== false;
                      const isActiveLayer = active && activeLayerId === layer.id;
                      const layerMarkers = projData.markers.filter(m => m.layerId === layer.id);
                      const layerDrawings = projData.drawings.filter(d => d.layerId === layer.id);
                      const layerViewsheds = (projData.viewsheds || []).filter(v => v.layerId === layer.id);
                      const layerRFCoverages = (projData.rfCoverages || []).filter(c => c.layerId === layer.id);
                      const layerFiringRanges = (projData.firingRanges || []).filter(fr => fr.layerId === layer.id);
                      const layerVulnerabilityAreas = (projData.vulnerabilityAreas || []).filter(va => va.layerId === layer.id);
                      const mCount = layerMarkers.length;
                      const dCount = layerDrawings.length;
                      const vCount = layerViewsheds.length;
                      const rCount = layerRFCoverages.length;
                      const frCount = layerFiringRanges.length;
                      const vaCount = layerVulnerabilityAreas.length;
                      const isLayerExpanded = expandedLayerId === layer.id;
                      const hasItems = mCount + dCount + vCount + rCount + frCount + vaCount > 0;
                      return (
                        <div key={layer.id}>
                          <div className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 ${isActiveLayer ? 'bg-emerald-900/30 ring-1 ring-emerald-500/40' : ''} ${focusedItemId === layer.id ? 'drawer-focus-pulse' : ''}`}>
                            <input
                              type="checkbox"
                              checked={vis}
                              onChange={() => toggleLayerVisibility(layer.id)}
                              className="accent-emerald-500 w-3.5 h-3.5"
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleLabelVisibility(layer.id); }}
                              className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded transition-colors ${labelsOn ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-400'}`}
                              title={labelsOn ? t('layers.hideLabels', lang) : t('layers.showLabels', lang)}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10" />
                                {!labelsOn && <path strokeLinecap="round" strokeWidth={2.5} d="M2 2l20 20" stroke="currentColor" opacity="0.7" />}
                              </svg>
                            </button>
                            {hasItems ? (
                              <>
                                <button
                                  onClick={() => setExpandedLayerId(isLayerExpanded ? null : layer.id)}
                                  className="w-3 h-3 flex-shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                  <svg className={`w-2.5 h-2.5 transition-transform ${isLayerExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M6 4l8 6-8 6V4z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setTableViewLayer({ projectId: p.id, layerId: layer.id, layerName: layer.name }); }}
                                  className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-colors"
                                  title={t('drawer.tableView', lang)}
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path d="M3 10h18M3 14h18M3 6h18M3 18h18M8 6v12M16 6v12" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <span className="w-3 h-3 flex-shrink-0" />
                            )}
                            {renamingLayerId === layer.id ? (
                              <input
                                value={renameLayerVal}
                                onChange={(e) => setRenameLayerVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameLayer(p.id, layer.id);
                                  if (e.key === 'Escape') setRenamingLayerId(null);
                                }}
                                onBlur={() => setRenamingLayerId(null)}
                                autoFocus
                                className="flex-1 px-1 py-0 bg-slate-900 border border-emerald-500 rounded text-xs text-white focus:outline-none"
                              />
                            ) : (
                              <span
                                className={`flex-1 truncate cursor-pointer ${isActiveLayer ? 'text-emerald-300 font-medium' : 'text-slate-300 hover:text-white'}`}
                                onClick={() => {
                                  if (active) setActiveLayer(isActiveLayer ? null : layer.id);
                                }}
                                onDoubleClick={(e) => {
                                  if (!canEditProject) return;
                                  e.stopPropagation();
                                  setRenamingLayerId(layer.id);
                                  setRenameLayerVal(layer.name);
                                }}
                                title={t('drawer.setActiveLayer', lang)}
                              >
                                {isActiveLayer && '\u25B8 '}{layer.name}
                              </span>
                            )}
                            <span
                              className={`text-slate-500 mr-0.5 cursor-pointer hover:text-slate-300 ${hasItems ? '' : 'opacity-50'}`}
                              onClick={() => hasItems && setExpandedLayerId(isLayerExpanded ? null : layer.id)}
                              title={hasItems ? (lang === 'no' ? 'Vis innhold' : 'Show contents') : ''}
                            >
                              {mCount}m {dCount}d{vCount > 0 ? ` ${vCount}v` : ''}{rCount > 0 ? ` ${rCount}r` : ''}{frCount > 0 ? ` ${frCount}a` : ''}
                            </span>
                            {/* Move to Not in use / Active */}
                            {canEditProject && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveLayerCategory(p.id, layer.id, isNotInUse ? 'active' : 'not_in_use');
                                }}
                                className={`px-1.5 py-0 flex-shrink-0 rounded border text-[9px] font-medium transition-colors ${isNotInUse ? 'border-emerald-700 text-emerald-500 hover:bg-emerald-900/40' : 'border-slate-600 text-slate-400 hover:bg-amber-900/30 hover:text-amber-400 hover:border-amber-700'}`}
                                title={isNotInUse ? t('layers.moveToActive', lang) : t('layers.moveToNotInUse', lang)}
                              >
                                {isNotInUse ? '↑' : '↓'}
                              </button>
                            )}
                            {/* Copy layer */}
                            {(() => {
                              const canWriteSame = p.role === 'admin' || p.role === 'editor';
                              const writableOthers = myProjects.filter(tp => tp.id !== p.id && (tp.role === 'admin' || tp.role === 'editor'));
                              if (!canWriteSame && writableOthers.length === 0) return null;
                              return (
                                <div className="relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCopyingLayerId(copyingLayerId === layer.id ? null : layer.id);
                                    }}
                                    className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-cyan-400 hover:bg-cyan-900/30 transition-colors"
                                    title={t('layers.copy', lang)}
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <rect x="9" y="9" width="13" height="13" rx="2" />
                                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                    </svg>
                                  </button>
                                  {copyingLayerId === layer.id && (
                                    <div className="absolute right-0 top-5 z-50 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 min-w-[140px] text-xs">
                                      <div className="px-2 py-1 text-slate-500 font-medium">{t('layers.copyTo', lang)}</div>
                                      {canWriteSame && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleCopyLayer(p.id, layer.id, p.id); }}
                                          className="w-full text-left px-2 py-1 hover:bg-slate-700 text-slate-300"
                                        >
                                          {t('layers.sameProject', lang)}
                                        </button>
                                      )}
                                      {canWriteSame && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleCopyLayer(p.id, layer.id, p.id, 'not_in_use'); }}
                                          className="w-full text-left px-2 py-1 hover:bg-slate-700 text-slate-400"
                                        >
                                          {t('layers.notInUse', lang)}
                                        </button>
                                      )}
                                      {writableOthers.map(tp => (
                                        <button
                                          key={tp.id}
                                          onClick={(e) => { e.stopPropagation(); handleCopyLayer(p.id, layer.id, tp.id); }}
                                          className="w-full text-left px-2 py-1 hover:bg-slate-700 text-slate-300 truncate"
                                        >
                                          {tp.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {canEditProject && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const msg = t('layers.confirmDelete', lang).replace('{name}', layer.name);
                                  if (!confirm(msg)) return;
                                  socket.emit('client:layer:delete', { projectId: p.id, id: layer.id });
                                  if (activeLayerId === layer.id) setActiveLayer(null);
                                  if (expandedLayerId === layer.id) setExpandedLayerId(null);
                                }}
                                className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                                title={t('layers.delete', lang)}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {isLayerExpanded && (
                            <div className="ml-5 mt-0.5 mb-1 border-l border-slate-700 pl-1.5">
                              <ItemList markers={layerMarkers} drawings={layerDrawings} viewsheds={layerViewsheds} rfCoverages={layerRFCoverages} firingRanges={layerFiringRanges} vulnerabilityAreas={layerVulnerabilityAreas} lang={lang} mapRef={mapRef} projectId={p.id} copyTargets={copyTargets} copyingItemId={copyingItemId} setCopyingItemId={setCopyingItemId} onCopyItem={handleCopyItem} canEdit={canEditProject} focusedItemId={focusedItemId} onSelectMarker={setSelectedMarkerId} onSelectDrawing={setSelectedDrawingId} />
                            </div>
                          )}
                        </div>
                      );
                    };
                    return (
                      <>
                        {topLevelActive.map(l => (
                          <div key={l.id}>
                            {renderLayerRow(l, false)}
                            {/* Sub-layers */}
                            {subLayersOf(l.id).map(sub => (
                              <div key={sub.id} className="ml-4 border-l border-slate-700/50 pl-1">
                                {renderLayerRow(sub, false)}
                              </div>
                            ))}
                            {/* Add sub-layer button */}
                            {canEditProject && (
                              <button
                                onClick={() => {
                                  const name = prompt(lang === 'no' ? 'Navn på underlag:' : 'Sub-layer name:');
                                  if (!name?.trim()) return;
                                  socket.emit('client:layer:add', { projectId: p.id, name: name.trim(), parentId: l.id, source: 'user', createdBy: socket.id });
                                }}
                                className="ml-5 flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-400 py-0.5 px-1.5 rounded hover:bg-slate-700/50 transition-colors"
                                title={lang === 'no' ? 'Legg til underlag' : 'Add sub-layer'}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                {lang === 'no' ? '+ Underlag' : '+ Sub-layer'}
                              </button>
                            )}
                          </div>
                        ))}
                        {canEditProject && (
                          <div className={`border-t border-slate-600/50 mt-2 pt-1.5 ${niuLayers.length === 0 ? 'opacity-60' : ''}`}>
                            <button
                              onClick={() => setNotInUseCollapsed(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                              className="flex items-center gap-1.5 w-full text-left text-[11px] font-medium text-slate-500 hover:text-slate-400 mb-1"
                            >
                              <svg className={`w-2.5 h-2.5 transition-transform ${notInUseCollapsed[p.id] ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              {t('layers.notInUse', lang)}
                              {niuLayers.length > 0 && <span className="text-slate-600">({niuLayers.length})</span>}
                            </button>
                            {!notInUseCollapsed[p.id] && niuLayers.length > 0 && (
                              <div className="space-y-1">
                                {niuLayers.map(l => (
                                  <div key={l.id}>
                                    {renderLayerRow(l, true)}
                                    {subLayersOf(l.id).map(sub => (
                                      <div key={sub.id} className="ml-4 border-l border-slate-700/50 pl-1">
                                        {renderLayerRow(sub, true)}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {/* Unassigned items */}
                  {projData && (() => {
                    const unMarkers = projData.markers.filter(m => !m.layerId);
                    const unDrawings = projData.drawings.filter(d => !d.layerId);
                    const unViewsheds = (projData.viewsheds || []).filter(v => !v.layerId);
                    const unRFCoverages = (projData.rfCoverages || []).filter(c => !c.layerId);
                    const unFiringRanges = (projData.firingRanges || []).filter(fr => !fr.layerId);
                    const unVulnerabilityAreas = (projData.vulnerabilityAreas || []).filter(va => !va.layerId);
                    if (unMarkers.length + unDrawings.length + unViewsheds.length + unRFCoverages.length + unFiringRanges.length + unVulnerabilityAreas.length === 0) return null;
                    const isUnExpanded = expandedUnassigned === p.id;
                    return (
                      <div>
                        <div
                          className="flex items-center gap-1.5 text-xs text-slate-500 italic px-1.5 cursor-pointer hover:text-slate-400"
                          onClick={() => setExpandedUnassigned(isUnExpanded ? null : p.id)}
                        >
                          <svg className={`w-2.5 h-2.5 transition-transform flex-shrink-0 ${isUnExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6 4l8 6-8 6V4z" />
                          </svg>
                          {t('drawer.unassigned', lang)}: {unMarkers.length}m {unDrawings.length}d{unViewsheds.length > 0 ? ` ${unViewsheds.length}v` : ''}{unRFCoverages.length > 0 ? ` ${unRFCoverages.length}r` : ''}{unFiringRanges.length > 0 ? ` ${unFiringRanges.length}a` : ''}{unVulnerabilityAreas.length > 0 ? ` ${unVulnerabilityAreas.length}va` : ''}
                          <button
                            onClick={(e) => { e.stopPropagation(); setTableViewLayer({ projectId: p.id, layerId: null, layerName: t('drawer.unassigned', lang) }); }}
                            className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-colors ml-auto"
                            title={t('drawer.tableView', lang)}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path d="M3 10h18M3 14h18M3 6h18M3 18h18M8 6v12M16 6v12" />
                            </svg>
                          </button>
                        </div>
                        {isUnExpanded && (
                          <div className="ml-5 mt-0.5 mb-1 border-l border-slate-700 pl-1.5">
                            <ItemList markers={unMarkers} drawings={unDrawings} viewsheds={unViewsheds} rfCoverages={unRFCoverages} firingRanges={unFiringRanges} vulnerabilityAreas={unVulnerabilityAreas} lang={lang} mapRef={mapRef} projectId={p.id} copyTargets={copyTargets} copyingItemId={copyingItemId} setCopyingItemId={setCopyingItemId} onCopyItem={handleCopyItem} canEdit={canEditProject} focusedItemId={focusedItemId} onSelectMarker={setSelectedMarkerId} onSelectDrawing={setSelectedDrawingId} />
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Project actions */}
                  <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1.5">
                    {/* View save/fly row */}
                    <div className="flex items-center gap-1.5">
                      {/* Save current view */}
                      {p.role === 'admin' && (
                        <button
                          onClick={() => handleSaveView(p)}
                          className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded hover:bg-slate-700/50 ${
                            viewSavedId === p.id ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title={t('projects.saveView', lang)}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path d="M15 10l-4 4-2-2" />
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                          {viewSavedId === p.id ? t('projects.viewSaved', lang) : t('projects.saveView', lang)}
                        </button>
                      )}

                      {/* Fly to saved view */}
                      {p.settings?.savedView ? (
                        <button
                          onClick={() => handleFlyTo(p)}
                          className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 px-1.5 py-1 rounded hover:bg-slate-700/50"
                          title={t('projects.flyTo', lang)}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          </svg>
                          {t('projects.flyTo', lang)}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600 px-1.5 py-1">{t('projects.noSavedView', lang)}</span>
                      )}

                      {/* Clear saved view */}
                      {p.role === 'admin' && p.settings?.savedView && (
                        <button
                          onClick={() => handleClearView(p)}
                          className="text-xs text-slate-600 hover:text-red-400 px-1 py-1 rounded hover:bg-slate-700/50 ml-auto"
                          title={t('projects.clearView', lang)}
                        >
                          {'\u2715'}
                        </button>
                      )}
                    </div>

                    {/* Action buttons row */}
                    <div className="flex items-center gap-1.5">
                      {/* Copy */}
                      <button
                        onClick={() => handleCopy(p.id)}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-1.5 py-1 rounded hover:bg-slate-700/50"
                        title={t('projects.copy', lang)}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                        {t('projects.copy', lang)}
                      </button>

                      {/* Audit Log */}
                      {(p.role === 'admin' || p.role === 'editor') && (
                        <button
                          onClick={() => setAuditProject(p)}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-1.5 py-1 rounded hover:bg-slate-700/50"
                          title={t('audit.title', lang)}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                          </svg>
                          {t('audit.title', lang)}
                        </button>
                      )}

                      {/* QR Code */}
                      {(p.role === 'admin' || p.role === 'editor') && (() => {
                        const hasVisibleLayers = projData?.layers?.some(l => layerVisibility[l.id] !== false);
                        return (
                        <button
                          onClick={() => {
                            if (!hasVisibleLayers) return;
                            const visibleLayers = projData?.layers?.filter(l => layerVisibility[l.id] !== false) || [];
                            setQrProject(p);
                            setQrLayerIds(visibleLayers.map(l => l.id));
                          }}
                          className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded ${hasVisibleLayers ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50' : 'text-slate-600 opacity-30 cursor-not-allowed'}`}
                          title={hasVisibleLayers ? t('themes.generateQr', lang) : (lang === 'no' ? 'Ingen synlige lag' : 'No visible layers')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="3" height="3" />
                            <rect x="18" y="18" width="3" height="3" />
                          </svg>
                          QR
                        </button>
                        );
                      })()}

                      {/* Delete */}
                      {p.role === 'admin' && (
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400 px-1.5 py-1 rounded hover:bg-slate-700/50 ml-auto"
                          title={t('general.delete', lang)}
                        >
                          {'\u2715'} {t('general.delete', lang)}
                        </button>
                      )}
                    </div>

                    {/* Org share (admin only) */}
                    {p.role === 'admin' && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                        </svg>
                        <span className="text-slate-500">{t('projects.shareOrg', lang)}:</span>
                        <button
                          onClick={() => handleOrgShare(p.id, 'viewer')}
                          className={`px-1.5 py-0.5 rounded text-xs ${p.orgShared === 'viewer' ? 'bg-cyan-900/50 text-cyan-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                        >
                          {t('projects.orgViewer', lang)}
                        </button>
                        <button
                          onClick={() => handleOrgShare(p.id, 'editor')}
                          className={`px-1.5 py-0.5 rounded text-xs ${p.orgShared === 'editor' ? 'bg-cyan-900/50 text-cyan-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                        >
                          {t('projects.orgEditor', lang)}
                        </button>
                        {p.orgShared && (
                          <button
                            onClick={() => handleOrgShare(p.id, 'revoke')}
                            className="text-red-400 hover:text-red-300 text-xs ml-auto"
                          >
                            {'\u2715'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Share / Unshare group controls (admin only) */}
                    {p.role === 'admin' && (
                      <>
                        {/* List currently shared groups */}
                        {p.sharedGroups?.length > 0 && (
                          <div className="space-y-1">
                            {p.sharedGroups.map((sg) => (
                              <div key={sg.id} className="flex items-center gap-1.5 text-xs">
                                <span className="text-slate-400 flex-1 truncate">{sg.name}</span>
                                {p.sharedGroups.length > 1 && (
                                  <button
                                    onClick={() => handleUnshareGroup(p.id, sg.id)}
                                    className="text-red-400 hover:text-red-300 text-xs shrink-0"
                                    title={lang === 'no' ? 'Fjern deling' : 'Remove sharing'}
                                  >
                                    {'\u2715'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Make private (unshare all) */}
                        {p.sharedGroups?.length > 0 && (
                          <button
                            onClick={() => handleUnshare(p.id)}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            {t('groups.unshare', lang)}
                          </button>
                        )}
                        {/* Share with another group */}
                        {sharingId === p.id ? (
                          <div className="flex gap-1.5 items-center">
                            <select
                              value={selectedGroupId}
                              onChange={(e) => setSelectedGroupId(e.target.value)}
                              className="flex-1 bg-slate-800 border border-slate-600 rounded text-xs px-1.5 py-1"
                            >
                              <option value="">-- {t('groups.selectGroup', lang)} --</option>
                              {groups
                                .filter(g => !p.sharedGroups?.some(sg => sg.id === g.id))
                                .map(g => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                            <button
                              onClick={() => handleShare(p.id)}
                              disabled={!selectedGroupId}
                              className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors disabled:opacity-50"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => { setSharingId(null); setSelectedGroupId(''); }}
                              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                            >
                              {t('general.cancel', lang)}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setSharingId(p.id)}
                            className="text-emerald-400 hover:text-emerald-300 text-xs"
                          >
                            + {t('groups.share', lang)}
                          </button>
                        )}
                      </>
                    )}

                    {/* Active share links (admin/editor) */}
                    {(p.role === 'admin' || p.role === 'editor') && (
                      <div className="mt-1">
                        {shareTokensProject === p.id ? (
                          <div className="space-y-1">
                            {shareTokens.length === 0 ? (
                              <p className="text-xs text-slate-600">{lang === 'no' ? 'Ingen aktive delingslenker' : 'No active share links'}</p>
                            ) : (
                              shareTokens.map((tk) => {
                                const tkLayerIds = tk.layer_ids || (tk.layer_id ? [tk.layer_id] : null);
                                const layerLabel = tkLayerIds
                                  ? (() => {
                                      const names = tkLayerIds.map(lid => projData?.layers?.find(l => l.id === lid)?.name).filter(Boolean);
                                      if (names.length <= 2) return names.join(', ');
                                      return `${names.length} ${lang === 'no' ? 'lag' : 'layers'}`;
                                    })()
                                  : (lang === 'no' ? 'Hele prosjektet' : 'Entire project');
                                const expiry = tk.expires_at ? new Date(tk.expires_at).toLocaleDateString() : (lang === 'no' ? 'Aldri' : 'Never');
                                const shareUrl = `${window.location.origin}/?share=${tk.token}`;
                                return (
                                  <div key={tk.id} className="flex items-center gap-1.5 text-xs group/link" title={shareUrl}>
                                    <button
                                      onClick={() => { navigator.clipboard.writeText(shareUrl); }}
                                      className="shrink-0 text-cyan-500 hover:text-cyan-300 transition-colors"
                                      title={lang === 'no' ? 'Kopier lenke' : 'Copy link'}
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                                        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                                      </svg>
                                    </button>
                                    <span className="text-slate-400 truncate flex-1">
                                      <span className="text-amber-400/70" title={lang === 'no' ? 'Alle med lenken har tilgang' : 'Anyone with the link has access'}>{lang === 'no' ? 'Åpen' : 'Public'}</span>
                                      <span className="text-slate-600"> · </span><span className="text-cyan-400">{layerLabel}</span>
                                      <span className="text-slate-600"> · {expiry}</span>
                                    </span>
                                    <button
                                      onClick={() => revokeShareToken(tk.id)}
                                      className="text-red-400 hover:text-red-300 text-xs shrink-0"
                                      title={lang === 'no' ? 'Tilbakekall' : 'Revoke'}
                                    >
                                      {'\u2715'}
                                    </button>
                                  </div>
                                );
                              })
                            )}
                            <button
                              onClick={() => setShareTokensProject(null)}
                              className="text-slate-500 hover:text-slate-400 text-xs"
                            >
                              {lang === 'no' ? 'Skjul' : 'Hide'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => fetchShareTokens(p.id)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                            </svg>
                            {lang === 'no' ? 'Delingslenker' : 'Share links'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Stats when not expanded */}
              {!expanded && visible && projData && (
                <div className="px-10 pb-1.5 text-xs text-slate-500">
                  {projData.markers.length}m &middot; {projData.drawings.length}d{(projData.viewsheds?.length || 0) > 0 ? ` \u00B7 ${projData.viewsheds.length}v` : ''}{(projData.rfCoverages?.length || 0) > 0 ? ` \u00B7 ${projData.rfCoverages.length}r` : ''} &middot; {projData.layers.length}L
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* Active context status bar */}
      {activeProjectId && (() => {
        const proj = myProjects.find(p => p.id === activeProjectId);
        const projData = projects[activeProjectId];
        const activeLayer = projData?.layers.find(l => l.id === activeLayerId);
        return (
          <div className="px-3 py-2.5 border-t border-slate-700 shrink-0 bg-slate-800/80">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-slate-400">{t('drawer.activeContext', lang)}:</span>
              <span className="text-emerald-300 font-medium truncate">{proj?.name || '?'}</span>
              <span className="text-slate-600">&rsaquo;</span>
              <span className={`truncate ${activeLayer ? 'text-cyan-300' : 'text-slate-500 italic'}`}>
                {activeLayer ? activeLayer.name : t('drawer.noLayer', lang)}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Audit Log Dialog */}
      {auditProject && (
        <AuditLogDialog
          projectId={auditProject.id}
          projectName={auditProject.name}
          lang={lang}
          onClose={() => setAuditProject(null)}
          onNavigate={(entityId, lat, lon, entityType) => {
            // Fly to the object location
            if (mapRef && lat != null && lon != null) {
              mapRef.flyTo({ center: [lon, lat], zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
            }
            // Expand the project and highlight the item in the drawer list
            if (auditProject) {
              const pid = auditProject.id;
              if (!visibleProjectIds.includes(pid)) showProject(pid, myProjects.map(pr => pr.id));
              setExpandedProject(pid);
              setActiveProject(pid);
              // Find which layer this item belongs to and expand it
              const projData = projects[pid];
              if (projData && entityId) {
                const allItems = [...(projData.markers || []), ...(projData.drawings || []), ...(projData.pins || []),
                                  ...(projData.viewsheds || []), ...(projData.rfCoverages || [])];
                const item = allItems.find(i => i.id === entityId);
                if (item?.layerId) {
                  setActiveLayer(item.layerId);
                  setExpandedLayerId(item.layerId);
                } else {
                  setExpandedUnassigned(pid);
                }
              }
            }
            // Highlight the item in the project list
            if (entityId) triggerFocus(entityId);
          }}
        />
      )}

      {/* QR Code Overlay for projects */}
      {qrProject && (
        <QRCodeOverlay
          resourceType="project"
          resourceId={qrProject.id}
          resourceName={qrProject.name}
          layerIds={qrLayerIds}
          layerNames={qrLayerIds ? qrLayerIds.map(lid => projects[qrProject.id]?.layers?.find(l => l.id === lid)?.name).filter(Boolean) : null}
          onClose={() => { setQrProject(null); setQrLayerIds(null); }}
        />
      )}

      {/* Layer Table View */}
      {tableViewLayer && (() => {
        const tvProjData = projects[tableViewLayer.projectId];
        if (!tvProjData) return null;
        const filterByLayer = (items) => tableViewLayer.layerId
          ? items.filter(i => i.layerId === tableViewLayer.layerId)
          : items.filter(i => !i.layerId);
        return (
          <LayerTableView
            markers={filterByLayer(tvProjData.markers)}
            drawings={filterByLayer(tvProjData.drawings)}
            viewsheds={filterByLayer(tvProjData.viewsheds || [])}
            rfCoverages={filterByLayer(tvProjData.rfCoverages || [])}
            lang={lang}
            mapRef={mapRef}
            layerName={tableViewLayer.layerName}
            onClose={() => setTableViewLayer(null)}
            onSelectMarker={setSelectedMarkerId}
            onSelectDrawing={setSelectedDrawingId}
          />
        );
      })()}
    </div>
  );
}
