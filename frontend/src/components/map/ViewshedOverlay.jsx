/**
 * ViewshedOverlay — always mounted, renders saved viewsheds on the map
 * regardless of whether the ViewshedTool panel is open.
 */
import { useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';

const SOURCE_SAVED = 'viewshed-saved';
const SOURCE_SAVED_OBSERVERS = 'viewshed-saved-observers';
const SOURCE_SAVED_BOUNDARIES = 'viewshed-saved-boundaries';
const SOURCE_SAVED_HORIZONS = 'viewshed-saved-horizons';
const LAYER_SAVED_FILL = 'viewshed-saved-fill';
const LAYER_SAVED_LINE = 'viewshed-saved-line';
const LAYER_SAVED_OBSERVERS = 'viewshed-saved-observers';
const LAYER_SAVED_LABELS = 'viewshed-saved-labels';
const LAYER_SAVED_BOUNDARIES = 'viewshed-saved-boundaries-line';
const LAYER_SAVED_HORIZON_FILL = 'viewshed-saved-horizon-fill';
const LAYER_SAVED_HORIZON_EXTRUSION = 'viewshed-saved-horizon-extrusion';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const DEFAULT_VIEWSHED_COLOR = '#ef4444';
const DEFAULT_HORIZON_COLOR = '#a855f7';

function destinationPoint(lat, lon, bearingRad, distKm) {
  const R = 6371;
  const d = distKm / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * 180 / Math.PI) + 540) % 360 - 180, lat2 * 180 / Math.PI];
}

function interpolateProfile(horizonProfile, azimuthDeg) {
  const n = horizonProfile.length;
  const step = 360 / n;
  const idx = ((azimuthDeg % 360) + 360) % 360 / step;
  const i0 = Math.floor(idx) % n;
  const i1 = (i0 + 1) % n;
  const frac = idx - Math.floor(idx);
  return horizonProfile[i0] * (1 - frac) + horizonProfile[i1] * frac;
}

function horizonColor(angleDeg, maxAngle) {
  const norm = maxAngle > 0 ? Math.min(angleDeg / maxAngle, 1) : 0;
  if (norm < 0.5) {
    const t2 = norm * 2;
    return `rgb(${Math.round(220 - t2 * 30)},${Math.round(50 + t2 * 170)},50)`;
  } else {
    const t2 = (norm - 0.5) * 2;
    return `rgb(${Math.round(190 - t2 * 150)},${Math.round(220 - t2 * 20)},${Math.round(50 + t2 * 50)})`;
  }
}

function buildHorizonGeoJSON(horizonProfile, center, radiusKm, heightScale) {
  const maxAngle = Math.max(...horizonProfile, 1);
  const features = [];
  const numRings = Math.min(25, Math.max(12, Math.round(radiusKm * 1.5)));
  const numWedges = 120;
  const wedgeAngle = 360 / numWedges;
  const maxHeight = radiusKm * 1000 * heightScale;

  for (let ring = 0; ring < numRings; ring++) {
    const rInner = (ring / numRings) * radiusKm;
    const rOuter = ((ring + 1) / numRings) * radiusKm;
    const hInner = Math.sqrt(Math.max(0, 1 - (ring / numRings) ** 2));
    const hOuter = Math.sqrt(Math.max(0, 1 - ((ring + 1) / numRings) ** 2));
    const top = Math.max(3, maxHeight * hInner);
    const base = ring === numRings - 1 ? 0 : Math.max(0, maxHeight * hOuter);

    for (let w = 0; w < numWedges; w++) {
      const azCenter = w * wedgeAngle + wedgeAngle / 2;
      const angle = interpolateProfile(horizonProfile, azCenter);
      const color = horizonColor(angle, maxAngle);
      const b1 = (w * wedgeAngle) * Math.PI / 180;
      const b2 = ((w + 1) * wedgeAngle) * Math.PI / 180;
      const coords = [];
      const arcSteps = 3;
      for (let s = 0; s <= arcSteps; s++) {
        const b = b1 + (b2 - b1) * (s / arcSteps);
        coords.push(destinationPoint(center[1], center[0], b, rInner));
      }
      for (let s = arcSteps; s >= 0; s--) {
        const b = b1 + (b2 - b1) * (s / arcSteps);
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

function featureColor(v) {
  return v.color || (v.type === 'horizon' ? DEFAULT_HORIZON_COLOR : DEFAULT_VIEWSHED_COLOR);
}

function buildSavedViewshedData(visibleProjectIds, projects, layerVisibility, itemVisibility, heightScale = 0.05) {
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
      if (itemVisibility[v.id] === false) continue;

      const color = featureColor(v);

      if (v.type === 'horizon') {
        const profile = v.geojson?.properties?.horizonProfile;
        if (profile) {
          const savedRadius = Number(v.radiusKm) || 15;
          const fc = buildHorizonGeoJSON(profile, [v.longitude, v.latitude], savedRadius, heightScale);
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
            properties: { id: v.id, projectId: pid, color },
          });
        }
      }

      const rKm = Number(v.radiusKm);
      if (v.longitude != null && v.latitude != null && rKm > 0) {
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
        boundaries.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { id: v.id, projectId: pid, type: v.type || 'viewshed', color },
        });
      }

      if (v.longitude != null && v.latitude != null) {
        observers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
          properties: {
            id: v.id, projectId: pid, type: v.type || 'viewshed', color,
            label: v.label || '', observerHeight: v.observerHeight, radiusKm: v.radiusKm,
          },
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

const ALL_LAYERS = [LAYER_SAVED_FILL, LAYER_SAVED_LINE, LAYER_SAVED_OBSERVERS, LAYER_SAVED_LABELS, LAYER_SAVED_BOUNDARIES, LAYER_SAVED_HORIZON_FILL, LAYER_SAVED_HORIZON_EXTRUSION];
const ALL_SOURCES = [SOURCE_SAVED, SOURCE_SAVED_OBSERVERS, SOURCE_SAVED_BOUNDARIES, SOURCE_SAVED_HORIZONS];

function addViewshedLayers(map) {
  const defaultColor = DEFAULT_VIEWSHED_COLOR;
  const defaultHorizonColor = DEFAULT_HORIZON_COLOR;

  if (!map.getLayer(LAYER_SAVED_FILL)) map.addLayer({ id: LAYER_SAVED_FILL, type: 'fill', source: SOURCE_SAVED, paint: { 'fill-color': ['coalesce', ['get', 'color'], defaultColor], 'fill-opacity': 0.25 } });
  if (!map.getLayer(LAYER_SAVED_LINE)) map.addLayer({ id: LAYER_SAVED_LINE, type: 'line', source: SOURCE_SAVED, paint: { 'line-color': ['coalesce', ['get', 'color'], defaultColor], 'line-opacity': 0.5, 'line-width': 1 } });
  if (!map.getLayer(LAYER_SAVED_OBSERVERS)) map.addLayer({ id: LAYER_SAVED_OBSERVERS, type: 'circle', source: SOURCE_SAVED_OBSERVERS, paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': ['coalesce', ['get', 'color'], ['match', ['get', 'type'], 'horizon', defaultHorizonColor, defaultColor]], 'circle-stroke-width': 3 } });
  if (!map.getLayer(LAYER_SAVED_LABELS)) map.addLayer({ id: LAYER_SAVED_LABELS, type: 'symbol', source: SOURCE_SAVED_OBSERVERS, filter: ['!=', ['get', 'label'], ''], layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#1e293b', 'text-halo-width': 1.5 } });
  if (!map.getLayer(LAYER_SAVED_BOUNDARIES)) map.addLayer({ id: LAYER_SAVED_BOUNDARIES, type: 'line', source: SOURCE_SAVED_BOUNDARIES, paint: { 'line-color': ['coalesce', ['get', 'color'], ['match', ['get', 'type'], 'horizon', defaultHorizonColor, defaultColor]], 'line-width': 3, 'line-opacity': 0.8, 'line-dasharray': [4, 2] } });
  if (!map.getLayer(LAYER_SAVED_HORIZON_FILL)) map.addLayer({ id: LAYER_SAVED_HORIZON_FILL, type: 'fill', source: SOURCE_SAVED_HORIZONS, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4 } });
  if (!map.getLayer(LAYER_SAVED_HORIZON_EXTRUSION)) map.addLayer({ id: LAYER_SAVED_HORIZON_EXTRUSION, type: 'fill-extrusion', source: SOURCE_SAVED_HORIZONS, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.5 } });
}

export default function ViewshedOverlay() {
  const mapRef = useMapStore((s) => s.mapRef);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);
  const dataRef = useRef(null);

  // Single effect: create/update/remove sources+layers whenever state changes
  useEffect(() => {
    if (!mapRef) return;

    const removeLayers = () => {
      for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
      for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
    };

    const hasData = visibleProjectIds.some(pid => projects[pid]?.viewsheds?.length > 0);

    if (!hasData) {
      removeLayers();
      dataRef.current = null;
      return;
    }

    const data = buildSavedViewshedData(visibleProjectIds, projects, layerVisibility, itemVisibility);
    dataRef.current = data;

    // Ensure sources exist, then update data
    const ensureSource = (id, d) => {
      const src = mapRef.getSource(id);
      if (src) { src.setData(d); } else { mapRef.addSource(id, { type: 'geojson', data: d }); }
    };
    ensureSource(SOURCE_SAVED, data.polygons);
    ensureSource(SOURCE_SAVED_OBSERVERS, data.observers);
    ensureSource(SOURCE_SAVED_BOUNDARIES, data.boundaries);
    ensureSource(SOURCE_SAVED_HORIZONS, data.horizons);

    addViewshedLayers(mapRef);

    // Re-add after base map style changes
    const onStyleData = () => {
      const d = dataRef.current;
      if (!d) return;
      if (!mapRef.getSource(SOURCE_SAVED)) mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: d.polygons });
      if (!mapRef.getSource(SOURCE_SAVED_OBSERVERS)) mapRef.addSource(SOURCE_SAVED_OBSERVERS, { type: 'geojson', data: d.observers });
      if (!mapRef.getSource(SOURCE_SAVED_BOUNDARIES)) mapRef.addSource(SOURCE_SAVED_BOUNDARIES, { type: 'geojson', data: d.boundaries });
      if (!mapRef.getSource(SOURCE_SAVED_HORIZONS)) mapRef.addSource(SOURCE_SAVED_HORIZONS, { type: 'geojson', data: d.horizons });
      addViewshedLayers(mapRef);
    };
    mapRef.on('styledata', onStyleData);
    return () => { mapRef.off('styledata', onStyleData); removeLayers(); };
  }, [mapRef, visibleProjectIds, projects, layerVisibility, itemVisibility]);

  // Click handler on observer points
  useEffect(() => {
    if (!mapRef) return;

    const onClick = (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const { id, projectId } = feature.properties;
      window.dispatchEvent(new CustomEvent('viewshed:config-open', {
        detail: { id, projectId, lngLat: e.lngLat },
      }));
    };
    const onEnter = () => { mapRef.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { mapRef.getCanvas().style.cursor = ''; };

    // Delay slightly so layer exists
    const setup = () => {
      if (!mapRef.getLayer(LAYER_SAVED_OBSERVERS)) return;
      mapRef.on('click', LAYER_SAVED_OBSERVERS, onClick);
      mapRef.on('mouseenter', LAYER_SAVED_OBSERVERS, onEnter);
      mapRef.on('mouseleave', LAYER_SAVED_OBSERVERS, onLeave);
    };
    setup();
    mapRef.on('styledata', setup);

    return () => {
      mapRef.off('styledata', setup);
      if (mapRef.getLayer(LAYER_SAVED_OBSERVERS)) {
        mapRef.off('click', LAYER_SAVED_OBSERVERS, onClick);
        mapRef.off('mouseenter', LAYER_SAVED_OBSERVERS, onEnter);
        mapRef.off('mouseleave', LAYER_SAVED_OBSERVERS, onLeave);
      }
    };
  }, [mapRef]);

  return null;
}
