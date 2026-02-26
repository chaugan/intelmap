import { useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const HILLSHADE_LAYER = 'dem-hillshade';

export default function TerrainLayer() {
  const mapRef = useMapStore((s) => s.mapRef);
  const hillshadeVisible = useMapStore((s) => s.hillshadeVisible);
  const hillshadeOpacity = useMapStore((s) => s.hillshadeOpacity);
  const terrainVisible = useMapStore((s) => s.terrainVisible);
  const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);

  // Hillshade layer add/remove
  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    const addHillshade = () => {
      if (map.getLayer(HILLSHADE_LAYER)) return;
      // Insert above base-tiles but below everything else
      const layers = map.getStyle().layers;
      let beforeId = null;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].id === 'base-tiles' && i + 1 < layers.length) {
          beforeId = layers[i + 1].id;
          break;
        }
      }
      const currentOpacity = useMapStore.getState().hillshadeOpacity;
      map.addLayer({
        id: HILLSHADE_LAYER,
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': currentOpacity,
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-illumination-direction': 315,
        },
      }, beforeId || undefined);
    };

    const removeHillshade = () => {
      try { if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER); } catch {}
    };

    // Only re-add on styledata if the layer was wiped (style swap), not from our own changes
    const onStyleData = () => {
      if (useMapStore.getState().hillshadeVisible && !map.getLayer(HILLSHADE_LAYER)) {
        addHillshade();
      }
    };

    if (hillshadeVisible) {
      addHillshade();
    } else {
      removeHillshade();
    }

    map.on('styledata', onStyleData);
    return () => {
      map.off('styledata', onStyleData);
      removeHillshade();
    };
  }, [mapRef, hillshadeVisible]);

  // Hillshade opacity
  useEffect(() => {
    const map = mapRef;
    if (!map || !map.getLayer(HILLSHADE_LAYER)) return;
    map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-exaggeration', hillshadeOpacity);
  }, [mapRef, hillshadeOpacity]);

  // 3D terrain toggle
  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    if (terrainVisible) {
      map.setTerrain({ source: 'dem', exaggeration: useMapStore.getState().terrainExaggeration });
    } else {
      map.setTerrain(null);
    }

    // Only re-apply on styledata if terrain was wiped (style swap)
    const onStyleData = () => {
      if (useMapStore.getState().terrainVisible && !map.getTerrain()) {
        map.setTerrain({ source: 'dem', exaggeration: useMapStore.getState().terrainExaggeration });
      }
    };

    map.on('styledata', onStyleData);
    return () => {
      map.off('styledata', onStyleData);
      map.setTerrain(null);
    };
  }, [mapRef, terrainVisible]);

  // Terrain exaggeration
  useEffect(() => {
    const map = mapRef;
    if (!map || !terrainVisible) return;
    map.setTerrain({ source: 'dem', exaggeration: terrainExaggeration });
  }, [mapRef, terrainExaggeration, terrainVisible]);

  return null;
}
