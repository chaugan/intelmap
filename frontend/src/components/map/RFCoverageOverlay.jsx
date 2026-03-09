/**
 * RFCoverageOverlay — always mounted, renders saved RF coverages on the map
 * regardless of whether the RFCoverageTool panel is open.
 * Composite display: overlapping coverages show the best (highest dBm) signal.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';

const SOURCE_SAVED = 'rf-coverage-saved';
const SOURCE_SAVED_OBSERVERS = 'rf-coverage-saved-observers';
const LAYER_SAVED_FILL = 'rf-coverage-saved-fill';
const LAYER_SAVED_OBSERVERS = 'rf-coverage-saved-observers';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Bucket strength ordering for composite display (weakest first so strongest paints on top)
const BUCKET_STRENGTH = {
  noCoverage: 0, veryWeak: 1, weak: 2, marginal: 3, belowAvg: 4,
  average: 5, aboveAvg: 6, good: 7, veryGood: 8, excellent: 9,
};

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
  // Sort features: weakest first, strongest last → strongest paints on top
  allFeatures.sort((a, b) => (BUCKET_STRENGTH[a.properties.bucket] || 0) - (BUCKET_STRENGTH[b.properties.bucket] || 0));
  return {
    polygons: { type: 'FeatureCollection', features: allFeatures },
    observers: { type: 'FeatureCollection', features: observers },
  };
}

const ALL_LAYERS = [LAYER_SAVED_FILL, LAYER_SAVED_OBSERVERS];
const ALL_SOURCES = [SOURCE_SAVED, SOURCE_SAVED_OBSERVERS];

export default function RFCoverageOverlay() {
  const mapRef = useMapStore((s) => s.mapRef);
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const itemVisibility = useTacticalStore((s) => s.itemVisibility);
  const dataRef = useRef(null);

  const cleanup = useCallback(() => {
    if (!mapRef) return;
    for (const l of ALL_LAYERS) { if (mapRef.getLayer(l)) mapRef.removeLayer(l); }
    for (const s of ALL_SOURCES) { if (mapRef.getSource(s)) mapRef.removeSource(s); }
  }, [mapRef]);

  const hasData = visibleProjectIds.some(pid => {
    const proj = projects[pid];
    return proj?.rfCoverages?.length > 0;
  });

  useEffect(() => {
    if (!mapRef || !hasData) {
      if (mapRef) cleanup();
      return;
    }

    const initLayers = () => {
      const saved = dataRef.current || buildCompositeRFData(visibleProjectIds, projects, layerVisibility, itemVisibility);

      if (!mapRef.getSource(SOURCE_SAVED)) mapRef.addSource(SOURCE_SAVED, { type: 'geojson', data: saved.polygons });
      if (!mapRef.getSource(SOURCE_SAVED_OBSERVERS)) mapRef.addSource(SOURCE_SAVED_OBSERVERS, { type: 'geojson', data: saved.observers });

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
    };

    initLayers();
    mapRef.on('styledata', initLayers);
    return () => { mapRef.off('styledata', initLayers); cleanup(); };
  }, [mapRef, hasData, cleanup]);

  // Update data when projects/visibility change
  useEffect(() => {
    if (!mapRef || !hasData) return;
    const saved = buildCompositeRFData(visibleProjectIds, projects, layerVisibility, itemVisibility);
    dataRef.current = saved;
    const src = mapRef.getSource(SOURCE_SAVED);
    if (src) src.setData(saved.polygons);
    const obsSrc = mapRef.getSource(SOURCE_SAVED_OBSERVERS);
    if (obsSrc) obsSrc.setData(saved.observers);
  }, [mapRef, hasData, visibleProjectIds, projects, layerVisibility, itemVisibility]);

  return null;
}
