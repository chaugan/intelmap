import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';
import { DRAW_COLORS } from '../../lib/constants.js';

const SOURCE_RESULT = 'firing-range-result';
const SOURCE_GUN = 'firing-range-gun-src';
const LAYER_REACHABLE = 'firing-range-reachable';
const LAYER_DEAD = 'firing-range-dead';
const LAYER_MASKED = 'firing-range-masked';
const LAYER_RINGS = 'firing-range-rings';
const LAYER_RINGS_LABEL = 'firing-range-rings-label';
const LAYER_GUN = 'firing-range-gun';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const WEAPON_PRESETS = [
  // NATO tube artillery
  { id: 'm109',      name: 'M109A3 155mm',          maxRangeKm: 18,   minElMils: 53,   maxElMils: 1200, muzzleVelocity: 563 },
  { id: 'm109a6',    name: 'M109A6 Paladin 155mm',  maxRangeKm: 30,   minElMils: 53,   maxElMils: 1333, muzzleVelocity: 684 },
  { id: 'm777',      name: 'M777 155mm',            maxRangeKm: 24.7, minElMils: 36,   maxElMils: 1280, muzzleVelocity: 684 },
  { id: 'k9',        name: 'K9 Thunder 155mm',      maxRangeKm: 40,   minElMils: 53,   maxElMils: 1200, muzzleVelocity: 900 },
  { id: 'pzh2000',   name: 'PzH 2000 155mm',        maxRangeKm: 30,   minElMils: 44,   maxElMils: 1200, muzzleVelocity: 827 },
  // Russian tube artillery
  { id: '2s19',      name: '2S19 Msta 152mm',       maxRangeKm: 24.7, minElMils: 0,    maxElMils: 1067, muzzleVelocity: 810 },
  { id: '2s3',       name: '2S3 Akatsiya 152mm',    maxRangeKm: 18.5, minElMils: 0,    maxElMils: 1067, muzzleVelocity: 655 },
  { id: 'd30',       name: 'D-30 122mm',            maxRangeKm: 15.3, minElMils: -120,  maxElMils: 1244, muzzleVelocity: 690 },
  { id: '2s1',       name: '2S1 Gvozdika 122mm',    maxRangeKm: 15.3, minElMils: -53,   maxElMils: 1244, muzzleVelocity: 690 },
  // NATO rocket artillery (thrust + ballistic model)
  { id: 'mlrs',      name: 'M270 MLRS 227mm',       maxRangeKm: 32,   minElMils: 0,    maxElMils: 1067, isRocket: true, burnTime: 1.5, launchVelocity: 40,  burnoutVelocity: 570 },
  { id: 'himars',    name: 'M142 HIMARS 227mm',     maxRangeKm: 32,   minElMils: 0,    maxElMils: 1067, isRocket: true, burnTime: 1.5, launchVelocity: 40,  burnoutVelocity: 570 },
  { id: 'gmlrs',     name: 'GMLRS (guided) 227mm',  maxRangeKm: 50,   minElMils: 0,    maxElMils: 1067, isRocket: true, burnTime: 3.0, launchVelocity: 40,  burnoutVelocity: 750 },
  // Russian rocket artillery (thrust + ballistic model)
  { id: 'bm21',      name: 'BM-21 Grad 122mm',      maxRangeKm: 20,   minElMils: 0,    maxElMils: 978,  isRocket: true, burnTime: 1.1, launchVelocity: 30,  burnoutVelocity: 460 },
  { id: 'bm27',      name: 'BM-27 Uragan 220mm',    maxRangeKm: 35,   minElMils: 0,    maxElMils: 978,  isRocket: true, burnTime: 1.5, launchVelocity: 30,  burnoutVelocity: 600 },
  { id: 'bm30',      name: 'BM-30 Smerch 300mm',    maxRangeKm: 50,   minElMils: 0,    maxElMils: 978,  isRocket: true, burnTime: 2.5, launchVelocity: 30,  burnoutVelocity: 750 },
  // Mortars
  { id: 'mortar120', name: '120mm Mortar',           maxRangeKm: 7.2,  minElMils: 800,  maxElMils: 1511, muzzleVelocity: 325 },
  { id: 'mortar81',  name: '81mm Mortar',            maxRangeKm: 5.6,  minElMils: 800,  maxElMils: 1511, muzzleVelocity: 250 },
  // Custom
  { id: 'custom',    name: 'Custom',                 maxRangeKm: 20,   minElMils: 53,   maxElMils: 1200, muzzleVelocity: 563 },
];

const ALL_LAYERS = [LAYER_REACHABLE, LAYER_DEAD, LAYER_MASKED, LAYER_RINGS, LAYER_RINGS_LABEL, LAYER_GUN];
const ALL_SOURCES = [SOURCE_RESULT, SOURCE_GUN];

export default function FiringRangeTool() {
  const visible = useMapStore((s) => s.firingRangeToolVisible);
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);
  const myProjects = useProjectStore((s) => s.myProjects);

  const activeProject = myProjects.find(p => p.id === activeProjectId);
  const canEditActive = activeProject?.role === 'admin' || activeProject?.role === 'editor';
  const editableProjectIds = new Set(myProjects.filter(p => p.role === 'admin' || p.role === 'editor').map(p => p.id));

  const [mode, setMode] = useState('idle');
  const [gun, setGun] = useState(null);
  const [weaponPreset, setWeaponPreset] = useState('m109');
  const [maxRangeKm, setMaxRangeKm] = useState(18);
  const [minElMils, setMinElMils] = useState(53);
  const [maxElMils, setMaxElMils] = useState(1200);
  const [muzzleVelocity, setMuzzleVelocity] = useState(563);
  const [isRocket, setIsRocket] = useState(false);
  const [burnTime, setBurnTime] = useState(1.5);
  const [launchVelocity, setLaunchVelocity] = useState(30);
  const [burnoutVelocity, setBurnoutVelocity] = useState(500);
  const [gunAltitude, setGunAltitude] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elevUnit, setElevUnit] = useState('mil'); // 'mil' | 'deg'
  const [activeColor, setActiveColor] = useState('#22c55e');
  const [activeLabel, setActiveLabel] = useState('');
  const [panelPos, setPanelPos] = useState({ x: null, y: null });

  const dragRef = useRef(null);
  const dragStartRef = useRef(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const resultRef = useRef(null);
  const gunRef = useRef(null);

  // Keep refs in sync for styledata restore
  resultRef.current = result;
  gunRef.current = gun;

  const isNo = lang === 'no';
  const isCustom = weaponPreset === 'custom';

  // Saved items list
  const savedItems = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.firingRanges) continue;
    for (const f of proj.firingRanges) savedItems.push({ ...f, _projectId: pid });
  }

  const milToDeg = (m) => Math.round(m * 180 / 3200 * 100) / 100;
  const degToMil = (d) => Math.round(d * 3200 / 180);

  const selectPreset = (id) => {
    setWeaponPreset(id);
    const preset = WEAPON_PRESETS.find(p => p.id === id);
    if (preset) {
      setMaxRangeKm(preset.maxRangeKm);
      setMinElMils(elevUnit === 'deg' ? milToDeg(preset.minElMils) : preset.minElMils);
      setMaxElMils(elevUnit === 'deg' ? milToDeg(preset.maxElMils) : preset.maxElMils);
      if (preset.isRocket) {
        setIsRocket(true);
        setBurnTime(preset.burnTime);
        setLaunchVelocity(preset.launchVelocity);
        setBurnoutVelocity(preset.burnoutVelocity);
        setMuzzleVelocity(0);
      } else {
        setIsRocket(false);
        setMuzzleVelocity(preset.muzzleVelocity);
      }
    }
  };

  const onDragStart = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = dragRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStartRef.current = { offsetX: clientX - rect.left, offsetY: clientY - rect.top };
    const onMove = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const { offsetX, offsetY } = dragStartRef.current;
      setPanelPos({ x: Math.max(0, Math.min(window.innerWidth - 288, cx - offsetX)), y: Math.max(0, Math.min(window.innerHeight - 100, cy - offsetY)) });
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, []);

  const cleanup = useCallback(() => {
    if (!mapRef) return;
    for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
  }, [mapRef]);

  const reset = useCallback(() => {
    setMode('idle');
    setGun(null);
    setGunAltitude(null);
    setResult(null);
    setError(null);
    setActiveColor('#22c55e');
    setActiveLabel('');
    if (mapRef) {
      mapRef.getCanvas().style.cursor = '';
      for (const id of ALL_SOURCES) {
        const s = mapRef.getSource(id);
        if (s) s.setData(EMPTY_FC);
      }
    }
  }, [mapRef]);

  // Init layers
  useEffect(() => {
    if (!visible || !mapRef) return;
    const initLayers = () => {
      const resultData = resultRef.current?.geojson || EMPTY_FC;
      const gunData = gunRef.current
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: [gunRef.current.lng, gunRef.current.lat] } }
        : EMPTY_FC;
      if (!mapRef.getSource(SOURCE_RESULT)) mapRef.addSource(SOURCE_RESULT, { type: 'geojson', data: resultData });
      else mapRef.getSource(SOURCE_RESULT).setData(resultData);
      if (!mapRef.getSource(SOURCE_GUN)) mapRef.addSource(SOURCE_GUN, { type: 'geojson', data: gunData });
      else mapRef.getSource(SOURCE_GUN).setData(gunData);

      if (!mapRef.getLayer(LAYER_REACHABLE)) mapRef.addLayer({ id: LAYER_REACHABLE, type: 'fill', source: SOURCE_RESULT, filter: ['==', ['get', 'zone'], 'reachable'], paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.25 } });
      if (!mapRef.getLayer(LAYER_DEAD)) mapRef.addLayer({ id: LAYER_DEAD, type: 'fill', source: SOURCE_RESULT, filter: ['==', ['get', 'zone'], 'dead'], paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.3 } });
      if (!mapRef.getLayer(LAYER_MASKED)) mapRef.addLayer({ id: LAYER_MASKED, type: 'fill', source: SOURCE_RESULT, filter: ['==', ['get', 'zone'], 'masked'], paint: { 'fill-color': '#6b7280', 'fill-opacity': 0.15 } });
      if (!mapRef.getLayer(LAYER_RINGS)) mapRef.addLayer({ id: LAYER_RINGS, type: 'line', source: SOURCE_RESULT, filter: ['==', ['get', 'type'], 'range-ring'], paint: { 'line-color': '#94a3b8', 'line-width': 1, 'line-dasharray': [4, 4] } });
      if (!mapRef.getLayer(LAYER_RINGS_LABEL)) mapRef.addLayer({ id: LAYER_RINGS_LABEL, type: 'symbol', source: SOURCE_RESULT, filter: ['==', ['get', 'type'], 'range-ring'], layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'distanceKm']], ' km'], 'text-size': 10, 'text-offset': [0, -0.8] }, paint: { 'text-color': '#94a3b8', 'text-halo-color': '#1e293b', 'text-halo-width': 1 } });
      if (!mapRef.getLayer(LAYER_GUN)) mapRef.addLayer({ id: LAYER_GUN, type: 'circle', source: SOURCE_GUN, paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#22c55e', 'circle-stroke-width': 3 } });
    };
    initLayers();
    mapRef.on('styledata', initLayers);
    return () => { mapRef.off('styledata', initLayers); cleanup(); };
  }, [visible, mapRef, cleanup]);

  // Update reachable color on map
  useEffect(() => {
    if (!visible || !mapRef || mode !== 'result') return;
    if (mapRef.getLayer(LAYER_REACHABLE)) mapRef.setPaintProperty(LAYER_REACHABLE, 'fill-color', activeColor);
    if (mapRef.getLayer(LAYER_GUN)) mapRef.setPaintProperty(LAYER_GUN, 'circle-stroke-color', activeColor);
  }, [visible, mapRef, activeColor, mode]);

  // Map click handler
  useEffect(() => {
    if (!visible || !mapRef) return;
    const handleClick = (e) => {
      if (modeRef.current === 'placing') {
        const { lng, lat } = e.lngLat;
        setGun({ lng, lat });
        setMode('ready');
        mapRef.getCanvas().style.cursor = '';
        const gunSrc = mapRef.getSource(SOURCE_GUN);
        if (gunSrc) gunSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
        // Fetch ground elevation
        fetch('/api/firing-range/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ longitude: lng, latitude: lat, maxRangeKm: 0.1, minElevationMils: 53, maxElevationMils: 1200, muzzleVelocity: 100 }),
        }).then(r => r.ok ? r.json() : null).then(d => {
          if (d?.groundElevation != null) setGunAltitude(d.groundElevation);
        }).catch(() => {});
        e.preventDefault();
      } else if (modeRef.current === 'replacing') {
        const { lng, lat } = e.lngLat;
        setGun({ lng, lat });
        setMode('ready');
        mapRef.getCanvas().style.cursor = '';
        const gunSrc = mapRef.getSource(SOURCE_GUN);
        if (gunSrc) gunSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
        // Reset result on re-place
        setResult(null);
        setError(null);
        const resSrc = mapRef.getSource(SOURCE_RESULT);
        if (resSrc) resSrc.setData(EMPTY_FC);
        fetch('/api/firing-range/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ longitude: lng, latitude: lat, maxRangeKm: 0.1, minElevationMils: 53, maxElevationMils: 1200, muzzleVelocity: 100 }),
        }).then(r => r.ok ? r.json() : null).then(d => {
          if (d?.groundElevation != null) setGunAltitude(d.groundElevation);
        }).catch(() => {});
        e.preventDefault();
      }
    };
    mapRef.on('click', handleClick);
    return () => mapRef.off('click', handleClick);
  }, [visible, mapRef]);

  useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const startPlacing = () => {
    setMode('placing');
    setGun(null);
    setGunAltitude(null);
    setResult(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = 'crosshair';
      for (const id of ALL_SOURCES) {
        const s = mapRef.getSource(id);
        if (s) s.setData(EMPTY_FC);
      }
    }
  };

  const startReplacing = () => {
    setMode('replacing');
    setError(null);
    if (mapRef) mapRef.getCanvas().style.cursor = 'crosshair';
  };

  const calculate = async () => {
    if (!gun) return;
    setMode('calculating');
    setError(null);
    try {
      const payload = {
        longitude: gun.lng, latitude: gun.lat,
        maxRangeKm,
        minElevationMils: elevUnit === 'deg' ? degToMil(minElMils) : minElMils,
        maxElevationMils: elevUnit === 'deg' ? degToMil(maxElMils) : maxElMils,
        gunAltitudeOverride: gunAltitude,
      };
      if (isRocket) {
        payload.isRocket = true;
        payload.burnTime = burnTime;
        payload.launchVelocity = launchVelocity;
        payload.burnoutVelocity = burnoutVelocity;
      } else {
        payload.muzzleVelocity = muzzleVelocity;
      }
      const res = await fetch('/api/firing-range/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Calculation failed'); }
      const data = await res.json();
      setResult(data);
      setMode('result');
      if (gunAltitude == null && data.groundElevation != null) setGunAltitude(data.groundElevation);
      const resSrc = mapRef?.getSource(SOURCE_RESULT);
      if (resSrc && data.geojson) resSrc.setData(data.geojson);
    } catch (err) { setError(err.message); setMode('ready'); }
  };

  const saveToProject = () => {
    if (!activeProjectId || !gun || !result) return;
    socket.emit('client:firing-range:save', {
      projectId: activeProjectId,
      layerId: activeLayerId || null,
      longitude: gun.lng, latitude: gun.lat,
      gunAltitude: gunAltitude || 0,
      weaponPreset,
      maxRangeKm,
      minElevationMils: elevUnit === 'deg' ? degToMil(minElMils) : minElMils,
      maxElevationMils: elevUnit === 'deg' ? degToMil(maxElMils) : maxElMils,
      muzzleVelocity,
      geojson: result.geojson,
      stats: result.stats,
      color: activeColor,
      label: activeLabel || null,
    });
    reset();
  };

  const flyTo = useCallback((lng, lat) => {
    if (!mapRef) return;
    mapRef.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.getZoom(), 10), duration: 1200 });
  }, [mapRef]);

  const close = () => { useMapStore.getState().toggleFiringRangeTool(); };

  if (!visible) return null;

  const posStyle = panelPos.x != null
    ? { position: 'fixed', left: panelPos.x, top: panelPos.y, right: 'auto' }
    : { position: 'absolute', top: '4rem', right: '1rem' };

  return createPortal(
    <div ref={dragRef} className="z-[15] w-72 bg-slate-800/95 backdrop-blur rounded-lg shadow-xl border border-slate-600/50 text-white text-sm max-h-[calc(100vh-100px)] overflow-y-auto" style={posStyle}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-600/50 cursor-move select-none" onMouseDown={onDragStart} onTouchStart={onDragStart}>
        <div className="flex items-center gap-2 font-medium pointer-events-none">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          {t('firingRange.title', lang)}
        </div>
        <button onClick={close} className="text-slate-400 hover:text-white transition-colors pointer-events-auto">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Saved items list */}
        {savedItems.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-medium">{savedItems.length} {isNo ? 'lagret' : 'saved'}</div>
            <div className="space-y-px max-h-32 overflow-y-auto">
              {savedItems.map((f) => {
                const isVis = itemVisibility[f.id] !== false;
                const label = f.label ? `${f.label} (${f.maxRangeKm}km)` : `${f.weaponPreset || 'custom'} ${f.maxRangeKm}km`;
                const dotColor = f.color || '#22c55e';
                return (
                  <div key={f.id} className={`flex items-center gap-1.5 text-[11px] rounded px-1 py-0.5 hover:bg-slate-700/50 ${isVis ? '' : 'opacity-40'}`}>
                    <button onClick={() => useTacticalStore.getState().toggleItemVisibility(f.id)} className="shrink-0" title={isVis ? (isNo ? 'Skjul' : 'Hide') : (isNo ? 'Vis' : 'Show')}>
                      <span className="block w-3 h-3 rounded-full border" style={{ backgroundColor: isVis ? dotColor : 'transparent', borderColor: dotColor }} />
                    </button>
                    <span className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white" onClick={() => flyTo(f.longitude, f.latitude)}>
                      {label}
                    </span>
                    <button onClick={() => flyTo(f.longitude, f.latitude)} className="shrink-0 text-slate-600 hover:text-cyan-400" title={isNo ? 'Fly til' : 'Fly to'}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                    </button>
                    {editableProjectIds.has(f._projectId) && (
                      <button onClick={() => socket.emit('client:firing-range:delete', { projectId: f._projectId, id: f.id })} className="shrink-0 text-slate-600 hover:text-red-400" title={isNo ? 'Slett' : 'Delete'}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weapon preset */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('firingRange.weapon', lang)}</label>
          <select
            value={weaponPreset}
            onChange={(e) => selectPreset(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
            disabled={mode === 'calculating'}
          >
            <optgroup label={isNo ? 'NATO kanonartilleri' : 'NATO Tube Artillery'}>
              {WEAPON_PRESETS.filter(p => ['m109','m109a6','m777','k9','pzh2000'].includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label={isNo ? 'Russisk kanonartilleri' : 'Russian Tube Artillery'}>
              {WEAPON_PRESETS.filter(p => ['2s19','2s3','d30','2s1'].includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label={isNo ? 'NATO rakettartilleri' : 'NATO Rocket Artillery'}>
              {WEAPON_PRESETS.filter(p => ['mlrs','himars','gmlrs'].includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label={isNo ? 'Russisk rakettartilleri' : 'Russian Rocket Artillery'}>
              {WEAPON_PRESETS.filter(p => ['bm21','bm27','bm30'].includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label={isNo ? 'Bombekastere' : 'Mortars'}>
              {WEAPON_PRESETS.filter(p => ['mortar120','mortar81'].includes(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
            <option value="custom">{t('firingRange.custom', lang)}</option>
          </select>
          {isCustom && (
            <label className="flex items-center gap-2 mt-1 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={isRocket} onChange={(e) => setIsRocket(e.target.checked)} className="accent-emerald-500" />
              {isNo ? 'Rakettmodell (drevet fase + ballistisk)' : 'Rocket model (thrust + ballistic)'}
            </label>
          )}
        </div>

        {/* Parameters */}
        <div className="space-y-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('firingRange.maxRange', lang)}</label>
            <div className="flex items-center gap-2">
              <input type="range" min={1} max={50} step={0.5} value={maxRangeKm} onChange={(e) => setMaxRangeKm(Number(e.target.value))} className="flex-1 accent-emerald-500" disabled={mode === 'calculating'} />
              <span className="text-sm font-mono w-14 text-right">{maxRangeKm} km</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">{t('firingRange.minElevation', lang)} / {t('firingRange.maxElevation', lang)}</span>
              <button
                onClick={() => setElevUnit(u => {
                  if (u === 'mil') {
                    setMinElMils(milToDeg(minElMils));
                    setMaxElMils(milToDeg(maxElMils));
                    return 'deg';
                  } else {
                    setMinElMils(degToMil(minElMils));
                    setMaxElMils(degToMil(maxElMils));
                    return 'mil';
                  }
                })}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-600 hover:bg-slate-500 transition-colors"
                title={elevUnit === 'mil' ? 'Switch to degrees' : 'Switch to mils'}
              >
                {elevUnit === 'mil' ? 'mil' : 'deg'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <input type="number" value={minElMils} onChange={(e) => setMinElMils(Math.max(0, Number(e.target.value) || 0))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                <span className="text-[10px] text-slate-500">{elevUnit === 'mil' ? 'mil' : '°'}</span>
              </div>
              <div className="flex items-center gap-1">
                <input type="number" value={maxElMils} onChange={(e) => setMaxElMils(Math.max(0, Number(e.target.value) || 0))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                <span className="text-[10px] text-slate-500">{elevUnit === 'mil' ? 'mil' : '°'}</span>
              </div>
            </div>
          </div>
          {isRocket ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">{isNo ? 'Brenntid' : 'Burn time'}</label>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.1" value={burnTime} onChange={(e) => setBurnTime(Math.max(0.1, Math.min(10, Number(e.target.value) || 1)))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                    <span className="text-[10px] text-slate-500">s</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">{isNo ? 'Starthast.' : 'Launch v'}</label>
                  <div className="flex items-center gap-1">
                    <input type="number" value={launchVelocity} onChange={(e) => setLaunchVelocity(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                    <span className="text-[10px] text-slate-500">m/s</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">{isNo ? 'Slutthast.' : 'Burnout v'}</label>
                  <div className="flex items-center gap-1">
                    <input type="number" value={burnoutVelocity} onChange={(e) => setBurnoutVelocity(Math.max(50, Math.min(2000, Number(e.target.value) || 100)))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                    <span className="text-[10px] text-slate-500">m/s</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('firingRange.gunAltitude', lang)}</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={gunAltitude ?? ''} onChange={(e) => setGunAltitude(e.target.value === '' ? null : Number(e.target.value))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating'} placeholder="auto" />
                  <span className="text-[10px] text-slate-500">m</span>
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('firingRange.muzzleVelocity', lang)}</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={muzzleVelocity} onChange={(e) => setMuzzleVelocity(Math.max(50, Math.min(1500, Number(e.target.value) || 100)))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating' || !isCustom} />
                  <span className="text-[10px] text-slate-500">m/s</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('firingRange.gunAltitude', lang)}</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={gunAltitude ?? ''} onChange={(e) => setGunAltitude(e.target.value === '' ? null : Number(e.target.value))} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" disabled={mode === 'calculating'} placeholder="auto" />
                  <span className="text-[10px] text-slate-500">m</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* State machine UI */}
        {(mode === 'idle' && !gun) && (
          <button onClick={startPlacing} className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors font-medium">
            {t('firingRange.placeGun', lang)}
          </button>
        )}
        {mode === 'placing' && <div className="text-center text-emerald-300 text-xs py-2">{t('firingRange.clickToPlace', lang)}</div>}
        {mode === 'ready' && (
          <div className="space-y-2">
            <div className="text-xs text-slate-300 text-center">
              {gun?.lat.toFixed(4)}, {gun?.lng.toFixed(4)}
              {gunAltitude != null && <span className="text-slate-500 ml-2">({gunAltitude}m {isNo ? 'moh' : 'asl'})</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={calculate} className="flex-1 py-2 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors font-medium">{t('firingRange.calculate', lang)}</button>
              <button onClick={reset} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 transition-colors">{t('firingRange.reset', lang)}</button>
            </div>
            {error && <div className="text-red-400 text-xs">{error}</div>}
          </div>
        )}
        {mode === 'calculating' && (
          <div className="flex items-center justify-center gap-2 py-4">
            <svg className="w-5 h-5 animate-spin text-emerald-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-slate-300">{t('firingRange.calculating', lang)}</span>
          </div>
        )}
        {mode === 'replacing' && (
          <div className="text-center text-emerald-300 text-xs py-2">
            {t('firingRange.replacing', lang)}
            <button onClick={() => { setMode('result'); if (mapRef) mapRef.getCanvas().style.cursor = ''; }} className="block mx-auto mt-1 text-slate-400 hover:text-white text-[10px]">{isNo ? 'Avbryt' : 'Cancel'}</button>
          </div>
        )}
        {mode === 'result' && result && (
          <div className="space-y-3">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-700/50 rounded p-2">
                <div className="text-slate-400">{t('firingRange.reachableArea', lang)}</div>
                <div className="text-lg font-mono text-emerald-400">{result.stats.reachablePercent}%</div>
                <div className="text-slate-500">{result.stats.reachableAreaKm2} km²</div>
              </div>
              <div className="bg-slate-700/50 rounded p-2">
                <div className="text-slate-400">{t('firingRange.totalArea', lang)}</div>
                <div className="text-lg font-mono">{result.stats.totalAreaKm2} km²</div>
                <div className="text-slate-500">{result.groundElevation}m {isNo ? 'moh' : 'asl'}</div>
              </div>
            </div>
            {result.stats.deadZoneRadiusKm > 0 && (
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-slate-400">{t('firingRange.deadRadius', lang)}</span>
                <span className="text-red-400 font-mono">{result.stats.deadZoneRadiusKm} km</span>
              </div>
            )}
            {/* Legend */}
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: activeColor, opacity: 0.5 }} />{t('firingRange.reachable', lang)}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444', opacity: 0.5 }} />{t('firingRange.deadZone', lang)}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: '#6b7280', opacity: 0.5 }} />{t('firingRange.masked', lang)}</span>
            </div>
            {/* Color + Label */}
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('firingRange.labelInput', lang)}</label>
                <input type="text" value={activeLabel} onChange={(e) => setActiveLabel(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs" placeholder={isNo ? 'F.eks. Btry Alpha' : 'e.g. Btry Alpha'} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('firingRange.color', lang)}</label>
                <div className="grid grid-cols-5 gap-1">
                  {DRAW_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveColor(c.color)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${activeColor === c.color ? 'border-white scale-110' : 'border-transparent hover:border-slate-400'}`}
                      style={{ backgroundColor: c.color }}
                      title={isNo ? c.label : c.labelEn}
                    />
                  ))}
                </div>
              </div>
            </div>
            {/* Actions */}
            <div className="flex gap-2">
              {activeProjectId && canEditActive && (
                <button onClick={saveToProject} className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 transition-colors text-xs font-medium">
                  {t('firingRange.saveToProject', lang)}
                </button>
              )}
              <button onClick={startReplacing} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors text-xs font-medium">
                {t('firingRange.rePlace', lang)}
              </button>
              <button onClick={reset} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-xs">
                {t('firingRange.clear', lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
