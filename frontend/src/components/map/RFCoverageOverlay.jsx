/**
 * RFCoverageOverlay — always mounted, renders saved RF coverages on the map
 * regardless of whether the RFCoverageTool panel is open.
 * Composite display: overlapping coverages show the best (highest dBm) signal.
 */
import { useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';

const SOURCE_SAVED = 'rf-coverage-saved';
const SOURCE_SAVED_OBSERVERS = 'rf-coverage-saved-observers';
const LAYER_SAVED_FILL = 'rf-coverage-saved-fill';
const LAYER_SAVED_OBSERVERS = 'rf-coverage-saved-observers';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Smooth gradient color expression (handles both new signalStrength and old color props)
const FILL_COLOR_EXPR = [
  'case', ['has', 'signalStrength'],
  ['interpolate', ['linear'], ['get', 'signalStrength'],
    -95, '#991b1b', -90, '#dc2626', -85, '#ef4444', -80, '#f97316',
    -75, '#f59e0b', -70, '#eab308', -65, '#84cc16', -60, '#4ade80',
    -55, '#22c55e', -50, '#15803d'],
  ['get', 'color'],
];

function buildCompositeRFData(visibleProjectIds, projects, layerVisibility, itemVisibility) {
  const allFeatures = [];
  const observers = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.rfCoverages) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const c of proj.rfCoverages) {
      if (c.layerId && !visLayerIds.has(c.layerId)) continue;
      if (itemVisibility[c.id] === false) continue;
      if (c.geojson?.features) {
        for (const f of c.geojson.features) {
          allFeatures.push({ ...f, properties: { ...f.properties, id: c.id, projectId: pid } });
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
  // Sort by signalStrength ascending (weakest first) so strongest paints on top
  allFeatures.sort((a, b) => (a.properties.signalStrength || -999) - (b.properties.signalStrength || -999));
  return {
    polygons: { type: 'FeatureCollection', features: allFeatures },
    observers: { type: 'FeatureCollection', features: observers },
  };
}

const ALL_LAYERS = [LAYER_SAVED_FILL, LAYER_SAVED_OBSERVERS];
const ALL_SOURCES = [SOURCE_SAVED, SOURCE_SAVED_OBSERVERS];

const FILL_PAINT = { 'fill-color': FILL_COLOR_EXPR, 'fill-opacity': 0.4 };
const OBSERVER_PAINT = { 'circle-radius': 6, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 };

export default function RFCoverageOverlay() {
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

    const addLayersIfMissing = (pData, oData) => {
      if (!mapRef.getSource(SOURCE_SAVED)) mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: pData });
      if (!mapRef.getSource(SOURCE_SAVED_OBSERVERS)) mapRef.addSource(SOURCE_SAVED_OBSERVERS, { type: 'geojson', data: oData });
      if (!mapRef.getLayer(LAYER_SAVED_FILL)) mapRef.addLayer({ id: LAYER_SAVED_FILL, type: 'fill', source: SOURCE_SAVED, paint: FILL_PAINT });
      if (!mapRef.getLayer(LAYER_SAVED_OBSERVERS)) mapRef.addLayer({ id: LAYER_SAVED_OBSERVERS, type: 'circle', source: SOURCE_SAVED_OBSERVERS, paint: OBSERVER_PAINT });
    };

    const hasData = visibleProjectIds.some(pid => projects[pid]?.rfCoverages?.length > 0);

    if (!hasData) {
      removeLayers();
      dataRef.current = null;
      return;
    }

    const data = buildCompositeRFData(visibleProjectIds, projects, layerVisibility, itemVisibility);
    dataRef.current = data;

    // Ensure sources exist, then update data
    const srcP = mapRef.getSource(SOURCE_SAVED);
    if (srcP) { srcP.setData(data.polygons); } else { addLayersIfMissing(data.polygons, data.observers); }
    const srcO = mapRef.getSource(SOURCE_SAVED_OBSERVERS);
    if (srcO) { srcO.setData(data.observers); }

    // Re-add after base map style changes
    const onStyleData = () => {
      const d = dataRef.current;
      if (!d) return;
      addLayersIfMissing(d.polygons, d.observers);
    };
    mapRef.on('styledata', onStyleData);
    return () => { mapRef.off('styledata', onStyleData); removeLayers(); };
  }, [mapRef, visibleProjectIds, projects, layerVisibility, itemVisibility]);

  return null;
}
