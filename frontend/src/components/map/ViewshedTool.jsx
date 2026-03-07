import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

const SOURCE_CIRCLE = 'viewshed-circle';
const SOURCE_RESULT = 'viewshed-result';
const SOURCE_SAVED = 'viewshed-saved';
const LAYER_CIRCLE_FILL = 'viewshed-circle-fill';
const LAYER_CIRCLE_LINE = 'viewshed-circle-line';
const LAYER_RESULT_FILL = 'viewshed-result-fill';
const LAYER_RESULT_LINE = 'viewshed-result-line';
const LAYER_SAVED_FILL = 'viewshed-saved-fill';
const LAYER_SAVED_LINE = 'viewshed-saved-line';
const LAYER_OBSERVER = 'viewshed-observer';
const SOURCE_OBSERVER = 'viewshed-observer-src';

// Build a circle polygon with N points
function circlePolygon(center, radiusKm, numPoints = 64) {
  const coords = [];
  const R = 6371;
  const lat1 = center[1] * Math.PI / 180;
  const lon1 = center[0] * Math.PI / 180;
  const d = radiusKm / R;

  for (let i = 0; i <= numPoints; i++) {
    const bearing = (2 * Math.PI * i) / numPoints;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Build saved viewsheds FeatureCollection from store
function buildSavedFC(visibleProjectIds, projects) {
  const features = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.viewsheds) continue;
    for (const v of proj.viewsheds) {
      if (v.geojson?.geometry) {
        features.push({
          type: 'Feature',
          geometry: v.geojson.geometry,
          properties: { id: v.id, projectId: pid },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

export default function ViewshedTool() {
  const visible = useMapStore((s) => s.viewshedToolVisible);
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);

  const [mode, setMode] = useState('idle'); // idle | placing | sizing | ready | calculating | result
  const [observerHeight, setObserverHeight] = useState(5);
  const [observer, setObserver] = useState(null); // { lng, lat }
  const [radiusKm, setRadiusKm] = useState(0);
  const [result, setResult] = useState(null); // { geojson, stats, observerElevation }
  const [error, setError] = useState(null);

  const modeRef = useRef(mode);
  const observerRef = useRef(observer);
  const resultRef = useRef(result);
  const radiusRef = useRef(radiusKm);
  modeRef.current = mode;
  observerRef.current = observer;
  resultRef.current = result;
  radiusRef.current = radiusKm;

  // Count saved viewsheds for active project
  const savedCount = activeProjectId
    ? (projects[activeProjectId]?.viewsheds?.length || 0)
    : 0;

  // Cleanup map layers/sources on unmount or toggle off
  const cleanup = useCallback(() => {
    if (!mapRef) return;
    const layers = [LAYER_CIRCLE_FILL, LAYER_CIRCLE_LINE, LAYER_RESULT_FILL, LAYER_RESULT_LINE, LAYER_OBSERVER, LAYER_SAVED_FILL, LAYER_SAVED_LINE];
    const sources = [SOURCE_CIRCLE, SOURCE_RESULT, SOURCE_OBSERVER, SOURCE_SAVED];
    for (const l of layers) {
      if (mapRef.getLayer(l)) mapRef.removeLayer(l);
    }
    for (const s of sources) {
      if (mapRef.getSource(s)) mapRef.removeSource(s);
    }
  }, [mapRef]);

  // Reset tool state
  const reset = useCallback(() => {
    setMode('idle');
    setObserver(null);
    setRadiusKm(0);
    setResult(null);
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

  // Initialize layers when tool becomes visible — re-apply data on style changes
  useEffect(() => {
    if (!visible || !mapRef) return;

    const initLayers = () => {
      // Re-create sources with current data (not empty) so style changes preserve state
      const obs = observerRef.current;
      const res = resultRef.current;
      const rad = radiusRef.current;

      const circleData = (obs && rad > 0)
        ? circlePolygon([obs.lng, obs.lat], rad)
        : EMPTY_FC;
      const resultData = res?.geojson || EMPTY_FC;
      const observerData = obs
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] } }
        : EMPTY_FC;
      const { visibleProjectIds: vIds, projects: projs } = useTacticalStore.getState();
      const savedData = buildSavedFC(vIds, projs);

      if (!mapRef.getSource(SOURCE_CIRCLE)) {
        mapRef.addSource(SOURCE_CIRCLE, { type: 'geojson', data: circleData });
      }
      if (!mapRef.getSource(SOURCE_RESULT)) {
        mapRef.addSource(SOURCE_RESULT, { type: 'geojson', data: resultData });
      }
      if (!mapRef.getSource(SOURCE_OBSERVER)) {
        mapRef.addSource(SOURCE_OBSERVER, { type: 'geojson', data: observerData });
      }
      if (!mapRef.getSource(SOURCE_SAVED)) {
        mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: savedData });
      }

      if (!mapRef.getLayer(LAYER_CIRCLE_FILL)) {
        mapRef.addLayer({
          id: LAYER_CIRCLE_FILL,
          type: 'fill',
          source: SOURCE_CIRCLE,
          paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 },
        });
      }
      if (!mapRef.getLayer(LAYER_CIRCLE_LINE)) {
        mapRef.addLayer({
          id: LAYER_CIRCLE_LINE,
          type: 'line',
          source: SOURCE_CIRCLE,
          paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 2] },
        });
      }
      if (!mapRef.getLayer(LAYER_SAVED_FILL)) {
        mapRef.addLayer({
          id: LAYER_SAVED_FILL,
          type: 'fill',
          source: SOURCE_SAVED,
          paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.25 },
        });
      }
      if (!mapRef.getLayer(LAYER_SAVED_LINE)) {
        mapRef.addLayer({
          id: LAYER_SAVED_LINE,
          type: 'line',
          source: SOURCE_SAVED,
          paint: { 'line-color': '#f59e0b', 'line-opacity': 0.5, 'line-width': 1 },
        });
      }
      if (!mapRef.getLayer(LAYER_RESULT_FILL)) {
        mapRef.addLayer({
          id: LAYER_RESULT_FILL,
          type: 'fill',
          source: SOURCE_RESULT,
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.3 },
        });
      }
      if (!mapRef.getLayer(LAYER_RESULT_LINE)) {
        mapRef.addLayer({
          id: LAYER_RESULT_LINE,
          type: 'line',
          source: SOURCE_RESULT,
          paint: { 'line-color': '#ef4444', 'line-opacity': 0.6, 'line-width': 1 },
        });
      }
      if (!mapRef.getLayer(LAYER_OBSERVER)) {
        mapRef.addLayer({
          id: LAYER_OBSERVER,
          type: 'circle',
          source: SOURCE_OBSERVER,
          paint: {
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-stroke-color': '#ef4444',
            'circle-stroke-width': 3,
          },
        });
      }
    };

    initLayers();
    mapRef.on('styledata', initLayers);

    return () => {
      mapRef.off('styledata', initLayers);
      cleanup();
    };
  }, [visible, mapRef, cleanup]);

  // Render saved viewsheds from visible projects
  useEffect(() => {
    if (!visible || !mapRef) return;
    const src = mapRef.getSource(SOURCE_SAVED);
    if (!src) return;
    src.setData(buildSavedFC(visibleProjectIds, projects));
  }, [visible, mapRef, visibleProjectIds, projects]);

  // Map click handler for placing observer
  useEffect(() => {
    if (!visible || !mapRef) return;

    const handleClick = (e) => {
      if (modeRef.current === 'placing') {
        const { lng, lat } = e.lngLat;
        setObserver({ lng, lat });
        setMode('sizing');
        mapRef.getCanvas().style.cursor = 'crosshair';

        // Show observer marker
        const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
        if (obsSrc) {
          obsSrc.setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
          });
        }
        e.preventDefault();
      } else if (modeRef.current === 'sizing') {
        const obs = observerRef.current;
        if (!obs) return;
        const r = haversineKm(obs.lat, obs.lng, e.lngLat.lat, e.lngLat.lng);
        const capped = Math.min(50, Math.max(0.5, r));
        setRadiusKm(capped);
        mapRef.getCanvas().style.cursor = '';
        // Finalize the circle
        const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
        if (circleSrc) {
          circleSrc.setData(circlePolygon([obs.lng, obs.lat], capped));
        }
        setMode('ready');
        e.preventDefault();
      }
    };

    mapRef.on('click', handleClick);
    return () => mapRef.off('click', handleClick);
  }, [visible, mapRef]);

  // Mouse move for radius preview
  useEffect(() => {
    if (!visible || !mapRef) return;

    const handleMove = (e) => {
      if (modeRef.current !== 'sizing') return;
      const obs = observerRef.current;
      if (!obs) return;
      const r = haversineKm(obs.lat, obs.lng, e.lngLat.lat, e.lngLat.lng);
      const capped = Math.min(50, r);
      setRadiusKm(capped);

      const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
      if (circleSrc) {
        circleSrc.setData(circlePolygon([obs.lng, obs.lat], capped));
      }
    };

    mapRef.on('mousemove', handleMove);
    return () => mapRef.off('mousemove', handleMove);
  }, [visible, mapRef]);

  // Close tool when toggled off
  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [visible, reset]);

  const startPlacing = () => {
    setMode('placing');
    setObserver(null);
    setRadiusKm(0);
    setResult(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = 'crosshair';
      const src = mapRef.getSource(SOURCE_CIRCLE);
      if (src) src.setData(EMPTY_FC);
      const resSrc = mapRef.getSource(SOURCE_RESULT);
      if (resSrc) resSrc.setData(EMPTY_FC);
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) obsSrc.setData(EMPTY_FC);
    }
  };

  const calculate = async () => {
    if (!observer || radiusKm < 0.5) return;
    setMode('calculating');
    setError(null);

    try {
      const res = await fetch('/api/viewshed/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          longitude: observer.lng,
          latitude: observer.lat,
          observerHeight,
          radiusKm,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Calculation failed');
      }

      const data = await res.json();
      setResult(data);
      setMode('result');

      // Render result on map
      const resSrc = mapRef?.getSource(SOURCE_RESULT);
      if (resSrc && data.geojson) {
        resSrc.setData(data.geojson);
      }
    } catch (err) {
      setError(err.message);
      setMode('ready');
    }
  };

  const saveToProject = () => {
    if (!result || !activeProjectId || !observer) return;
    socket.emit('client:viewshed:save', {
      projectId: activeProjectId,
      longitude: observer.lng,
      latitude: observer.lat,
      observerHeight,
      radiusKm,
      geojson: result.geojson,
      stats: result.stats,
    });
  };

  const deleteAllSaved = () => {
    if (!activeProjectId) return;
    socket.emit('client:viewshed:delete-all', { projectId: activeProjectId });
  };

  const close = () => {
    useMapStore.getState().toggleViewshedTool();
  };

  if (!visible) return null;

  const isNo = lang === 'no';

  return createPortal(
    <div className="absolute top-16 right-4 z-[15] w-72 bg-slate-800/95 backdrop-blur rounded-lg shadow-xl border border-slate-600/50 text-white text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-600/50">
        <div className="flex items-center gap-2 font-medium">
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {t('viewshed.title', lang)}
        </div>
        <button onClick={close} className="text-slate-400 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Observer height input */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('viewshed.observerHeight', lang)}</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setObserverHeight(Math.max(1, observerHeight - 1))}
              className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center"
              disabled={mode === 'calculating'}
            >−</button>
            <input
              type="number"
              value={observerHeight}
              onChange={(e) => setObserverHeight(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="w-16 text-center bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
              min={1} max={100}
              disabled={mode === 'calculating'}
            />
            <span className="text-slate-400 text-xs">m</span>
            <button
              onClick={() => setObserverHeight(Math.min(100, observerHeight + 1))}
              className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center"
              disabled={mode === 'calculating'}
            >+</button>
          </div>
        </div>

        {/* Mode-dependent content */}
        {(mode === 'idle' && !observer) && (
          <button
            onClick={startPlacing}
            className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 transition-colors font-medium"
          >
            {t('viewshed.placeObserver', lang)}
          </button>
        )}

        {mode === 'placing' && (
          <div className="text-center text-blue-300 text-xs py-2">
            {t('viewshed.clickToPlace', lang)}
          </div>
        )}

        {mode === 'sizing' && (
          <div className="space-y-2">
            <div className="text-center text-blue-300 text-xs">
              {t('viewshed.clickToSetRadius', lang)}
            </div>
            <div className="text-center text-lg font-mono">
              {radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`}
            </div>
            <div className="text-center text-slate-500 text-[10px]">
              {isNo ? 'Maks 50 km' : 'Max 50 km'}
            </div>
          </div>
        )}

        {mode === 'ready' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{isNo ? 'Radius' : 'Radius'}: {radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`}</span>
              <span>{isNo ? 'Observatør' : 'Observer'}: {observer?.lat.toFixed(4)}, {observer?.lng.toFixed(4)}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={calculate}
                className="flex-1 py-2 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors font-medium"
              >
                {t('viewshed.calculate', lang)}
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 transition-colors"
              >
                {t('viewshed.reset', lang)}
              </button>
            </div>
            {error && (
              <div className="text-red-400 text-xs">{error}</div>
            )}
          </div>
        )}

        {mode === 'calculating' && (
          <div className="flex items-center justify-center gap-2 py-4">
            <svg className="w-5 h-5 animate-spin text-emerald-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-slate-300">{t('viewshed.calculating', lang)}</span>
          </div>
        )}

        {mode === 'result' && result && (
          <div className="space-y-3">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-700/50 rounded p-2">
                <div className="text-slate-400">{t('viewshed.visibleArea', lang)}</div>
                <div className="text-lg font-mono text-red-400">{result.stats.visiblePercent}%</div>
                <div className="text-slate-500">{result.stats.visibleAreaKm2} km²</div>
              </div>
              <div className="bg-slate-700/50 rounded p-2">
                <div className="text-slate-400">{t('viewshed.totalArea', lang)}</div>
                <div className="text-lg font-mono">{result.stats.totalAreaKm2} km²</div>
                <div className="text-slate-500">{result.observerElevation} m {isNo ? 'moh' : 'asl'}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {activeProjectId && (
                <button
                  onClick={saveToProject}
                  className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 transition-colors text-xs font-medium"
                >
                  {t('viewshed.saveToProject', lang)}
                </button>
              )}
              <button
                onClick={startPlacing}
                className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 transition-colors text-xs font-medium"
              >
                {t('viewshed.newAnalysis', lang)}
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-xs"
              >
                {t('viewshed.clear', lang)}
              </button>
            </div>
          </div>
        )}

        {/* Saved viewsheds management */}
        {savedCount > 0 && activeProjectId && (
          <div className="border-t border-slate-600/50 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {savedCount} {isNo ? 'lagret' : 'saved'}
              </span>
              <button
                onClick={deleteAllSaved}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                {t('viewshed.deleteAll', lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
