import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

const SOURCE_CIRCLE = 'viewshed-circle';
const SOURCE_RESULT = 'viewshed-result';
const SOURCE_SAVED = 'viewshed-saved';
const SOURCE_SAVED_OBSERVERS = 'viewshed-saved-observers';
const LAYER_CIRCLE_FILL = 'viewshed-circle-fill';
const LAYER_CIRCLE_LINE = 'viewshed-circle-line';
const LAYER_RESULT_FILL = 'viewshed-result-fill';
const LAYER_RESULT_LINE = 'viewshed-result-line';
const LAYER_SAVED_FILL = 'viewshed-saved-fill';
const LAYER_SAVED_LINE = 'viewshed-saved-line';
const LAYER_SAVED_OBSERVERS = 'viewshed-saved-observers';
const LAYER_OBSERVER = 'viewshed-observer';
const SOURCE_OBSERVER = 'viewshed-observer-src';

// Horizon dome layers
const SOURCE_HORIZON_DOME = 'horizon-dome';
const LAYER_HORIZON_FILL = 'horizon-dome-fill';
const LAYER_HORIZON_EXTRUSION = 'horizon-dome-extrusion';
const LAYER_HORIZON_CENTER = 'horizon-dome-center';
const SOURCE_HORIZON_CENTER = 'horizon-dome-center-src';
// Saved horizon domes
const SOURCE_SAVED_HORIZONS = 'viewshed-saved-horizons';
const LAYER_SAVED_HORIZON_FILL = 'viewshed-saved-horizon-fill';
const LAYER_SAVED_HORIZON_EXTRUSION = 'viewshed-saved-horizon-extrusion';
// Saved viewshed boundary circles
const SOURCE_SAVED_BOUNDARIES = 'viewshed-saved-boundaries';
const LAYER_SAVED_BOUNDARIES = 'viewshed-saved-boundaries-line';

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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Destination point given start, bearing (radians), and distance (km)
function destinationPoint(lat, lon, bearingRad, distKm) {
  const R = 6371;
  const d = distKm / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * 180 / Math.PI) + 540) % 360 - 180, lat2 * 180 / Math.PI];
}

// Horizon angle to color: high = green (protected), low = red (exposed)
function horizonColor(angleDeg, maxAngle) {
  const norm = maxAngle > 0 ? Math.min(angleDeg / maxAngle, 1) : 0;
  // Red (exposed) -> Yellow -> Green (protected)
  if (norm < 0.5) {
    const t2 = norm * 2;
    const r = Math.round(220 - t2 * 30);
    const g = Math.round(50 + t2 * 170);
    const b = 50;
    return `rgb(${r},${g},${b})`;
  } else {
    const t2 = (norm - 0.5) * 2;
    const r = Math.round(190 - t2 * 150);
    const g = Math.round(220 - t2 * 20);
    const b = Math.round(50 + t2 * 50);
    return `rgb(${r},${g},${b})`;
  }
}

// Build dome GeoJSON from horizon profile.
// Approximates a hemisphere using concentric rings stepping up in height.
// Each ring uses fill-extrusion-base (previous ring top) + fill-extrusion-height
// to stack on top of each other, forming a smooth dome surface.
function buildHorizonGeoJSON(horizonProfile, center, displayRadiusKm) {
  const numRays = horizonProfile.length;
  const angleStep = 360 / numRays;
  const maxAngle = Math.max(...horizonProfile, 1);
  const features = [];

  const numRings = 10;
  const maxHeight = displayRadiusKm * 1000; // hemisphere: height = radius (250m)
  // Group rays into 4-degree azimuth wedges
  const groupSize = 8;
  const numGroups = Math.floor(numRays / groupSize);

  // Pre-compute grouped angles
  const groupAngles = [];
  for (let g = 0; g < numGroups; g++) {
    let sum = 0;
    for (let j = 0; j < groupSize; j++) sum += horizonProfile[g * groupSize + j];
    groupAngles.push(sum / groupSize);
  }

  // Build rings from outside in (outer ring = base, inner ring = apex)
  for (let ring = 0; ring < numRings; ring++) {
    const rInner = (ring / numRings) * displayRadiusKm;
    const rOuter = ((ring + 1) / numRings) * displayRadiusKm;

    // Hemisphere height at inner and outer edge of this ring
    const rInnerNorm = ring / numRings;
    const rOuterNorm = (ring + 1) / numRings;
    const hInner = Math.sqrt(1 - rInnerNorm * rInnerNorm);
    const hOuter = Math.sqrt(1 - rOuterNorm * rOuterNorm);

    // Uniform dome height — same for all directions at this ring
    const top = Math.max(3, maxHeight * hInner);
    const base = ring === numRings - 1 ? 0 : Math.max(0, maxHeight * hOuter);

    for (let g = 0; g < numGroups; g++) {
      const angle = groupAngles[g];

      const bearing1 = (g * groupSize * angleStep) * Math.PI / 180;
      const bearing2 = ((g + 1) * groupSize * angleStep) * Math.PI / 180;

      // Color shows exposure data; shape is uniform hemisphere
      const color = horizonColor(angle, maxAngle);

      // Build arc segment
      const steps = 2;
      const coords = [];
      for (let s = 0; s <= steps; s++) {
        const b = bearing1 + (bearing2 - bearing1) * (s / steps);
        coords.push(destinationPoint(center[1], center[0], b, rInner));
      }
      for (let s = steps; s >= 0; s--) {
        const b = bearing1 + (bearing2 - bearing1) * (s / steps);
        coords.push(destinationPoint(center[1], center[0], b, rOuter));
      }
      coords.push(coords[0]);

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { color, height: top, base, angle: Math.round(angle * 100) / 100 },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Build saved viewsheds FeatureCollection from store, respecting layer visibility
function buildSavedData(visibleProjectIds, projects, layerVisibility) {
  const polygons = [];
  const observers = [];
  const horizonFeatures = [];
  const boundaries = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.viewsheds) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const v of proj.viewsheds) {
      if (v.layerId && !visLayerIds.has(v.layerId)) continue;

      if (v.type === 'horizon') {
        const profile = v.geojson?.properties?.horizonProfile;
        if (profile) {
          const displayRadius = 0.25;
          const fc = buildHorizonGeoJSON(profile, [v.longitude, v.latitude], displayRadius);
          for (const f of fc.features) {
            f.properties.id = v.id;
            f.properties.projectId = pid;
            horizonFeatures.push(f);
          }
        }
      } else {
        if (v.geojson?.geometry) {
          polygons.push({
            type: 'Feature',
            geometry: v.geojson.geometry,
            properties: { id: v.id, projectId: pid },
          });
        }
      }

      // Boundary circle for all saved viewsheds
      const rKm = Number(v.radiusKm);
      if (v.longitude != null && v.latitude != null && rKm > 0) {
        boundaries.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: (() => {
            const coords = [];
            const R = 6371;
            const lat1 = v.latitude * Math.PI / 180;
            const lon1 = v.longitude * Math.PI / 180;
            const d = rKm / R;
            for (let i = 0; i <= 64; i++) {
              const bearing = (2 * Math.PI * i) / 64;
              const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
              const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
              coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
            }
            return coords;
          })() },
          properties: { id: v.id, projectId: pid, type: v.type || 'viewshed' },
        });
      }

      if (v.longitude != null && v.latitude != null) {
        observers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
          properties: { id: v.id, projectId: pid, type: v.type || 'viewshed' },
        });
      }
    }
  }
  return {
    polygons: { type: 'FeatureCollection', features: polygons },
    observers: { type: 'FeatureCollection', features: observers },
    horizons: { type: 'FeatureCollection', features: horizonFeatures },
    boundaries: { type: 'FeatureCollection', features: boundaries },
  };
}

export default function ViewshedTool() {
  const visible = useMapStore((s) => s.viewshedToolVisible);
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);

  const [toolMode, setToolMode] = useState('viewshed'); // 'viewshed' | 'horizon'
  const [mode, setMode] = useState('idle');
  const [observerHeight, setObserverHeight] = useState(5);
  const [observer, setObserver] = useState(null);
  const [radiusKm, setRadiusKm] = useState(0);
  const [horizonRadiusKm, setHorizonRadiusKm] = useState(15);
  const [domeOpacity, setDomeOpacity] = useState(0.6);
  const [result, setResult] = useState(null);
  const [horizonResult, setHorizonResult] = useState(null);
  const [error, setError] = useState(null);

  // Draggable panel state
  const [panelPos, setPanelPos] = useState({ x: null, y: null });
  const dragRef = useRef(null);
  const dragStartRef = useRef(null);

  const modeRef = useRef(mode);
  const observerRef = useRef(observer);
  const resultRef = useRef(result);
  const radiusRef = useRef(radiusKm);
  const toolModeRef = useRef(toolMode);
  const horizonResultRef = useRef(horizonResult);
  modeRef.current = mode;
  observerRef.current = observer;
  resultRef.current = result;
  radiusRef.current = radiusKm;
  toolModeRef.current = toolMode;
  horizonResultRef.current = horizonResult;

  const savedCount = activeProjectId ? (projects[activeProjectId]?.viewsheds?.length || 0) : 0;

  // --- Draggable panel handlers ---
  const onDragStart = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
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
        x: Math.max(0, Math.min(window.innerWidth - 288, cx - offsetX)),
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

  // All layers & sources
  const ALL_LAYERS = [LAYER_CIRCLE_FILL, LAYER_CIRCLE_LINE, LAYER_RESULT_FILL, LAYER_RESULT_LINE, LAYER_OBSERVER, LAYER_SAVED_FILL, LAYER_SAVED_LINE, LAYER_SAVED_OBSERVERS, LAYER_SAVED_BOUNDARIES, LAYER_HORIZON_FILL, LAYER_HORIZON_EXTRUSION, LAYER_HORIZON_CENTER, LAYER_SAVED_HORIZON_FILL, LAYER_SAVED_HORIZON_EXTRUSION];
  const ALL_SOURCES = [SOURCE_CIRCLE, SOURCE_RESULT, SOURCE_OBSERVER, SOURCE_SAVED, SOURCE_SAVED_OBSERVERS, SOURCE_SAVED_BOUNDARIES, SOURCE_HORIZON_DOME, SOURCE_HORIZON_CENTER, SOURCE_SAVED_HORIZONS];

  const cleanup = useCallback(() => {
    if (!mapRef) return;
    for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
  }, [mapRef]);

  const reset = useCallback(() => {
    setMode('idle');
    setObserver(null);
    setRadiusKm(0);
    setResult(null);
    setHorizonResult(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = '';
      const src = mapRef.getSource(SOURCE_CIRCLE);
      if (src) src.setData(EMPTY_FC);
      const resSrc = mapRef.getSource(SOURCE_RESULT);
      if (resSrc) resSrc.setData(EMPTY_FC);
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
      if (obsSrc) obsSrc.setData(EMPTY_FC);
      const domeSrc = mapRef.getSource(SOURCE_HORIZON_DOME);
      if (domeSrc) domeSrc.setData(EMPTY_FC);
      const centerSrc = mapRef.getSource(SOURCE_HORIZON_CENTER);
      if (centerSrc) centerSrc.setData(EMPTY_FC);
    }
  }, [mapRef]);

  // Initialize layers — re-apply data on style changes
  useEffect(() => {
    if (!visible || !mapRef) return;

    const initLayers = () => {
      const obs = observerRef.current;
      const res = resultRef.current;
      const rad = radiusRef.current;
      const hRes = horizonResultRef.current;

      const circleData = (obs && rad > 0) ? circlePolygon([obs.lng, obs.lat], rad) : EMPTY_FC;
      const resultData = res?.geojson || EMPTY_FC;
      const observerData = obs ? { type: 'Feature', geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] } } : EMPTY_FC;
      const horizonData = hRes?.domeGeoJSON || EMPTY_FC;
      const horizonCenterData = obs && toolModeRef.current === 'horizon' ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] }, properties: {} }] } : EMPTY_FC;
      const { visibleProjectIds: vIds, projects: projs, layerVisibility: lv } = useTacticalStore.getState();
      const saved = buildSavedData(vIds, projs, lv);

      if (!mapRef.getSource(SOURCE_CIRCLE)) mapRef.addSource(SOURCE_CIRCLE, { type: 'geojson', data: circleData });
      if (!mapRef.getSource(SOURCE_RESULT)) mapRef.addSource(SOURCE_RESULT, { type: 'geojson', data: resultData });
      if (!mapRef.getSource(SOURCE_OBSERVER)) mapRef.addSource(SOURCE_OBSERVER, { type: 'geojson', data: observerData });
      if (!mapRef.getSource(SOURCE_SAVED)) mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: saved.polygons });
      if (!mapRef.getSource(SOURCE_SAVED_OBSERVERS)) mapRef.addSource(SOURCE_SAVED_OBSERVERS, { type: 'geojson', data: saved.observers });
      if (!mapRef.getSource(SOURCE_HORIZON_DOME)) mapRef.addSource(SOURCE_HORIZON_DOME, { type: 'geojson', data: horizonData });
      if (!mapRef.getSource(SOURCE_HORIZON_CENTER)) mapRef.addSource(SOURCE_HORIZON_CENTER, { type: 'geojson', data: horizonCenterData });
      if (!mapRef.getSource(SOURCE_SAVED_HORIZONS)) mapRef.addSource(SOURCE_SAVED_HORIZONS, { type: 'geojson', data: saved.horizons });
      if (!mapRef.getSource(SOURCE_SAVED_BOUNDARIES)) mapRef.addSource(SOURCE_SAVED_BOUNDARIES, { type: 'geojson', data: saved.boundaries });

      // Viewshed layers
      if (!mapRef.getLayer(LAYER_CIRCLE_FILL)) mapRef.addLayer({ id: LAYER_CIRCLE_FILL, type: 'fill', source: SOURCE_CIRCLE, paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 } });
      if (!mapRef.getLayer(LAYER_CIRCLE_LINE)) mapRef.addLayer({ id: LAYER_CIRCLE_LINE, type: 'line', source: SOURCE_CIRCLE, paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 2] } });
      if (!mapRef.getLayer(LAYER_SAVED_FILL)) mapRef.addLayer({ id: LAYER_SAVED_FILL, type: 'fill', source: SOURCE_SAVED, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.25 } });
      if (!mapRef.getLayer(LAYER_SAVED_LINE)) mapRef.addLayer({ id: LAYER_SAVED_LINE, type: 'line', source: SOURCE_SAVED, paint: { 'line-color': '#f59e0b', 'line-opacity': 0.5, 'line-width': 1 } });
      if (!mapRef.getLayer(LAYER_SAVED_OBSERVERS)) mapRef.addLayer({ id: LAYER_SAVED_OBSERVERS, type: 'circle', source: SOURCE_SAVED_OBSERVERS, paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'type'], 'horizon', '#a855f7', '#f59e0b'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      // Saved boundary circles
      if (!mapRef.getLayer(LAYER_SAVED_BOUNDARIES)) mapRef.addLayer({ id: LAYER_SAVED_BOUNDARIES, type: 'line', source: SOURCE_SAVED_BOUNDARIES, paint: { 'line-color': ['match', ['get', 'type'], 'horizon', '#a855f7', '#f59e0b'], 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [4, 2] } });
      // Saved horizon domes
      if (!mapRef.getLayer(LAYER_SAVED_HORIZON_FILL)) mapRef.addLayer({ id: LAYER_SAVED_HORIZON_FILL, type: 'fill', source: SOURCE_SAVED_HORIZONS, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4 } });
      if (!mapRef.getLayer(LAYER_SAVED_HORIZON_EXTRUSION)) mapRef.addLayer({ id: LAYER_SAVED_HORIZON_EXTRUSION, type: 'fill-extrusion', source: SOURCE_SAVED_HORIZONS, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.5 } });
      // Active result layers
      if (!mapRef.getLayer(LAYER_RESULT_FILL)) mapRef.addLayer({ id: LAYER_RESULT_FILL, type: 'fill', source: SOURCE_RESULT, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.3 } });
      if (!mapRef.getLayer(LAYER_RESULT_LINE)) mapRef.addLayer({ id: LAYER_RESULT_LINE, type: 'line', source: SOURCE_RESULT, paint: { 'line-color': '#ef4444', 'line-opacity': 0.6, 'line-width': 1 } });
      if (!mapRef.getLayer(LAYER_OBSERVER)) mapRef.addLayer({ id: LAYER_OBSERVER, type: 'circle', source: SOURCE_OBSERVER, paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#ef4444', 'circle-stroke-width': 3 } });
      // Horizon dome layers
      if (!mapRef.getLayer(LAYER_HORIZON_FILL)) mapRef.addLayer({ id: LAYER_HORIZON_FILL, type: 'fill', source: SOURCE_HORIZON_DOME, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.5 } });
      if (!mapRef.getLayer(LAYER_HORIZON_EXTRUSION)) mapRef.addLayer({ id: LAYER_HORIZON_EXTRUSION, type: 'fill-extrusion', source: SOURCE_HORIZON_DOME, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.6 } });
      if (!mapRef.getLayer(LAYER_HORIZON_CENTER)) mapRef.addLayer({ id: LAYER_HORIZON_CENTER, type: 'circle', source: SOURCE_HORIZON_CENTER, paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#a855f7', 'circle-stroke-width': 3 } });
    };

    initLayers();
    mapRef.on('styledata', initLayers);
    return () => { mapRef.off('styledata', initLayers); cleanup(); };
  }, [visible, mapRef, cleanup]);

  // Update saved viewsheds when projects/layers change
  useEffect(() => {
    if (!visible || !mapRef) return;
    const saved = buildSavedData(visibleProjectIds, projects, layerVisibility);
    const src = mapRef.getSource(SOURCE_SAVED);
    if (src) src.setData(saved.polygons);
    const obsSrc = mapRef.getSource(SOURCE_SAVED_OBSERVERS);
    if (obsSrc) obsSrc.setData(saved.observers);
    const hSrc = mapRef.getSource(SOURCE_SAVED_HORIZONS);
    if (hSrc) hSrc.setData(saved.horizons);
    const bSrc = mapRef.getSource(SOURCE_SAVED_BOUNDARIES);
    if (bSrc) bSrc.setData(saved.boundaries);
  }, [visible, mapRef, visibleProjectIds, projects, layerVisibility]);

  // Update dome opacity when slider changes
  useEffect(() => {
    if (!visible || !mapRef) return;
    if (mapRef.getLayer(LAYER_HORIZON_EXTRUSION)) mapRef.setPaintProperty(LAYER_HORIZON_EXTRUSION, 'fill-extrusion-opacity', domeOpacity);
    if (mapRef.getLayer(LAYER_HORIZON_FILL)) mapRef.setPaintProperty(LAYER_HORIZON_FILL, 'fill-opacity', domeOpacity);
    if (mapRef.getLayer(LAYER_SAVED_HORIZON_EXTRUSION)) mapRef.setPaintProperty(LAYER_SAVED_HORIZON_EXTRUSION, 'fill-extrusion-opacity', domeOpacity);
    if (mapRef.getLayer(LAYER_SAVED_HORIZON_FILL)) mapRef.setPaintProperty(LAYER_SAVED_HORIZON_FILL, 'fill-opacity', domeOpacity);
  }, [visible, mapRef, domeOpacity]);

  // Map click handler
  useEffect(() => {
    if (!visible || !mapRef) return;
    const handleClick = (e) => {
      if (toolModeRef.current === 'horizon') {
        if (modeRef.current === 'placing') {
          const { lng, lat } = e.lngLat;
          setObserver({ lng, lat });
          setMode('ready');
          mapRef.getCanvas().style.cursor = '';
          const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
          if (obsSrc) obsSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
          e.preventDefault();
        }
      } else {
        if (modeRef.current === 'placing') {
          const { lng, lat } = e.lngLat;
          setObserver({ lng, lat });
          setMode('sizing');
          mapRef.getCanvas().style.cursor = 'crosshair';
          const obsSrc = mapRef.getSource(SOURCE_OBSERVER);
          if (obsSrc) obsSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
          e.preventDefault();
        } else if (modeRef.current === 'sizing') {
          const obs = observerRef.current;
          if (!obs) return;
          const r = haversineKm(obs.lat, obs.lng, e.lngLat.lat, e.lngLat.lng);
          const capped = Math.min(50, Math.max(0.5, r));
          setRadiusKm(capped);
          mapRef.getCanvas().style.cursor = '';
          const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
          if (circleSrc) circleSrc.setData(circlePolygon([obs.lng, obs.lat], capped));
          setMode('ready');
          e.preventDefault();
        }
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
      const r = Math.min(50, haversineKm(obs.lat, obs.lng, e.lngLat.lat, e.lngLat.lng));
      setRadiusKm(r);
      const circleSrc = mapRef.getSource(SOURCE_CIRCLE);
      if (circleSrc) circleSrc.setData(circlePolygon([obs.lng, obs.lat], r));
    };
    mapRef.on('mousemove', handleMove);
    return () => mapRef.off('mousemove', handleMove);
  }, [visible, mapRef]);

  useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const startPlacing = () => {
    setMode('placing');
    setObserver(null);
    setRadiusKm(0);
    setResult(null);
    setHorizonResult(null);
    setError(null);
    if (mapRef) {
      mapRef.getCanvas().style.cursor = 'crosshair';
      const src = mapRef.getSource(SOURCE_CIRCLE); if (src) src.setData(EMPTY_FC);
      const resSrc = mapRef.getSource(SOURCE_RESULT); if (resSrc) resSrc.setData(EMPTY_FC);
      const obsSrc = mapRef.getSource(SOURCE_OBSERVER); if (obsSrc) obsSrc.setData(EMPTY_FC);
      const domeSrc = mapRef.getSource(SOURCE_HORIZON_DOME); if (domeSrc) domeSrc.setData(EMPTY_FC);
      const centerSrc = mapRef.getSource(SOURCE_HORIZON_CENTER); if (centerSrc) centerSrc.setData(EMPTY_FC);
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
        body: JSON.stringify({ longitude: observer.lng, latitude: observer.lat, observerHeight, radiusKm }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Calculation failed'); }
      const data = await res.json();
      setResult(data);
      setMode('result');
      const resSrc = mapRef?.getSource(SOURCE_RESULT);
      if (resSrc && data.geojson) resSrc.setData(data.geojson);
    } catch (err) { setError(err.message); setMode('ready'); }
  };

  const calculateHorizon = async () => {
    if (!observer) return;
    setMode('calculating');
    setError(null);
    try {
      const res = await fetch('/api/viewshed/calculate-horizon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ longitude: observer.lng, latitude: observer.lat, radiusKm: horizonRadiusKm }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Calculation failed'); }
      const data = await res.json();
      // Build dome GeoJSON
      const displayRadius = 0.25; // 300m display radius
      const domeGeoJSON = buildHorizonGeoJSON(data.horizonProfile, [observer.lng, observer.lat], displayRadius);
      const hResult = { ...data, domeGeoJSON };
      setHorizonResult(hResult);
      setMode('result');
      const domeSrc = mapRef?.getSource(SOURCE_HORIZON_DOME);
      if (domeSrc) domeSrc.setData(domeGeoJSON);
      const centerSrc = mapRef?.getSource(SOURCE_HORIZON_CENTER);
      if (centerSrc) centerSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [observer.lng, observer.lat] }, properties: {} }] });
    } catch (err) { setError(err.message); setMode('ready'); }
  };

  const saveToProject = () => {
    if (!activeProjectId || !observer) return;

    if (toolMode === 'horizon' && horizonResult) {
      socket.emit('client:viewshed:save', {
        projectId: activeProjectId,
        layerId: activeLayerId || null,
        type: 'horizon',
        longitude: observer.lng,
        latitude: observer.lat,
        observerHeight: 0,
        radiusKm: horizonRadiusKm,
        geojson: { properties: { horizonProfile: horizonResult.horizonProfile } },
        stats: horizonResult.stats,
      });
    } else if (result) {
      socket.emit('client:viewshed:save', {
        projectId: activeProjectId,
        layerId: activeLayerId || null,
        type: 'viewshed',
        longitude: observer.lng,
        latitude: observer.lat,
        observerHeight,
        radiusKm,
        geojson: result.geojson,
        stats: result.stats,
      });
    } else {
      return;
    }
    startPlacing();
  };

  const deleteAllSaved = () => {
    if (!activeProjectId) return;
    socket.emit('client:viewshed:delete-all', { projectId: activeProjectId });
  };

  const switchToolMode = (newMode) => {
    if (newMode === toolMode) return;
    reset();
    setToolMode(newMode);
  };

  const close = () => { useMapStore.getState().toggleViewshedTool(); };

  if (!visible) return null;

  const isNo = lang === 'no';
  const posStyle = panelPos.x != null
    ? { position: 'fixed', left: panelPos.x, top: panelPos.y, right: 'auto' }
    : { position: 'absolute', top: '4rem', right: '1rem' };

  return createPortal(
    <div
      ref={dragRef}
      className="z-[15] w-72 bg-slate-800/95 backdrop-blur rounded-lg shadow-xl border border-slate-600/50 text-white text-sm"
      style={posStyle}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-slate-600/50 cursor-move select-none"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        <div className="flex items-center gap-2 font-medium pointer-events-none">
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {t('viewshed.title', lang)}
        </div>
        <button onClick={close} className="text-slate-400 hover:text-white transition-colors pointer-events-auto">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Mode toggle tabs */}
      <div className="flex border-b border-slate-600/50">
        <button
          onClick={() => switchToolMode('viewshed')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${toolMode === 'viewshed' ? 'bg-red-600/30 text-red-300 border-b-2 border-red-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {t('viewshed.title', lang)}
        </button>
        <button
          onClick={() => switchToolMode('horizon')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${toolMode === 'horizon' ? 'bg-purple-600/30 text-purple-300 border-b-2 border-purple-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {t('viewshed.exposureDome', lang)}
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* === VIEWSHED MODE === */}
        {toolMode === 'viewshed' && (
          <>
            {/* Observer height */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('viewshed.observerHeight', lang)}</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setObserverHeight(Math.max(1, observerHeight - 1))} className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center" disabled={mode === 'calculating'}>−</button>
                <input type="number" value={observerHeight} onChange={(e) => setObserverHeight(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} className="w-16 text-center bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm" min={1} max={100} disabled={mode === 'calculating'} />
                <span className="text-slate-400 text-xs">m</span>
                <button onClick={() => setObserverHeight(Math.min(100, observerHeight + 1))} className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center" disabled={mode === 'calculating'}>+</button>
              </div>
            </div>

            {(mode === 'idle' && !observer) && (
              <button onClick={startPlacing} className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 transition-colors font-medium">
                {t('viewshed.placeObserver', lang)}
              </button>
            )}

            {mode === 'placing' && (
              <div className="text-center text-blue-300 text-xs py-2">{t('viewshed.clickToPlace', lang)}</div>
            )}

            {mode === 'sizing' && (
              <div className="space-y-2">
                <div className="text-center text-blue-300 text-xs">{t('viewshed.clickToSetRadius', lang)}</div>
                <div className="text-center text-lg font-mono">{radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`}</div>
                <div className="text-center text-slate-500 text-[10px]">{isNo ? 'Maks 50 km' : 'Max 50 km'}</div>
              </div>
            )}

            {mode === 'ready' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Radius: {radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`}</span>
                  <span>{observer?.lat.toFixed(4)}, {observer?.lng.toFixed(4)}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={calculate} className="flex-1 py-2 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors font-medium">{t('viewshed.calculate', lang)}</button>
                  <button onClick={reset} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 transition-colors">{t('viewshed.reset', lang)}</button>
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
                <span className="text-slate-300">{t('viewshed.calculating', lang)}</span>
              </div>
            )}

            {mode === 'result' && result && (
              <div className="space-y-3">
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
                <div className="flex gap-2">
                  {activeProjectId && (
                    <button onClick={saveToProject} className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 transition-colors text-xs font-medium">
                      {t('viewshed.saveToProject', lang)}
                    </button>
                  )}
                  <button onClick={startPlacing} className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 transition-colors text-xs font-medium">
                    {t('viewshed.newAnalysis', lang)}
                  </button>
                  <button onClick={reset} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-xs">
                    {t('viewshed.clear', lang)}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* === HORIZON / EXPOSURE DOME MODE === */}
        {toolMode === 'horizon' && (
          <>
            {/* Scan radius */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('viewshed.scanRadius', lang)}</label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={1} max={30} step={1} value={horizonRadiusKm}
                  onChange={(e) => setHorizonRadiusKm(Number(e.target.value))}
                  className="flex-1 accent-purple-500" disabled={mode === 'calculating'}
                />
                <span className="text-sm font-mono w-12 text-right">{horizonRadiusKm} km</span>
              </div>
            </div>

            {/* Dome opacity */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">{isNo ? 'Gjennomsiktighet' : 'Opacity'}</label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0.1} max={1} step={0.05} value={domeOpacity}
                  onChange={(e) => setDomeOpacity(Number(e.target.value))}
                  className="flex-1 accent-purple-500"
                />
                <span className="text-sm font-mono w-12 text-right">{Math.round(domeOpacity * 100)}%</span>
              </div>
            </div>

            {(mode === 'idle' && !observer) && (
              <button onClick={startPlacing} className="w-full py-2 rounded bg-purple-600 hover:bg-purple-500 transition-colors font-medium">
                {isNo ? 'Plasser punkt' : 'Place point'}
              </button>
            )}

            {mode === 'placing' && (
              <div className="text-center text-purple-300 text-xs py-2">{isNo ? 'Klikk på kartet for å plassere' : 'Click on map to place'}</div>
            )}

            {mode === 'ready' && (
              <div className="space-y-2">
                <div className="text-xs text-slate-300 text-center">
                  {observer?.lat.toFixed(4)}, {observer?.lng.toFixed(4)}
                </div>
                <div className="flex gap-2">
                  <button onClick={calculateHorizon} className="flex-1 py-2 rounded bg-purple-600 hover:bg-purple-500 transition-colors font-medium">{t('viewshed.calculate', lang)}</button>
                  <button onClick={reset} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 transition-colors">{t('viewshed.reset', lang)}</button>
                </div>
                {error && <div className="text-red-400 text-xs">{error}</div>}
              </div>
            )}

            {mode === 'calculating' && (
              <div className="flex items-center justify-center gap-2 py-4">
                <svg className="w-5 h-5 animate-spin text-purple-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="text-slate-300">{t('viewshed.calculating', lang)}</span>
              </div>
            )}

            {mode === 'result' && horizonResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-700/50 rounded p-2">
                    <div className="text-slate-400">{t('viewshed.exposurePercent', lang)}</div>
                    <div className="text-lg font-mono text-red-400">{horizonResult.stats.exposurePercent}%</div>
                    <div className="text-slate-500">{t('viewshed.exposed', lang)}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2">
                    <div className="text-slate-400">{t('viewshed.meanHorizon', lang)}</div>
                    <div className="text-lg font-mono">{horizonResult.stats.meanHorizonAngleDeg}°</div>
                    <div className="text-slate-500">{horizonResult.groundElevation} m {isNo ? 'moh' : 'asl'}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-slate-400">{t('viewshed.maxHorizon', lang)}</span>
                  <span className="text-green-400 font-mono">{horizonResult.stats.maxHorizonAngleDeg}°</span>
                </div>
                {/* Color legend */}
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="w-3 h-3 rounded-sm" style={{ background: 'rgb(220,50,50)' }} />
                  <span>{t('viewshed.exposed', lang)}</span>
                  <span className="w-3 h-3 rounded-sm ml-auto" style={{ background: 'rgb(40,200,100)' }} />
                  <span>{t('viewshed.protected', lang)}</span>
                </div>
                <div className="flex gap-2">
                  {activeProjectId && (
                    <button onClick={saveToProject} className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 transition-colors text-xs font-medium">
                      {t('viewshed.saveToProject', lang)}
                    </button>
                  )}
                  <button onClick={startPlacing} className="flex-1 py-1.5 rounded bg-purple-600 hover:bg-purple-500 transition-colors text-xs font-medium">
                    {t('viewshed.newAnalysis', lang)}
                  </button>
                  <button onClick={reset} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-xs">
                    {t('viewshed.clear', lang)}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Saved viewsheds count + delete all */}
        {savedCount > 0 && activeProjectId && (
          <div className="border-t border-slate-600/50 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {savedCount} {isNo ? 'lagret' : 'saved'}
              </span>
              <button onClick={deleteAllSaved} className="text-xs text-red-400 hover:text-red-300 transition-colors">
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
