import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

const SOURCE_CIRCLE = 'rf-coverage-circle';
const SOURCE_RESULT = 'rf-coverage-result';
const SOURCE_OBSERVER = 'rf-coverage-observer-src';
const SOURCE_SAVED = 'rf-coverage-saved';
const SOURCE_SAVED_OBSERVERS = 'rf-coverage-saved-observers';
const LAYER_CIRCLE_FILL = 'rf-coverage-circle-fill';
const LAYER_CIRCLE_LINE = 'rf-coverage-circle-line';
const LAYER_RESULT_FILL = 'rf-coverage-result-fill';
const LAYER_OBSERVER = 'rf-coverage-observer';
const LAYER_SAVED_FILL = 'rf-coverage-saved-fill';
const LAYER_SAVED_OBSERVERS = 'rf-coverage-saved-observers';

const BUCKETS = [
  { name: 'excellent', min: -70, color: '#22c55e', invertColor: '#ef4444' },
  { name: 'good', min: -85, color: '#84cc16', invertColor: '#f97316' },
  { name: 'marginal', min: -100, color: '#eab308', invertColor: '#eab308' },
  { name: 'weak', min: -110, color: '#f97316', invertColor: '#84cc16' },
  { name: 'noCoverage', min: -Infinity, color: '#ef4444', invertColor: '#22c55e' },
];

const INVERT_MAP = {
  '#22c55e': '#ef4444', '#84cc16': '#f97316', '#eab308': '#eab308',
  '#f97316': '#84cc16', '#ef4444': '#22c55e',
};

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

function invertGeojson(geojson) {
  if (!geojson?.features) return geojson;
  return {
    ...geojson,
    features: geojson.features.map(f => ({
      ...f,
      properties: {
        ...f.properties,
        color: INVERT_MAP[f.properties.color] || f.properties.color,
      },
    })),
  };
}

function buildSavedData(visibleProjectIds, projects, layerVisibility) {
  const polygons = [];
  const observers = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.rfCoverages) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const c of proj.rfCoverages) {
      if (c.layerId && !visLayerIds.has(c.layerId)) continue;
      if (c.geojson?.features) {
        for (const f of c.geojson.features) {
          polygons.push({ ...f, properties: { ...f.properties, id: c.id, projectId: pid } });
        }
      }
      if (c.longitude != null && c.latitude != null) {
        observers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
          properties: { id: c.id, projectId: pid },
        });
      }
    }
  }
  return {
    polygons: { type: 'FeatureCollection', features: polygons },
    observers: { type: 'FeatureCollection', features: observers },
  };
}

export default function RFCoverageTool() {
  const visible = useMapStore((s) => s.rfCoverageToolVisible);
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);

  const [mode, setMode] = useState('idle');
  const [antennaHeight, setAntennaHeight] = useState(1.5);
  const [txPowerWatts, setTxPowerWatts] = useState(5);
  const [frequencyMHz, setFrequencyMHz] = useState(150);
  const [radiusKm, setRadiusKm] = useState(15);
  const [opacity, setOpacity] = useState(0.6);
  const [invertColors, setInvertColors] = useState(false);
  const [antenna, setAntenna] = useState(null);
  const [result, setResult] = useState(null);
  const [resultGeojson, setResultGeojson] = useState(null);
  const [error, setError] = useState(null);

  // Draggable panel state
  const [panelPos, setPanelPos] = useState({ x: null, y: null });
  const dragRef = useRef(null);
  const dragStartRef = useRef(null);

  const modeRef = useRef(mode);
  const antennaRef = useRef(antenna);
  const resultRef = useRef(result);
  modeRef.current = mode;
  antennaRef.current = antenna;
  resultRef.current = result;

  const savedCount = activeProjectId ? (projects[activeProjectId]?.rfCoverages?.length || 0) : 0;

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
      setPanelPos({
        x: Math.max(0, Math.min(window.innerWidth - 300, cx - offsetX)),
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

  const ALL_LAYERS = [LAYER_CIRCLE_FILL, LAYER_CIRCLE_LINE, LAYER_RESULT_FILL, LAYER_OBSERVER, LAYER_SAVED_FILL, LAYER_SAVED_OBSERVERS];
  const ALL_SOURCES = [SOURCE_CIRCLE, SOURCE_RESULT, SOURCE_OBSERVER, SOURCE_SAVED, SOURCE_SAVED_OBSERVERS];

  const cleanup = useCallback(() => {
    if (!mapRef) return;
    for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
  }, [mapRef]);

  const reset = useCallback(() => {
    setMode('idle');
    setAntenna(null);
    setResult(null);
    setResultGeojson(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = '';
      const src = mapRef.getSource(SOURCE_CIRCLE);
      if (src) src.setData(EMPTY_FC);
      const resSrc = mapRef.getSource(SOURCE_RESULT);
      if (resSrc) resSrc.setData(EMPTY_FC);
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) obsSrc.setData(EMPTY_FC);
    }
  }, [mapRef]);

  // Initialize layers
  useEffect(() => {
    if (!visible || !mapRef) return;

    const initLayers = () => {
      const ant = antennaRef.current;
      const res = resultRef.current;

      // Sources
      if (!mapRef.getSource(SOURCE_CIRCLE)) {
        mapRef.addSource(SOURCE_CIRCLE, { type: 'geojson', data: EMPTY_FC });
      }
      if (!mapRef.getSource(SOURCE_RESULT)) {
        mapRef.addSource(SOURCE_RESULT, { type: 'geojson', data: res?.geojson ? (invertColors ? invertGeojson(res.geojson) : res.geojson) : EMPTY_FC });
      }
      if (!mapRef.getSource(SOURCE_OBSERVER)) {
        mapRef.addSource(SOURCE_OBSERVER, { type: 'geojson', data: ant ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [ant.lng, ant.lat] }, properties: {} }] } : EMPTY_FC });
      }
      if (!mapRef.getSource(SOURCE_SAVED)) {
        mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: EMPTY_FC });
      }
      if (!mapRef.getSource(SOURCE_SAVED_OBSERVERS)) {
        mapRef.addSource(SOURCE_SAVED_OBSERVERS, { type: 'geojson', data: EMPTY_FC });
      }

      // Layers
      if (!mapRef.getLayer(LAYER_SAVED_FILL)) {
        mapRef.addLayer({
          id: LAYER_SAVED_FILL, type: 'fill', source: SOURCE_SAVED,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4 },
        });
      }
      if (!mapRef.getLayer(LAYER_SAVED_OBSERVERS)) {
        mapRef.addLayer({
          id: LAYER_SAVED_OBSERVERS, type: 'circle', source: SOURCE_SAVED_OBSERVERS,
          paint: { 'circle-radius': 6, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });
      }
      if (!mapRef.getLayer(LAYER_CIRCLE_FILL)) {
        mapRef.addLayer({
          id: LAYER_CIRCLE_FILL, type: 'fill', source: SOURCE_CIRCLE,
          paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.08 },
        });
      }
      if (!mapRef.getLayer(LAYER_CIRCLE_LINE)) {
        mapRef.addLayer({
          id: LAYER_CIRCLE_LINE, type: 'line', source: SOURCE_CIRCLE,
          paint: { 'line-color': '#a855f7', 'line-width': 2, 'line-dasharray': [4, 4] },
        });
      }
      if (!mapRef.getLayer(LAYER_RESULT_FILL)) {
        mapRef.addLayer({
          id: LAYER_RESULT_FILL, type: 'fill', source: SOURCE_RESULT,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.6 },
        });
      }
      if (!mapRef.getLayer(LAYER_OBSERVER)) {
        mapRef.addLayer({
          id: LAYER_OBSERVER, type: 'circle', source: SOURCE_OBSERVER,
          paint: { 'circle-radius': 7, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });
      }
    };

    initLayers();
    const onStyle = () => { cleanup(); initLayers(); };
    mapRef.on('styledata', onStyle);

    return () => {
      mapRef.off('styledata', onStyle);
      cleanup();
    };
  }, [visible, mapRef, cleanup]);

  // Update opacity
  useEffect(() => {
    if (!mapRef || !visible) return;
    if (mapRef.getLayer(LAYER_RESULT_FILL)) {
      mapRef.setPaintProperty(LAYER_RESULT_FILL, 'fill-opacity', opacity);
    }
  }, [opacity, mapRef, visible]);

  // Update result display when invert changes
  useEffect(() => {
    if (!mapRef || !resultGeojson) return;
    const src = mapRef.getSource(SOURCE_RESULT);
    if (src) {
      src.setData(invertColors ? invertGeojson(resultGeojson) : resultGeojson);
    }
  }, [invertColors, resultGeojson, mapRef]);

  // Update circle preview when radius or antenna changes
  useEffect(() => {
    if (!mapRef || !antenna) return;
    const src = mapRef.getSource(SOURCE_CIRCLE);
    if (src) {
      src.setData(circlePolygon([antenna.lng, antenna.lat], radiusKm));
    }
  }, [radiusKm, antenna, mapRef]);

  // Update saved data
  useEffect(() => {
    if (!visible || !mapRef) return;
    const saved = buildSavedData(visibleProjectIds, projects, layerVisibility);
    const src = mapRef.getSource(SOURCE_SAVED);
    if (src) src.setData(saved.polygons);
    const obsSrc = mapRef.getSource(SOURCE_SAVED_OBSERVERS);
    if (obsSrc) obsSrc.setData(saved.observers);
  }, [visible, mapRef, visibleProjectIds, projects, layerVisibility]);

  // Map click handler
  useEffect(() => {
    if (!visible || !mapRef) return;

    const onClick = (e) => {
      if (modeRef.current !== 'placing') return;
      const { lng, lat } = e.lngLat;
      setAntenna({ lng, lat });
      setMode('ready');
      mapRef.getCanvas().style.cursor = '';

      // Show observer point
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) {
        obsSrc.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }],
        });
      }

      // Show radius circle
      const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
      if (circleSrc) {
        circleSrc.setData(circlePolygon([lng, lat], radiusKm));
      }
    };

    mapRef.on('click', onClick);
    return () => mapRef.off('click', onClick);
  }, [visible, mapRef, radiusKm]);

  // Cleanup on hide
  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [visible, reset]);

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
    if (!antenna) return;
    setMode('calculating');
    setError(null);

    try {
      const res = await fetch('/api/rfcoverage/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          longitude: antenna.lng,
          latitude: antenna.lat,
          antennaHeight,
          txPowerWatts,
          frequencyMHz,
          radiusKm,
        }),
      });

      if (!res.ok) throw new Error('Calculation failed');
      const data = await res.json();
      setResult(data);
      setResultGeojson(data.geojson);
      setMode('result');

      // Update map
      if (mapRef) {
        const src = mapRef.getSource(SOURCE_RESULT);
        if (src) {
          src.setData(invertColors ? invertGeojson(data.geojson) : data.geojson);
        }
      }
    } catch (err) {
      setError(err.message);
      setMode('ready');
    }
  }, [antenna, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, mapRef, invertColors]);

  const handleSave = useCallback(() => {
    if (!activeProjectId || !result) return;
    socket.emit('client:rfcoverage:save', {
      projectId: activeProjectId,
      layerId: activeLayerId,
      longitude: antenna.lng,
      latitude: antenna.lat,
      antennaHeight,
      txPowerWatts,
      frequencyMHz,
      radiusKm,
      geojson: resultGeojson,
      stats: result.stats,
    });
  }, [activeProjectId, activeLayerId, antenna, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, result, resultGeojson]);

  const handleDeleteAll = useCallback(() => {
    if (!activeProjectId) return;
    socket.emit('client:rfcoverage:delete-all', { projectId: activeProjectId });
  }, [activeProjectId]);

  if (!visible) return null;

  const panelStyle = panelPos.x !== null ? {
    position: 'fixed', left: panelPos.x, top: panelPos.y, zIndex: 1000,
  } : {
    position: 'fixed', top: 100, right: 16, zIndex: 1000,
  };

  return createPortal(
    <div
      ref={dragRef}
      style={panelStyle}
      className="w-[300px] bg-slate-800/95 backdrop-blur rounded-lg shadow-xl border border-slate-600 text-sm text-slate-200 select-none"
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
        <button
          onClick={() => useMapStore.getState().toggleRFCoverageTool()}
          className="text-slate-400 hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Antenna Height */}
        <div>
          <label className="text-xs text-slate-400">{t('rfcoverage.antennaHeight', lang)}</label>
          <select
            value={antennaHeight}
            onChange={(e) => setAntennaHeight(Number(e.target.value))}
            className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            <option value={1.5}>{t('rfcoverage.handheld', lang)}</option>
            <option value={3}>{t('rfcoverage.vehicle', lang)}</option>
            <option value={10}>{t('rfcoverage.mast', lang)}</option>
          </select>
        </div>

        {/* Transmit Power */}
        <div>
          <label className="text-xs text-slate-400">{t('rfcoverage.txPower', lang)}</label>
          <select
            value={txPowerWatts}
            onChange={(e) => setTxPowerWatts(Number(e.target.value))}
            className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
          >
            {POWER_OPTIONS.map((p) => (
              <option key={p.watts} value={p.watts}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Frequency */}
        <div>
          <label className="text-xs text-slate-400">{t('rfcoverage.frequency', lang)}</label>
          <div className="flex gap-1 mt-1">
            {FREQ_CHIPS.map((f) => (
              <button
                key={f.mhz}
                onClick={() => setFrequencyMHz(f.mhz)}
                className={`px-2 py-0.5 rounded text-xs ${frequencyMHz === f.mhz ? 'bg-purple-600 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            value={frequencyMHz}
            onChange={(e) => setFrequencyMHz(Math.max(2, Math.min(6000, Number(e.target.value) || 150)))}
            className="w-full mt-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
            min={2} max={6000}
          />
        </div>

        {/* Radius */}
        <div>
          <label className="text-xs text-slate-400">{t('rfcoverage.radius', lang)}: {radiusKm} km</label>
          <input
            type="range" min={1} max={30} step={1} value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="w-full mt-1"
          />
        </div>

        {/* Action buttons */}
        {mode === 'idle' && (
          <button
            onClick={handlePlaceAntenna}
            className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm font-medium"
          >
            {t('rfcoverage.placeAntenna', lang)}
          </button>
        )}

        {mode === 'placing' && (
          <div className="text-center text-purple-300 text-xs py-2">
            {t('rfcoverage.clickToPlace', lang)}
          </div>
        )}

        {mode === 'ready' && (
          <div className="flex gap-2">
            <button
              onClick={handleCalculate}
              className="flex-1 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm font-medium"
            >
              {t('rfcoverage.calculate', lang)}
            </button>
            <button
              onClick={handlePlaceAntenna}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
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

        {error && <div className="text-red-400 text-xs">{error}</div>}

        {/* Result stats */}
        {mode === 'result' && result && (
          <div className="space-y-2">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-1 text-xs">
              {BUCKETS.map((b) => {
                const pct = result.stats[b.name + 'Percent'] || 0;
                return (
                  <div key={b.name} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: invertColors ? b.invertColor : b.color }} />
                    <span className="text-slate-300">{t(`rfcoverage.${b.name}`, lang)}</span>
                    <span className="ml-auto font-mono">{pct}%</span>
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-slate-400">
              {t('rfcoverage.maxRange', lang)}: <span className="text-slate-200 font-mono">{result.stats.maxRangeKm} km</span>
            </div>

            {/* Controls */}
            <div>
              <label className="text-xs text-slate-400">{t('rfcoverage.opacity', lang)}: {Math.round(opacity * 100)}%</label>
              <input
                type="range" min={10} max={100} step={5} value={opacity * 100}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="w-full"
              />
            </div>

            <button
              onClick={() => setInvertColors(!invertColors)}
              className={`w-full py-1 rounded text-xs ${invertColors ? 'bg-purple-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              {t('rfcoverage.invertColors', lang)}
            </button>

            {/* Action buttons */}
            <div className="flex gap-2">
              {activeProjectId && (
                <button
                  onClick={handleSave}
                  className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-medium"
                >
                  {t('rfcoverage.saveToProject', lang)}
                </button>
              )}
              <button
                onClick={() => { reset(); handlePlaceAntenna(); }}
                className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                {t('rfcoverage.newAnalysis', lang)}
              </button>
            </div>
          </div>
        )}

        {/* Saved coverages section */}
        {savedCount > 0 && (
          <div className="border-t border-slate-600 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{savedCount} {t('rfcoverage.saved', lang)}</span>
              <button
                onClick={handleDeleteAll}
                className="text-red-400 hover:text-red-300 text-xs"
              >
                {t('rfcoverage.deleteAll', lang)}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Color legend */}
      <div className="px-3 pb-2">
        <div className="flex gap-1 text-[10px]">
          {BUCKETS.map((b) => (
            <div key={b.name} className="flex-1 text-center">
              <div className="h-2 rounded-sm" style={{ backgroundColor: invertColors ? b.invertColor : b.color }} />
              <div className="text-slate-400 mt-0.5">{b.min === -Infinity ? '<-110' : `>${b.min}`}</div>
            </div>
          ))}
        </div>
        <div className="text-center text-[10px] text-slate-500 mt-0.5">dBm</div>
      </div>
    </div>,
    document.body
  );
}
