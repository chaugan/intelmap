/**
 * RFCoverageOverlay — always mounted, renders saved RF coverages AND
 * session (unsaved) coverages on the map.
 */
import { useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';

const SOURCE_SAVED = 'rf-coverage-saved';
const SOURCE_SAVED_OBSERVERS = 'rf-coverage-saved-observers';
const LAYER_SAVED_FILL = 'rf-coverage-saved-fill';
const LAYER_SAVED_OBSERVERS = 'rf-coverage-saved-observers';
const LAYER_SAVED_LABELS = 'rf-coverage-saved-labels';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const FILL_COLOR_EXPR = [
  'case', ['has', 'signalStrength'],
  ['interpolate', ['linear'], ['get', 'signalStrength'],
    -95, '#991b1b', -90, '#dc2626', -85, '#ef4444', -80, '#f97316',
    -75, '#f59e0b', -70, '#eab308', -65, '#84cc16', -60, '#4ade80',
    -55, '#22c55e', -50, '#15803d'],
  ['get', 'color'],
];

function buildCompositeData(visibleProjectIds, projects, layerVisibility, itemVisibility, sessionCoverages) {
  const allFeatures = [];
  const observers = [];

  // Project-saved coverages
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj?.rfCoverages) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => {
        if (layerVisibility[l.id] === false) return false;
        if (l.parentId) return layerVisibility[l.parentId] !== false;
        return true;
      }).map(l => l.id)
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
        const heightLabel = c.antennaHeight === 1.5 ? '1.5m' : c.antennaHeight === 3 ? '3m' : c.antennaHeight === 10 ? '10m' : `${c.antennaHeight}m`;
        const label = `${heightLabel} | ${c.txPowerWatts}W | ${c.frequencyMHz}MHz`;
        observers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
          properties: { id: c.id, projectId: pid, showLabel: c.showLabel ? 1 : 0, label },
        });
      }
    }
  }

  // Session (unsaved) coverages
  for (const c of sessionCoverages) {
    if (itemVisibility[c.id] === false) continue;
    if (c.geojson?.features) {
      for (const f of c.geojson.features) {
        allFeatures.push({ ...f, properties: { ...f.properties, id: c.id, session: true } });
      }
    }
    if (c.longitude != null && c.latitude != null) {
      const heightLabel = c.antennaHeight === 1.5 ? '1.5m' : c.antennaHeight === 3 ? '3m' : c.antennaHeight === 10 ? '10m' : `${c.antennaHeight}m`;
      const label = `${heightLabel} | ${c.txPowerWatts}W | ${c.frequencyMHz}MHz`;
      observers.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
        properties: { id: c.id, session: true, showLabel: c.showLabel ? 1 : 0, label },
      });
    }
  }

  allFeatures.sort((a, b) => (a.properties.signalStrength || -999) - (b.properties.signalStrength || -999));
  return {
    polygons: { type: 'FeatureCollection', features: allFeatures },
    observers: { type: 'FeatureCollection', features: observers },
  };
}

const ALL_LAYERS = [LAYER_SAVED_FILL, LAYER_SAVED_OBSERVERS, LAYER_SAVED_LABELS];
const ALL_SOURCES = [SOURCE_SAVED, SOURCE_SAVED_OBSERVERS];

const FILL_PAINT = { 'fill-color': FILL_COLOR_EXPR, 'fill-opacity': 0.4 };
const OBSERVER_PAINT = { 'circle-radius': 6, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 };

export default function RFCoverageOverlay() {
  const mapRef = useMapStore((s) => s.mapRef);
  const activeRFCoverageId = useMapStore((s) => s.activeRFCoverageId);
  const sessionRFCoverages = useMapStore((s) => s.sessionRFCoverages);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);
  const dataRef = useRef(null);

  // Build and render overlay data (saved + session coverages)
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
      if (!mapRef.getLayer(LAYER_SAVED_LABELS)) {
        mapRef.addLayer({
          id: LAYER_SAVED_LABELS,
          type: 'symbol',
          source: SOURCE_SAVED_OBSERVERS,
          filter: ['==', ['get', 'showLabel'], 1],
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 14,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#e2e8f0',
            'text-halo-color': 'rgba(15,23,42,0.85)',
            'text-halo-width': 1.5,
          },
        });
      }
    };

    const hasSaved = visibleProjectIds.some(pid => projects[pid]?.rfCoverages?.length > 0);
    const hasData = hasSaved || sessionRFCoverages.length > 0;

    if (!hasData) {
      removeLayers();
      dataRef.current = null;
      return;
    }

    const data = buildCompositeData(visibleProjectIds, projects, layerVisibility, itemVisibility, sessionRFCoverages);
    dataRef.current = data;

    const srcP = mapRef.getSource(SOURCE_SAVED);
    if (srcP) { srcP.setData(data.polygons); } else { addLayersIfMissing(data.polygons, data.observers); }
    const srcO = mapRef.getSource(SOURCE_SAVED_OBSERVERS);
    if (srcO) { srcO.setData(data.observers); }

    // Re-apply filter for active item
    const filter = activeRFCoverageId ? ['!=', ['get', 'id'], activeRFCoverageId] : null;
    if (mapRef.getLayer(LAYER_SAVED_FILL)) mapRef.setFilter(LAYER_SAVED_FILL, filter);
    if (mapRef.getLayer(LAYER_SAVED_OBSERVERS)) mapRef.setFilter(LAYER_SAVED_OBSERVERS, filter);
    if (mapRef.getLayer(LAYER_SAVED_LABELS)) {
      // Labels: must show label AND not be the active item
      const labelFilter = activeRFCoverageId
        ? ['all', ['==', ['get', 'showLabel'], 1], ['!=', ['get', 'id'], activeRFCoverageId]]
        : ['==', ['get', 'showLabel'], 1];
      mapRef.setFilter(LAYER_SAVED_LABELS, labelFilter);
    }

    const onStyleData = () => {
      const d = dataRef.current;
      if (!d) return;
      addLayersIfMissing(d.polygons, d.observers);
      const f = useMapStore.getState().activeRFCoverageId;
      if (f) {
        if (mapRef.getLayer(LAYER_SAVED_FILL)) mapRef.setFilter(LAYER_SAVED_FILL, ['!=', ['get', 'id'], f]);
        if (mapRef.getLayer(LAYER_SAVED_OBSERVERS)) mapRef.setFilter(LAYER_SAVED_OBSERVERS, ['!=', ['get', 'id'], f]);
        if (mapRef.getLayer(LAYER_SAVED_LABELS)) mapRef.setFilter(LAYER_SAVED_LABELS, ['all', ['==', ['get', 'showLabel'], 1], ['!=', ['get', 'id'], f]]);
      }
    };
    mapRef.on('styledata', onStyleData);
    return () => { mapRef.off('styledata', onStyleData); removeLayers(); };
  }, [mapRef, visibleProjectIds, projects, layerVisibility, itemVisibility, sessionRFCoverages, activeRFCoverageId]);

  return null;
}
