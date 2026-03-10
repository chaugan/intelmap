import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

// Active-calculation-only layers (saved data is rendered by RFCoverageOverlay)
const SOURCE_CIRCLE = 'rf-coverage-circle';
const SOURCE_RESULT = 'rf-coverage-result';
const SOURCE_OBSERVER = 'rf-coverage-observer-src';
const LAYER_CIRCLE_FILL = 'rf-coverage-circle-fill';
const LAYER_CIRCLE_LINE = 'rf-coverage-circle-line';
const LAYER_RESULT_FILL = 'rf-coverage-result-fill';
const LAYER_OBSERVER = 'rf-coverage-observer';

const BUCKETS = [
  { name: 'excellent',  min: -50, color: '#15803d', invertColor: '#991b1b' },
  { name: 'veryGood',   min: -55, color: '#22c55e', invertColor: '#dc2626' },
  { name: 'good',       min: -60, color: '#4ade80', invertColor: '#ef4444' },
  { name: 'aboveAvg',   min: -65, color: '#84cc16', invertColor: '#f97316' },
  { name: 'average',    min: -70, color: '#eab308', invertColor: '#f59e0b' },
  { name: 'belowAvg',   min: -75, color: '#f59e0b', invertColor: '#eab308' },
  { name: 'marginal',   min: -80, color: '#f97316', invertColor: '#84cc16' },
  { name: 'weak',       min: -85, color: '#ef4444', invertColor: '#4ade80' },
  { name: 'veryWeak',   min: -90, color: '#dc2626', invertColor: '#22c55e' },
  { name: 'noCoverage', min: -Infinity, color: '#991b1b', invertColor: '#15803d' },
];

// MapLibre interpolation expressions for smooth gradient fill
const NORMAL_COLOR_EXPR = [
  'interpolate', ['linear'], ['get', 'signalStrength'],
  -95, '#991b1b', -90, '#dc2626', -85, '#ef4444', -80, '#f97316',
  -75, '#f59e0b', -70, '#eab308', -65, '#84cc16', -60, '#4ade80',
  -55, '#22c55e', -50, '#15803d',
];
const INVERTED_COLOR_EXPR = [
  'interpolate', ['linear'], ['get', 'signalStrength'],
  -95, '#15803d', -90, '#22c55e', -85, '#4ade80', -80, '#84cc16',
  -75, '#eab308', -70, '#f59e0b', -65, '#f97316', -60, '#ef4444',
  -55, '#dc2626', -50, '#991b1b',
];
// Fallback for old saved data that only has 'color' property
const COLOR_EXPR = ['case', ['has', 'signalStrength'], NORMAL_COLOR_EXPR, ['get', 'color']];
const COLOR_EXPR_INV = ['case', ['has', 'signalStrength'], INVERTED_COLOR_EXPR, ['get', 'color']];

const POWER_OPTIONS = [
  { watts: 0.5, label: '0.5W (27 dBm)' },
  { watts: 1, label: '1W (30 dBm)' },
  { watts: 5, label: '5W (37 dBm)' },
  { watts: 10, label: '10W (40 dBm)' },
  { watts: 50, label: '50W (47 dBm)' },
];

const FREQ_CHIPS = [
  { mhz: 70, label: 'VHF 70' },
  { mhz: 150, label: 'VHF 150' },
  { mhz: 300, label: 'UHF 300' },
  { mhz: 450, label: 'UHF 450' },
];

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function circlePolygon(center, radiusKm, numPoints = 64) {
  const coords = [];
  const R = 6371;
  const lat1 = center[1] * Math.PI / 180;
  const lon1 = center[0] * Math.PI / 180;
  const d = radiusKm / R;
  for (let i = 0; i <= numPoints; i++) {
    const bearing = (2 * Math.PI * i) / numPoints;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

function applyDisplayOptions(geojson, dimmedBuckets) {
  if (!geojson?.features) return geojson;
  if (dimmedBuckets.size === 0) return geojson;
  return { ...geojson, features: geojson.features.filter(f => !dimmedBuckets.has(f.properties.bucket)) };
}

export default function RFCoverageTool() {
  const visible = useMapStore((s) => s.rfCoverageToolVisible);
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);
  const sessionRFCoverages = useMapStore((s) => s.sessionRFCoverages);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);

  const [mode, setMode] = useState('idle');
  const [antennaHeight, setAntennaHeight] = useState(1.5);
  const [txPowerWatts, setTxPowerWatts] = useState(5);
  const [frequencyMHz, setFrequencyMHz] = useState('');
  const [radiusKm, setRadiusKm] = useState(15);
  const [dampening, setDampening] = useState(0);
  const [opacity, setOpacity] = useState(0.6);
  const [invertColors, setInvertColors] = useState(false);
  const [dimmedBuckets, setDimmedBuckets] = useState(new Set());
  const [antenna, setAntenna] = useState(null);
  const [result, setResult] = useState(null);
  const [resultGeojson, setResultGeojson] = useState(null);
  const [error, setError] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null); // ID of session item being edited

  // Draggable panel state
  const [panelPos, setPanelPos] = useState({ x: null, y: null });
  const dragRef = useRef(null);
  const dragStartRef = useRef(null);

  const modeRef = useRef(mode);
  const antennaRef = useRef(antenna);
  const resultGeojsonRef = useRef(resultGeojson);
  const invertColorsRef = useRef(invertColors);
  const dimmedBucketsRef = useRef(dimmedBuckets);
  modeRef.current = mode;
  antennaRef.current = antenna;
  resultGeojsonRef.current = resultGeojson;
  invertColorsRef.current = invertColors;
  dimmedBucketsRef.current = dimmedBuckets;

  // Collect all saved RF coverages from visible projects
  const savedItems = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.rfCoverages) continue;
    for (const c of proj.rfCoverages) {
      savedItems.push({ ...c, _projectId: pid });
    }
  }

  const freqValid = typeof frequencyMHz === 'number' && isFinite(frequencyMHz) && frequencyMHz >= 2;
  const canCalculate = antenna && freqValid;

  // --- Draggable panel handlers ---
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
      const pw = dragRef.current?.offsetWidth || 300;
      setPanelPos({
        x: Math.max(0, Math.min(window.innerWidth - pw, cx - offsetX)),
        y: Math.max(0, Math.min(window.innerHeight - 100, cy - offsetY)),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, []);

  const ALL_LAYERS = [LAYER_CIRCLE_FILL, LAYER_CIRCLE_LINE, LAYER_RESULT_FILL, LAYER_OBSERVER];
  const ALL_SOURCES = [SOURCE_CIRCLE, SOURCE_RESULT, SOURCE_OBSERVER];

  const cleanup = useCallback(() => {
    if (!mapRef) return;
    for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
  }, [mapRef]);

  // Save current active result to session (if it's not already saved to a project)
  const saveToSession = useCallback(() => {
    if (!antenna || !resultGeojson || !result) return null;
    const id = activeSessionId || crypto.randomUUID();
    const entry = {
      id, longitude: antenna.lng, latitude: antenna.lat,
      antennaHeight, txPowerWatts, frequencyMHz: Number(frequencyMHz), radiusKm, dampening,
      geojson: resultGeojson, stats: result.stats,
    };
    const store = useMapStore.getState();
    const existing = store.sessionRFCoverages.find(c => c.id === id);
    if (existing) {
      // Update in place
      useMapStore.setState({ sessionRFCoverages: store.sessionRFCoverages.map(c => c.id === id ? entry : c) });
    } else {
      useMapStore.setState({ sessionRFCoverages: [...store.sessionRFCoverages, entry] });
    }
    return id;
  }, [antenna, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening, result, resultGeojson, activeSessionId]);

  const reset = useCallback(() => {
    setMode('idle');
    setAntenna(null);
    setResult(null);
    setResultGeojson(null);
    setError(null);
    setDimmedBuckets(new Set());
    setActiveSessionId(null);
    useMapStore.setState({ activeRFCoverageId: null });
    if (mapRef) {
      mapRef.getCanvas().style.cursor = '';
      const src = mapRef.getSource(SOURCE_CIRCLE);
      if (src) src.setData(EMPTY_FC);
      const resSrc = mapRef.getSource(SOURCE_RESULT);
      if (resSrc) resSrc.setData(EMPTY_FC);
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) obsSrc.setData(EMPTY_FC);
      // Clear overlay filter so all items show again
      if (mapRef.getLayer('rf-coverage-saved-fill')) mapRef.setFilter('rf-coverage-saved-fill', null);
      if (mapRef.getLayer('rf-coverage-saved-observers')) mapRef.setFilter('rf-coverage-saved-observers', null);
    }
  }, [mapRef]);

  // Initialize active-calculation layers only
  useEffect(() => {
    if (!visible || !mapRef) return;

    const initLayers = () => {
      const ant = antennaRef.current;
      const gj = resultGeojsonRef.current;
      const dim = dimmedBucketsRef.current;
      const inv = invertColorsRef.current;

      if (!mapRef.getSource(SOURCE_CIRCLE)) mapRef.addSource(SOURCE_CIRCLE, { type: 'geojson', data: EMPTY_FC });
      if (!mapRef.getSource(SOURCE_RESULT)) mapRef.addSource(SOURCE_RESULT, { type: 'geojson', data: gj ? applyDisplayOptions(gj, dim) : EMPTY_FC });
      if (!mapRef.getSource(SOURCE_OBSERVER)) mapRef.addSource(SOURCE_OBSERVER, { type: 'geojson', data: ant ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [ant.lng, ant.lat] }, properties: {} }] } : EMPTY_FC });

      if (!mapRef.getLayer(LAYER_CIRCLE_FILL)) mapRef.addLayer({ id: LAYER_CIRCLE_FILL, type: 'fill', source: SOURCE_CIRCLE, paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.08 } });
      if (!mapRef.getLayer(LAYER_CIRCLE_LINE)) mapRef.addLayer({ id: LAYER_CIRCLE_LINE, type: 'line', source: SOURCE_CIRCLE, paint: { 'line-color': '#a855f7', 'line-width': 2, 'line-dasharray': [4, 4] } });
      if (!mapRef.getLayer(LAYER_RESULT_FILL)) mapRef.addLayer({ id: LAYER_RESULT_FILL, type: 'fill', source: SOURCE_RESULT, paint: { 'fill-color': inv ? COLOR_EXPR_INV : COLOR_EXPR, 'fill-opacity': 0.6 } });
      if (!mapRef.getLayer(LAYER_OBSERVER)) mapRef.addLayer({ id: LAYER_OBSERVER, type: 'circle', source: SOURCE_OBSERVER, paint: { 'circle-radius': 7, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    };

    initLayers();
    mapRef.on('styledata', initLayers);
    return () => { mapRef.off('styledata', initLayers); cleanup(); };
  }, [visible, mapRef, cleanup]);

  // Update opacity
  useEffect(() => {
    if (!mapRef || !visible) return;
    if (mapRef.getLayer(LAYER_RESULT_FILL)) mapRef.setPaintProperty(LAYER_RESULT_FILL, 'fill-opacity', opacity);
  }, [opacity, mapRef, visible]);

  // Update result display when dimmed buckets change
  useEffect(() => {
    if (!mapRef || !resultGeojson) return;
    const src = mapRef.getSource(SOURCE_RESULT);
    if (src) src.setData(applyDisplayOptions(resultGeojson, dimmedBuckets));
  }, [dimmedBuckets, resultGeojson, mapRef]);

  // Update color expression when invert changes
  useEffect(() => {
    if (!mapRef || !visible) return;
    if (mapRef.getLayer(LAYER_RESULT_FILL)) {
      mapRef.setPaintProperty(LAYER_RESULT_FILL, 'fill-color', invertColors ? COLOR_EXPR_INV : COLOR_EXPR);
    }
  }, [invertColors, mapRef, visible]);

  // Update circle preview
  useEffect(() => {
    if (!mapRef || !antenna) return;
    const src = mapRef.getSource(SOURCE_CIRCLE);
    if (src) src.setData(circlePolygon([antenna.lng, antenna.lat], radiusKm));
  }, [radiusKm, antenna, mapRef]);

  // Map click handler
  useEffect(() => {
    if (!visible || !mapRef) return;
    const onClick = (e) => {
      if (modeRef.current !== 'placing') return;
      const { lng, lat } = e.lngLat;
      setAntenna({ lng, lat });
      setMode('ready');
      mapRef.getCanvas().style.cursor = '';
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) obsSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }] });
      const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
      if (circleSrc) circleSrc.setData(circlePolygon([lng, lat], radiusKm));
    };
    mapRef.on('click', onClick);
    return () => mapRef.off('click', onClick);
  }, [visible, mapRef, radiusKm]);

  // On tool close: save active result to session, then clear active layers
  useEffect(() => {
    if (!visible) {
      saveToSession();
      reset();
    }
  }, [visible, saveToSession, reset]);

  const handlePlaceAntenna = useCallback(() => {
    setMode('placing');
    setResult(null);
    setResultGeojson(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = 'crosshair';
      const src = mapRef.getSource(SOURCE_RESULT);
      if (src) src.setData(EMPTY_FC);
    }
  }, [mapRef]);

  const handleCalculate = useCallback(async () => {
    const freq = Number(frequencyMHz);
    if (!antenna || !isFinite(freq) || freq < 2) return;
    setMode('calculating');
    setError(null);
    try {
      const res = await fetch('/api/rfcoverage/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ longitude: antenna.lng, latitude: antenna.lat, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening }),
      });
      if (!res.ok) throw new Error('Calculation failed');
      const data = await res.json();
      resultGeojsonRef.current = data.geojson;
      setResult(data);
      setResultGeojson(data.geojson);
      setMode('result');

      // Create/update session entry for this calculation
      const sessId = activeSessionId || crypto.randomUUID();
      setActiveSessionId(sessId);
      const sessEntry = {
        id: sessId, longitude: antenna.lng, latitude: antenna.lat,
        antennaHeight, txPowerWatts, frequencyMHz: Number(frequencyMHz), radiusKm, dampening,
        geojson: data.geojson, stats: data.stats,
      };
      const store = useMapStore.getState();
      const existing = store.sessionRFCoverages.find(c => c.id === sessId);
      if (existing) {
        useMapStore.setState({ sessionRFCoverages: store.sessionRFCoverages.map(c => c.id === sessId ? sessEntry : c) });
      } else {
        useMapStore.setState({ sessionRFCoverages: [...store.sessionRFCoverages, sessEntry] });
      }
      // Exclude from overlay while active in tool
      useMapStore.setState({ activeRFCoverageId: sessId });
      if (mapRef) {
        const excludeFilter = ['!=', ['get', 'id'], sessId];
        if (mapRef.getLayer('rf-coverage-saved-fill')) mapRef.setFilter('rf-coverage-saved-fill', excludeFilter);
        if (mapRef.getLayer('rf-coverage-saved-observers')) mapRef.setFilter('rf-coverage-saved-observers', excludeFilter);
      }

      if (mapRef) {
        const src = mapRef.getSource(SOURCE_RESULT);
        if (src) src.setData(applyDisplayOptions(data.geojson, dimmedBuckets));
      }
    } catch (err) {
      setError(err.message);
      setMode('ready');
    }
  }, [antenna, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening, mapRef, dimmedBuckets, activeSessionId]);

  const handleSave = useCallback(async () => {
    if (!activeProjectId || !result) return;
    setMode('saving');
    setError(null);
    try {
      const res = await fetch('/api/rfcoverage/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId: activeProjectId,
          layerId: activeLayerId,
          longitude: antenna.lng,
          latitude: antenna.lat,
          antennaHeight, txPowerWatts, frequencyMHz: Number(frequencyMHz), radiusKm, dampening,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Save failed (${res.status})`);
      }
      const meta = await res.json();
      // Server re-calculates and stores geojson; attach local copy for immediate display
      useTacticalStore.getState().addRFCoverage(activeProjectId, { ...meta, geojson: resultGeojson, stats: result.stats });
      // Remove from session since it's now saved to project
      if (activeSessionId) {
        const store = useMapStore.getState();
        useMapStore.setState({ sessionRFCoverages: store.sessionRFCoverages.filter(c => c.id !== activeSessionId) });
      }
      reset();
    } catch (err) {
      console.error('RF save error:', err);
      setError(err.message || 'Save failed');
      setMode('result');
    }
  }, [activeProjectId, activeLayerId, antenna, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening, result, resultGeojson, activeSessionId, reset]);

  const flyTo = useCallback((lng, lat) => {
    if (!mapRef) return;
    mapRef.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.getZoom(), 12), duration: 1200 });
  }, [mapRef]);

  // Load a coverage (saved or session) into the tool for viewing/editing
  const loadItem = useCallback((item, isSession = false) => {
    // Save current active result to session before switching
    if (activeSessionId && resultGeojson && result) {
      saveToSession();
    }

    // Skip if already loaded
    if (useMapStore.getState().activeRFCoverageId === item.id) return;

    // Hide this item from the overlay — filter is synchronous (no flicker)
    useMapStore.setState({ activeRFCoverageId: item.id });
    if (mapRef) {
      const excludeFilter = ['!=', ['get', 'id'], item.id];
      if (mapRef.getLayer('rf-coverage-saved-fill')) mapRef.setFilter('rf-coverage-saved-fill', excludeFilter);
      if (mapRef.getLayer('rf-coverage-saved-observers')) mapRef.setFilter('rf-coverage-saved-observers', excludeFilter);
    }

    setActiveSessionId(isSession ? item.id : null);
    setAntennaHeight(item.antennaHeight || 1.5);
    setTxPowerWatts(item.txPowerWatts || 5);
    setFrequencyMHz(item.frequencyMHz || '');
    setRadiusKm(item.radiusKm || 15);
    setDampening(item.dampening || 0);
    setAntenna({ lng: item.longitude, lat: item.latitude });
    setError(null);
    setDimmedBuckets(new Set());
    if (item.geojson && item.stats) {
      setResultGeojson(item.geojson);
      setResult({ stats: item.stats, antennaElevation: item.antennaElevation, parameters: item.parameters });
      setMode('result');
      if (mapRef) {
        const src = mapRef.getSource(SOURCE_RESULT);
        if (src) src.setData(applyDisplayOptions(item.geojson, new Set()));
        const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
        if (obsSrc) obsSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] }, properties: {} }] });
      }
    } else {
      setResult(null);
      setResultGeojson(null);
      setMode('ready');
    }
    flyTo(item.longitude, item.latitude);
  }, [mapRef, flyTo, activeSessionId, resultGeojson, result, saveToSession]);

  if (!visible) return null;

  const panelStyle = panelPos.x !== null
    ? { position: 'fixed', left: panelPos.x, top: panelPos.y, zIndex: 1000 }
    : { position: 'fixed', top: 80, right: 8, zIndex: 1000 };

  return createPortal(
    <div
      ref={dragRef}
      style={panelStyle}
      className="w-[calc(100vw-16px)] max-w-[300px] bg-slate-800/95 backdrop-blur rounded-lg shadow-xl border border-slate-600 text-sm text-slate-200 select-none max-h-[calc(100vh-100px)] overflow-y-auto"
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-600 cursor-move">
        <div className="flex items-center gap-2 font-medium">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m0-12a4 4 0 100-8 4 4 0 000 8zm-6 2l-2 2m16-4l-2 2M6 16l-2 2m16-4l-2 2" />
          </svg>
          {t('rfcoverage.title', lang)}
        </div>
        <button onClick={() => useMapStore.getState().toggleRFCoverageTool()} className="text-slate-400 hover:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* === Session (unsaved) coverages === */}
        {sessionRFCoverages.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-medium">{sessionRFCoverages.length} {lang === 'no' ? 'ulagret' : 'unsaved'}</div>
            <div className="space-y-px max-h-32 overflow-y-auto">
              {sessionRFCoverages.map((c) => {
                const isActive = activeSessionId === c.id;
                return (
                  <div key={c.id} className={`flex items-center gap-1.5 text-[11px] rounded px-1 py-0.5 hover:bg-slate-700/50 ${isActive ? 'bg-purple-900/30 border border-purple-700/50' : ''}`}>
                    <span className="shrink-0 w-2 h-2 rounded-full bg-amber-500" title={lang === 'no' ? 'Ulagret' : 'Unsaved'} />
                    <span
                      className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
                      onClick={() => loadItem(c, true)}
                    >
                      RF {c.frequencyMHz}MHz {c.txPowerWatts}W
                    </span>
                    <span className="text-slate-500 text-[10px]">{c.radiusKm}km</span>
                    <button
                      onClick={() => {
                        useMapStore.setState({ sessionRFCoverages: useMapStore.getState().sessionRFCoverages.filter(x => x.id !== c.id) });
                        if (activeSessionId === c.id) reset();
                      }}
                      className="shrink-0 text-slate-600 hover:text-red-400"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* === Saved Items List (project-saved) === */}
        {savedItems.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-medium">{savedItems.length} {t('rfcoverage.saved', lang)}</div>
            <div className="space-y-px max-h-32 overflow-y-auto">
              {savedItems.map((c) => {
                const isVis = itemVisibility[c.id] !== false;
                return (
                  <div key={c.id} className={`flex items-center gap-1.5 text-[11px] rounded px-1 py-0.5 hover:bg-slate-700/50 ${isVis ? '' : 'opacity-40'}`}>
                    <button
                      onClick={() => useTacticalStore.getState().toggleItemVisibility(c.id)}
                      className={`shrink-0 ${isVis ? 'text-purple-400' : 'text-slate-600'}`}
                      title={isVis ? (lang === 'no' ? 'Skjul' : 'Hide') : (lang === 'no' ? 'Vis' : 'Show')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        {isVis ? (
                          <><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                        ) : (
                          <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                        )}
                      </svg>
                    </button>
                    <span
                      className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
                      onClick={() => loadItem(c, false)}
                      title={lang === 'no' ? 'Last inn innstillinger' : 'Load settings'}
                    >
                      RF {c.frequencyMHz}MHz {c.txPowerWatts}W
                    </span>
                    <span className="text-slate-500 text-[10px]">{c.radiusKm}km</span>
                    <button
                      onClick={() => flyTo(c.longitude, c.latitude)}
                      className="shrink-0 text-slate-600 hover:text-cyan-400"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => socket.emit('client:rfcoverage:delete', { projectId: c._projectId, id: c.id })}
                      className="shrink-0 text-slate-600 hover:text-red-400"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* === New Antenna Config === */}
        <div className="border-t border-slate-600 pt-2">
          <div className="text-xs text-slate-400 font-medium mb-2">{t('rfcoverage.newAnalysis', lang)}</div>

          {/* Antenna Height */}
          <div>
            <label className="text-xs text-slate-400">{t('rfcoverage.antennaHeight', lang)}</label>
            <select value={antennaHeight} onChange={(e) => setAntennaHeight(Number(e.target.value))} className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value={1.5}>{t('rfcoverage.handheld', lang)}</option>
              <option value={3}>{t('rfcoverage.vehicle', lang)}</option>
              <option value={10}>{t('rfcoverage.mast', lang)}</option>
            </select>
          </div>

          {/* Transmit Power */}
          <div className="mt-2">
            <label className="text-xs text-slate-400">{t('rfcoverage.txPower', lang)}</label>
            <select value={txPowerWatts} onChange={(e) => setTxPowerWatts(Number(e.target.value))} className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm">
              {POWER_OPTIONS.map((p) => <option key={p.watts} value={p.watts}>{p.label}</option>)}
            </select>
          </div>

          {/* Frequency */}
          <div className="mt-2">
            <label className="text-xs text-slate-400">{t('rfcoverage.frequency', lang)}</label>
            <div className="flex gap-1 mt-1">
              {FREQ_CHIPS.map((f) => (
                <button key={f.mhz} onClick={() => setFrequencyMHz(f.mhz)} className={`px-2 py-0.5 rounded text-xs ${frequencyMHz === f.mhz ? 'bg-purple-600 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="number" value={frequencyMHz}
              onChange={(e) => { const raw = e.target.value; if (raw === '') { setFrequencyMHz(''); return; } const n = Number(raw); if (isFinite(n)) setFrequencyMHz(Math.min(6000, n)); }}
              placeholder="MHz" className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" min={2} max={6000}
            />
          </div>

          {/* Radius */}
          <div className="mt-2">
            <label className="text-xs text-slate-400">{t('rfcoverage.radius', lang)}: {radiusKm} km</label>
            <input type="range" min={1} max={30} step={1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-full mt-1" />
          </div>

          {/* Dampening */}
          <div className="mt-2">
            <label className="text-xs text-slate-400">{t('rfcoverage.dampening', lang)}</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number" value={dampening === 0 ? '' : dampening}
                onChange={(e) => { const raw = e.target.value; if (raw === '' || raw === '-') { setDampening(0); return; } const n = Number(raw); if (!isFinite(n)) return; setDampening(n > 0 ? -n : n); }}
                placeholder="0" className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" max={0}
              />
              <span className="text-slate-400 text-xs shrink-0">dB</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          {mode === 'idle' && (
            <button onClick={handlePlaceAntenna} className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm font-medium">
              {t('rfcoverage.placeAntenna', lang)}
            </button>
          )}

          {mode === 'placing' && (
            <div className="text-center text-purple-300 text-xs py-2">{t('rfcoverage.clickToPlace', lang)}</div>
          )}

          {mode === 'ready' && (
            <div className="flex gap-2">
              <button onClick={handleCalculate} disabled={!canCalculate} className="flex-1 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium">
                {t('rfcoverage.calculate', lang)}
              </button>
              <button onClick={handlePlaceAntenna} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                {t('rfcoverage.placeAntenna', lang)}
              </button>
            </div>
          )}

          {mode === 'calculating' && (
            <div className="flex items-center justify-center gap-2 py-2">
              <svg className="w-4 h-4 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-purple-300">{t('rfcoverage.calculating', lang)}</span>
            </div>
          )}

          {(mode === 'result' || mode === 'saving') && (
            <div className="flex gap-2">
              <button onClick={handleCalculate} disabled={!canCalculate || mode === 'saving'} className="flex-1 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium">
                {t('rfcoverage.recalculate', lang)}
              </button>
              <button onClick={handlePlaceAntenna} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                {t('rfcoverage.placeAntenna', lang)}
              </button>
            </div>
          )}

          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>

        {/* Error display */}
        {error && (
          <div className="px-3 py-1.5 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">{error}</div>
        )}

        {/* Result stats */}
        {(mode === 'result' || mode === 'saving') && result && (
          <div className="space-y-2">
            <div className="space-y-0.5 text-xs">
              {BUCKETS.map((b, i) => {
                const pct = result.stats[b.name + 'Percent'] || 0;
                const rangeLabel = i === 0 ? `> ${b.min} dBm` : i === BUCKETS.length - 1 ? `< ${BUCKETS[i - 1].min} dBm` : `${b.min} to ${BUCKETS[i - 1].min} dBm`;
                const isDimmed = dimmedBuckets.has(b.name);
                return (
                  <div key={b.name} className={`flex items-center gap-1.5 cursor-pointer rounded px-0.5 py-px hover:bg-slate-700/40 transition-opacity ${isDimmed ? 'opacity-30' : ''}`}
                    onClick={() => setDimmedBuckets(prev => { const next = new Set(prev); if (next.has(b.name)) next.delete(b.name); else next.add(b.name); return next; })}
                    title={isDimmed ? (lang === 'no' ? 'Vis på kart' : 'Show on map') : (lang === 'no' ? 'Skjul fra kart' : 'Hide from map')}
                  >
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: isDimmed ? '#475569' : (invertColors ? b.invertColor : b.color) }} />
                    <span className={isDimmed ? 'text-slate-500 line-through' : 'text-slate-300'}>{t(`rfcoverage.${b.name}`, lang)}</span>
                    <span className="text-slate-500 text-[10px]">{rangeLabel}</span>
                    <span className="ml-auto font-mono">{pct}%</span>
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-slate-400">
              {t('rfcoverage.maxRange', lang)}: <span className="text-slate-200 font-mono">{result.stats.maxRangeKm} km</span>
            </div>

            <div>
              <label className="text-xs text-slate-400">{t('rfcoverage.opacity', lang)}: {Math.round(opacity * 100)}%</label>
              <input type="range" min={10} max={100} step={5} value={opacity * 100} onChange={(e) => setOpacity(Number(e.target.value) / 100)} className="w-full" />
            </div>

            <button onClick={() => setInvertColors(!invertColors)} className={`w-full py-1 rounded text-xs ${invertColors ? 'bg-purple-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}>
              {t('rfcoverage.invertColors', lang)}
            </button>

            {/* Save to project */}
            <div className="flex gap-2">
              {activeProjectId && (
                <button onClick={handleSave} disabled={mode === 'saving'} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait rounded text-xs font-medium">
                  {mode === 'saving' ? t('rfcoverage.saving', lang) : t('rfcoverage.saveToProject', lang)}
                </button>
              )}
              <button onClick={() => { saveToSession(); reset(); handlePlaceAntenna(); }} disabled={mode === 'saving'} className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs">
                {t('rfcoverage.newAnalysis', lang)}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Color legend */}
      <div className="px-3 pb-2">
        <div className="flex gap-0.5 text-[10px]">
          {BUCKETS.map((b) => {
            const isDimmed = dimmedBuckets.has(b.name);
            return (
              <div key={b.name} className={`flex-1 text-center cursor-pointer transition-opacity ${isDimmed ? 'opacity-30' : ''}`}
                onClick={() => setDimmedBuckets(prev => { const next = new Set(prev); if (next.has(b.name)) next.delete(b.name); else next.add(b.name); return next; })}
              >
                <div className="h-2 rounded-sm" style={{ backgroundColor: isDimmed ? '#475569' : (invertColors ? b.invertColor : b.color) }} />
                <div className="text-slate-400 mt-0.5">{b.min === -Infinity ? `<${BUCKETS[BUCKETS.length - 2].min}` : `>${b.min}`}</div>
              </div>
            );
          })}
        </div>
        <div className="text-center text-[10px] text-slate-500 mt-0.5">dBm</div>
      </div>
    </div>,
    document.body
  );
}
