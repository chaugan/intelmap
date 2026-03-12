import { useCallback, useRef, useState, useEffect } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useTacticalStore, getAllVisibleMarkers } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { generateSymbolSvg, getAffiliation, getEchelonCode, setEchelonCode } from '../../lib/milsymbol-utils.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { ECHELONS } from '../../lib/constants.js';
import { socket } from '../../lib/socket.js';
import { resolveMgrs } from '../../lib/mgrs-utils.js';
import { t } from '../../lib/i18n.js';
import ItemInfoPopup from './ItemInfoPopup.jsx';

export default function NatoMarkerLayer({ localMarkers = [], setLocalMarkers, declutterOffsets, declutterActive }) {
  const state = useTacticalStore();
  const labelVisibility = useTacticalStore((s) => s.labelVisibility);
  const lang = useMapStore((s) => s.lang);
  const mapRef = useMapStore((s) => s.mapRef);
  const dragRef = useRef(null);
  const dragEndTimeRef = useRef(0);
  const clickTimerRef = useRef(null);
  const [infoPopup, setInfoPopup] = useState(null);
  const selectedId = useMapStore((s) => s.selectedMarkerId);
  const setSelectedId = useMapStore((s) => s.setSelectedMarkerId);
  const [echelonMenu, setEchelonMenu] = useState(null);
  const [moveGrid, setMoveGrid] = useState('');
  const [createdBy, setCreatedBy] = useState(null); // { username, created_at } or 'loading' or null

  const visibleMarkers = getAllVisibleMarkers(state);

  // Deselect on Escape
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setSelectedId(null); setEchelonMenu(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const m = visibleMarkers.find(mk => mk.id === selectedId) || localMarkers.find(mk => mk.id === selectedId);
        if (m) {
          if (m._local) {
            if (setLocalMarkers) setLocalMarkers(prev => prev.filter(mk => mk.id !== m.id));
          } else {
            socket.emit('client:marker:delete', { projectId: m._projectId || m.projectId, id: m.id });
          }
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, visibleMarkers, localMarkers, setLocalMarkers]);

  // Deselect when clicking on map (not on a marker)
  useEffect(() => {
    const map = useMapStore.getState().mapRef;
    if (!map || !selectedId) return;
    const handler = () => { setSelectedId(null); setEchelonMenu(null); };
    map.on('click', handler);
    return () => map.off('click', handler);
  }, [selectedId]);

  // Close echelon menu on outside click
  useEffect(() => {
    if (!echelonMenu) return;
    const handler = (e) => {
      if (!e.target.closest('.echelon-menu')) setEchelonMenu(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [echelonMenu]);

  const onDragStart = useCallback((markerId) => {
    dragRef.current = markerId;
  }, []);

  const onDragEnd = useCallback((evt, marker) => {
    const { lng, lat } = evt.lngLat;
    const projectId = marker._projectId || marker.projectId;
    useTacticalStore.getState().updateMarker(projectId, { ...marker, lat, lon: lng });
    socket.emit('client:marker:update', { projectId, id: marker.id, lat, lon: lng });
    dragEndTimeRef.current = Date.now();
    setTimeout(() => { dragRef.current = null; }, 300);
  }, []);

  const onDelete = useCallback((marker) => {
    const projectId = marker._projectId || marker.projectId;
    socket.emit('client:marker:delete', { projectId, id: marker.id });
    setSelectedId(null);
  }, []);

  const onRenameLabel = useCallback((marker) => {
    const current = marker.customLabel || '';
    const label = prompt(
      lang === 'no' ? 'Skriv inn etikett for symbol:' : 'Enter label for symbol:',
      current
    );
    if (label !== null) {
      const projectId = marker._projectId || marker.projectId;
      socket.emit('client:marker:update', { projectId, id: marker.id, customLabel: label });
    }
  }, [lang]);

  const onChangeEchelon = useCallback((marker, echelonCode) => {
    const newSidc = setEchelonCode(marker.sidc, echelonCode);
    if (newSidc === marker.sidc) return;
    const projectId = marker._projectId || marker.projectId;
    if (marker._local) {
      if (setLocalMarkers) {
        setLocalMarkers((prev) => prev.map((m) => m.id === marker.id ? { ...m, sidc: newSidc } : m));
      }
    } else {
      useTacticalStore.getState().updateMarker(projectId, { ...marker, sidc: newSidc });
      socket.emit('client:marker:update', { projectId, id: marker.id, sidc: newSidc });
    }
    setEchelonMenu(null);
  }, [setLocalMarkers]);

  // Local marker handlers
  const onLocalDragEnd = useCallback((evt, marker) => {
    if (!setLocalMarkers) return;
    const { lng, lat } = evt.lngLat;
    setLocalMarkers((prev) => prev.map((m) => m.id === marker.id ? { ...m, lat, lon: lng } : m));
    dragEndTimeRef.current = Date.now();
    setTimeout(() => { dragRef.current = null; }, 300);
  }, [setLocalMarkers]);

  const onLocalDelete = useCallback((marker) => {
    if (!setLocalMarkers) return;
    setLocalMarkers((prev) => prev.filter((m) => m.id !== marker.id));
    setSelectedId(null);
  }, [setLocalMarkers]);

  const onLocalRenameLabel = useCallback((marker) => {
    if (!setLocalMarkers) return;
    const current = marker.customLabel || '';
    const label = prompt(
      lang === 'no' ? 'Skriv inn etikett for symbol:' : 'Enter label for symbol:',
      current
    );
    if (label !== null) {
      setLocalMarkers((prev) => prev.map((m) => m.id === marker.id ? { ...m, customLabel: label } : m));
    }
  }, [lang, setLocalMarkers]);

  const onContextMenu = useCallback((e, marker) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveGrid('');
    setCreatedBy('loading');
    setEchelonMenu({
      marker,
      x: e.clientX,
      y: e.clientY,
    });
    // Fetch "added by" from audit log
    const projectId = marker._projectId || marker.projectId;
    if (projectId && marker.id) {
      fetch(`/api/projects/${projectId}/audit-log?entity_id=${marker.id}&action=add&limit=1`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.entries?.length > 0) {
            const entry = data.entries[0];
            setCreatedBy({ username: entry.username, created_at: entry.created_at });
          } else {
            setCreatedBy(null);
          }
        })
        .catch(() => setCreatedBy(null));
    } else {
      setCreatedBy(null);
    }
  }, []);

  const affiliationLabels = {
    friendly: { en: 'Friendly', no: 'Vennlig' },
    hostile: { en: 'Hostile', no: 'Fiendtlig' },
    neutral: { en: 'Neutral', no: 'Nøytral' },
    unknown: { en: 'Unknown', no: 'Ukjent' },
  };

  const currentEchelon = echelonMenu ? getEchelonCode(echelonMenu.marker.sidc) : null;

  // Move to grid validation
  const moveInput = moveGrid.trim();
  const moveCandidates = moveInput ? resolveMgrs(moveInput, mapRef?.getCenter() || { lng: 15, lat: 65 }) : [];
  const moveValid = moveCandidates.length > 0;

  const handleMoveToGrid = (flyTo) => {
    if (!moveValid || !echelonMenu) return;
    const { lon, lat } = moveCandidates[0];
    const marker = echelonMenu.marker;
    if (marker._local) {
      if (setLocalMarkers) {
        setLocalMarkers(prev => prev.map(m => m.id === marker.id ? { ...m, lat, lon } : m));
      }
    } else {
      const projectId = marker._projectId || marker.projectId;
      useTacticalStore.getState().updateMarker(projectId, { ...marker, lat, lon });
      socket.emit('client:marker:update', { projectId, id: marker.id, lat, lon });
    }
    if (flyTo && mapRef) {
      mapRef.flyTo({ center: [lon, lat], zoom: mapRef.getZoom(), duration: 2000 });
    }
    setEchelonMenu(null);
    setMoveGrid('');
  };

  return (
    <>
      {visibleMarkers.map((marker) => {
        const sym = generateSymbolSvg(marker.sidc, {
          designation: marker.designation,
          higherFormation: marker.higherFormation,
          additionalInfo: marker.additionalInfo,
        });

        const affiliation = getAffiliation(marker.sidc);
        const symName = getSymbolName(marker.sidc, lang);
        const affLabel = affiliationLabels[affiliation]?.[lang] || affiliationLabels[affiliation]?.en || affiliation;
        const tooltip = marker.designation
          ? `${marker.designation} — ${symName} (${affLabel})`
          : `${symName} (${affLabel})`;
        const isSelected = selectedId === marker.id;

        const declutterOff = declutterOffsets?.get(`marker:${marker.id}`);

        return (
          <Marker
            key={marker.id}
            longitude={marker.lon}
            latitude={marker.lat}
            anchor="center"
            draggable={isSelected && !declutterActive}
            onDragStart={() => onDragStart(marker.id)}
            onDragEnd={(e) => onDragEnd(e, marker)}
            offset={declutterOff ? [declutterOff.dx, declutterOff.dy] : undefined}
          >
            <div
              className={`nato-marker relative cursor-pointer flex flex-col items-center ${isSelected ? 'z-10' : ''}`}
              title={tooltip}
              onClick={(e) => {
                e.stopPropagation();
                if (dragRef.current) return;
                if (Date.now() - dragEndTimeRef.current < 400) return;
                // Delay single-click so double-click can cancel it
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = setTimeout(() => {
                  setSelectedId(isSelected ? null : marker.id);
                }, 250);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                clearTimeout(clickTimerRef.current);
                if (Date.now() - dragEndTimeRef.current < 400) return;
                setSelectedId(marker.id);
                onRenameLabel(marker);
              }}
              onContextMenu={(e) => onContextMenu(e, marker)}
            >
              {/* Selection highlight ring */}
              {isSelected && (
                <div className="absolute inset-0 -m-2 rounded-lg border-2 border-cyan-400 bg-cyan-400/10 pointer-events-none symbol-selected" />
              )}
              <div dangerouslySetInnerHTML={{ __html: sym.svg }} />
              {marker.customLabel && (labelVisibility[marker.layerId] !== false) && (
                <div className="text-[10px] text-center font-semibold text-white bg-slate-900/80 rounded px-1 -mt-1 whitespace-nowrap">
                  {marker.customLabel}
                </div>
              )}
              {/* Delete button — visible when selected */}
              {isSelected && (
                <button
                  onClick={(e) => { e.stopPropagation(); clearTimeout(clickTimerRef.current); onDelete(marker); }}
                  className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500 shadow-lg border border-red-400/50"
                  title={lang === 'no' ? 'Slett' : 'Delete'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </Marker>
        );
      })}
      {/* Local markers (non-logged-in users) */}
      {localMarkers.map((marker) => {
        const sym = generateSymbolSvg(marker.sidc, {
          designation: marker.designation,
          higherFormation: marker.higherFormation,
          additionalInfo: marker.additionalInfo,
        });

        const affiliation = getAffiliation(marker.sidc);
        const symName = getSymbolName(marker.sidc, lang);
        const affLabel = affiliationLabels[affiliation]?.[lang] || affiliationLabels[affiliation]?.en || affiliation;
        const tooltip = marker.designation
          ? `${marker.designation} — ${symName} (${affLabel})`
          : `${symName} (${affLabel})`;
        const isSelected = selectedId === marker.id;
        const localDeclutterOff = declutterOffsets?.get(`marker:${marker.id}`);

        return (
          <Marker
            key={marker.id}
            longitude={marker.lon}
            latitude={marker.lat}
            anchor="center"
            draggable={isSelected && !declutterActive}
            onDragStart={() => onDragStart(marker.id)}
            onDragEnd={(e) => onLocalDragEnd(e, marker)}
            offset={localDeclutterOff ? [localDeclutterOff.dx, localDeclutterOff.dy] : undefined}
          >
            <div
              className={`nato-marker relative cursor-pointer flex flex-col items-center ${isSelected ? 'z-10' : ''}`}
              title={tooltip}
              onClick={(e) => {
                e.stopPropagation();
                if (dragRef.current) return;
                if (Date.now() - dragEndTimeRef.current < 400) return;
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = setTimeout(() => {
                  setSelectedId(isSelected ? null : marker.id);
                }, 250);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                clearTimeout(clickTimerRef.current);
                if (Date.now() - dragEndTimeRef.current < 400) return;
                setSelectedId(marker.id);
                onLocalRenameLabel(marker);
              }}
              onContextMenu={(e) => onContextMenu(e, marker)}
            >
              {/* Selection highlight ring */}
              {isSelected && (
                <div className="absolute inset-0 -m-2 rounded-lg border-2 border-cyan-400 bg-cyan-400/10 pointer-events-none symbol-selected" />
              )}
              <div dangerouslySetInnerHTML={{ __html: sym.svg }} />
              {/* Local indicator badge */}
              <div className="absolute -top-1 -left-1 w-3 h-3 bg-amber-500 rounded-full border border-white" title={lang === 'no' ? 'Ikke lagret' : 'Not saved'} />
              {marker.customLabel && (
                <div className="text-[10px] text-center font-semibold text-white bg-slate-900/80 rounded px-1 -mt-1 whitespace-nowrap">
                  {marker.customLabel}
                </div>
              )}
              {/* Delete button — visible when selected */}
              {isSelected && (
                <button
                  onClick={(e) => { e.stopPropagation(); clearTimeout(clickTimerRef.current); onLocalDelete(marker); }}
                  className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500 shadow-lg border border-red-400/50"
                  title={lang === 'no' ? 'Slett' : 'Delete'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </Marker>
        );
      })}
      {/* Echelon context menu */}
      {echelonMenu && (
        <div
          className="echelon-menu fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-2"
          style={{ left: echelonMenu.x, top: echelonMenu.y }}
        >
          <div className="text-[10px] text-slate-400 px-1 mb-1.5 font-semibold uppercase tracking-wide">
            {lang === 'no' ? 'Enhetsstørrelse' : 'Echelon'}
          </div>
          <div className="flex gap-1 flex-wrap max-w-[240px]">
            {ECHELONS.map((ech) => (
              <button
                key={ech.code}
                onClick={() => onChangeEchelon(echelonMenu.marker, ech.code)}
                className={`px-2 py-1 text-xs rounded transition-colors font-mono ${
                  currentEchelon === ech.code
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                title={ech.name[lang] || ech.name.en}
              >
                {ech.symbol}
              </button>
            ))}
          </div>
          {/* Added by info */}
          {createdBy && createdBy !== 'loading' && (
            <div className="border-t border-slate-700 mt-2 pt-1.5 px-1">
              <div className="text-[10px] text-slate-400">
                {lang === 'no' ? 'Lagt til av' : 'Added by'}{' '}
                <span className="text-slate-200 font-medium">{createdBy.username}</span>
              </div>
              <div className="text-[9px] text-slate-500">
                {new Date(createdBy.created_at + 'Z').toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          )}
          {createdBy === 'loading' && (
            <div className="border-t border-slate-700 mt-2 pt-1.5 px-1">
              <div className="text-[9px] text-slate-500 italic">{lang === 'no' ? 'Laster...' : 'Loading...'}</div>
            </div>
          )}
          <div className="flex gap-1 mt-2 border-t border-slate-700 pt-2">
            <button
              onClick={() => {
                setInfoPopup({
                  projectId: echelonMenu.marker._projectId || echelonMenu.marker.projectId,
                  layerId: echelonMenu.marker.layerId,
                  x: echelonMenu.x,
                  y: echelonMenu.y,
                });
                setEchelonMenu(null);
              }}
              className="text-[10px] text-slate-400 hover:text-slate-200 px-1"
            >
              {lang === 'no' ? 'Laginfo...' : 'Layer info...'}
            </button>
          </div>
          {/* Move to grid */}
          <div className="border-t border-slate-700 pt-2 mt-1">
            <div className="text-[10px] text-slate-400 px-1 mb-1 font-semibold uppercase tracking-wide">
              {t('symbol.moveToGrid', lang)}
            </div>
            <input
              type="text"
              value={moveGrid}
              onChange={(e) => setMoveGrid(e.target.value)}
              placeholder="e.g. 32VNM 78787 76938"
              className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && moveValid) handleMoveToGrid(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {moveInput && !moveValid && (
              <div className="text-[9px] text-red-400 px-1 mt-0.5">{t('symbol.invalidGrid', lang)}</div>
            )}
            <div className="flex gap-1 mt-1.5">
              <button
                onClick={() => handleMoveToGrid(false)}
                disabled={!moveValid}
                className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  moveValid
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {t('symbol.move', lang)}
              </button>
              <button
                onClick={() => handleMoveToGrid(true)}
                disabled={!moveValid}
                className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  moveValid
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {t('symbol.moveAndGo', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
      {infoPopup && (
        <ItemInfoPopup
          projectId={infoPopup.projectId}
          layerId={infoPopup.layerId}
          x={infoPopup.x}
          y={infoPopup.y}
          onClose={() => setInfoPopup(null)}
        />
      )}
    </>
  );
}
