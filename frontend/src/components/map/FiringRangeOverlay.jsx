/**
 * FiringRangeOverlay — always mounted, renders saved firing ranges on the map
 * regardless of whether the FiringRangeTool panel is open.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';

const SOURCE_SAVED = 'firing-range-saved';
const SOURCE_SAVED_GUNS = 'firing-range-saved-guns';
const LAYER_SAVED_REACHABLE = 'firing-range-saved-reachable';
const LAYER_SAVED_DEAD = 'firing-range-saved-dead';
const LAYER_SAVED_MASKED = 'firing-range-saved-masked';
const LAYER_SAVED_RINGS = 'firing-range-saved-rings';
const LAYER_SAVED_RINGS_LABEL = 'firing-range-saved-rings-label';
const LAYER_SAVED_GUNS = 'firing-range-saved-guns';
const LAYER_SAVED_LABELS = 'firing-range-saved-labels';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const DEFAULT_COLOR = '#22c55e';

function buildSavedFiringRangeData(visibleProjectIds, projects, layerVisibility, itemVisibility) {
  const features = [];
  const guns = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.firingRanges) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => {
        if (layerVisibility[l.id] === false) return false;
        if (l.parentId) return layerVisibility[l.parentId] !== false;
        return true;
      }).map(l => l.id)
    );
    for (const f of proj.firingRanges) {
      if (f.layerId && !visLayerIds.has(f.layerId)) continue;
      if (itemVisibility[f.id] === false) continue;

      const color = f.color || DEFAULT_COLOR;

      if (f.geojson?.features) {
        for (const feat of f.geojson.features) {
          features.push({
            ...feat,
            properties: {
              ...feat.properties,
              id: f.id,
              projectId: pid,
              color,
            },
          });
        }
      }

      if (f.longitude != null && f.latitude != null) {
        guns.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
          properties: {
            id: f.id, projectId: pid, color,
            label: f.label || '',
            weaponPreset: f.weaponPreset || 'custom',
            maxRangeKm: f.maxRangeKm,
          },
        });
      }
    }
  }
  return {
    features: { type: 'FeatureCollection', features },
    guns: { type: 'FeatureCollection', features: guns },
  };
}

const ALL_LAYERS = [LAYER_SAVED_REACHABLE, LAYER_SAVED_DEAD, LAYER_SAVED_MASKED, LAYER_SAVED_RINGS, LAYER_SAVED_RINGS_LABEL, LAYER_SAVED_GUNS, LAYER_SAVED_LABELS];
const ALL_SOURCES = [SOURCE_SAVED, SOURCE_SAVED_GUNS];

function addFiringRangeLayers(map) {
  if (!map.getLayer(LAYER_SAVED_REACHABLE)) map.addLayer({ id: LAYER_SAVED_REACHABLE, type: 'fill', source: SOURCE_SAVED, filter: ['==', ['get', 'zone'], 'reachable'], paint: { 'fill-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR], 'fill-opacity': 0.25 } });
  if (!map.getLayer(LAYER_SAVED_DEAD)) map.addLayer({ id: LAYER_SAVED_DEAD, type: 'fill', source: SOURCE_SAVED, filter: ['==', ['get', 'zone'], 'dead'], paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.3 } });
  if (!map.getLayer(LAYER_SAVED_MASKED)) map.addLayer({ id: LAYER_SAVED_MASKED, type: 'fill', source: SOURCE_SAVED, filter: ['==', ['get', 'zone'], 'masked'], paint: { 'fill-color': '#6b7280', 'fill-opacity': 0.15 } });
  if (!map.getLayer(LAYER_SAVED_RINGS)) map.addLayer({ id: LAYER_SAVED_RINGS, type: 'line', source: SOURCE_SAVED, filter: ['==', ['get', 'type'], 'range-ring'], paint: { 'line-color': '#94a3b8', 'line-width': 1, 'line-dasharray': [4, 4] } });
  if (!map.getLayer(LAYER_SAVED_RINGS_LABEL)) map.addLayer({ id: LAYER_SAVED_RINGS_LABEL, type: 'symbol', source: SOURCE_SAVED, filter: ['==', ['get', 'type'], 'range-ring'], layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'distanceKm']], ' km'], 'text-size': 10, 'text-offset': [0, -0.8] }, paint: { 'text-color': '#94a3b8', 'text-halo-color': '#1e293b', 'text-halo-width': 1 } });
  if (!map.getLayer(LAYER_SAVED_GUNS)) map.addLayer({ id: LAYER_SAVED_GUNS, type: 'circle', source: SOURCE_SAVED_GUNS, paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR], 'circle-stroke-width': 3 } });
  if (!map.getLayer(LAYER_SAVED_LABELS)) map.addLayer({ id: LAYER_SAVED_LABELS, type: 'symbol', source: SOURCE_SAVED_GUNS, filter: ['!=', ['get', 'label'], ''], layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#1e293b', 'text-halo-width': 1.5 } });
}

export default function FiringRangeOverlay() {
  const mapRef = useMapStore((s) => s.mapRef);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);
  const dataRef = useRef(null);

  const removeLayers = useCallback((map) => {
    for (const l of ALL_LAYERS) { if (map.getLayer(l)) map.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (map.getSource(s)) map.removeSource(s); }
  }, []);

  useEffect(() => {
    if (!mapRef) return;

    const hasData = visibleProjectIds.some(pid => projects[pid]?.firingRanges?.length > 0);

    if (!hasData) {
      removeLayers(mapRef);
      dataRef.current = null;
      return;
    }

    const data = buildSavedFiringRangeData(visibleProjectIds, projects, layerVisibility, itemVisibility);
    dataRef.current = data;

    const ensureSource = (id, d) => {
      const src = mapRef.getSource(id);
      if (src) { src.setData(d); } else { mapRef.addSource(id, { type: 'geojson', data: d }); }
    };
    ensureSource(SOURCE_SAVED, data.features);
    ensureSource(SOURCE_SAVED_GUNS, data.guns);

    addFiringRangeLayers(mapRef);

    const onStyleData = () => {
      const d = dataRef.current;
      if (!d) return;
      if (!mapRef.getSource(SOURCE_SAVED)) mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: d.features });
      if (!mapRef.getSource(SOURCE_SAVED_GUNS)) mapRef.addSource(SOURCE_SAVED_GUNS, { type: 'geojson', data: d.guns });
      addFiringRangeLayers(mapRef);
    };
    mapRef.on('styledata', onStyleData);
    return () => { mapRef.off('styledata', onStyleData); removeLayers(mapRef); };
  }, [mapRef, visibleProjectIds, projects, layerVisibility, itemVisibility, removeLayers]);

  return null;
}
