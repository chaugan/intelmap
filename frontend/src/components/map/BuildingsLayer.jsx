import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const OFM_SOURCE = 'ofm-buildings';
const OFM_EXTRUSION_LAYER = 'ofm-buildings-3d';
const OFM_QUERY_LAYER = 'ofm-buildings-query';
const BUILDING_MIN_ZOOM = 15;

export { OFM_SOURCE, OFM_QUERY_LAYER, BUILDING_MIN_ZOOM };

export default function BuildingsLayer() {
  const mapRef = useMapStore((s) => s.mapRef);
  const buildingOpacity = useMapStore((s) => s.buildingOpacity);
  const setBuildingOpacity = useMapStore((s) => s.setBuildingOpacity);
  const lang = useMapStore((s) => s.lang);
  const activeRef = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    const addSource = () => {
      if (map.getSource(OFM_SOURCE)) return;
      map.addSource(OFM_SOURCE, {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      });
    };

    const addLayers = () => {
      if (!map.getSource(OFM_SOURCE)) return;

      // Invisible fill layer for querySourceFeatures (used by SunlightOverlay)
      if (!map.getLayer(OFM_QUERY_LAYER)) {
        map.addLayer({
          id: OFM_QUERY_LAYER,
          type: 'fill',
          source: OFM_SOURCE,
          'source-layer': 'building',
          paint: { 'fill-opacity': 0 },
        });
      }

      // 3D extruded buildings
      if (!map.getLayer(OFM_EXTRUSION_LAYER)) {
        map.addLayer({
          id: OFM_EXTRUSION_LAYER,
          type: 'fill-extrusion',
          source: OFM_SOURCE,
          'source-layer': 'building',
          minzoom: BUILDING_MIN_ZOOM,
          paint: {
            'fill-extrusion-color': '#d4c8b8',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': buildingOpacity,
          },
        });
      }
    };

    const removeLayers = () => {
      try { if (map.getLayer(OFM_EXTRUSION_LAYER)) map.removeLayer(OFM_EXTRUSION_LAYER); } catch {}
      try { if (map.getLayer(OFM_QUERY_LAYER)) map.removeLayer(OFM_QUERY_LAYER); } catch {}
    };

    const removeAll = () => {
      removeLayers();
      try { if (map.getSource(OFM_SOURCE)) map.removeSource(OFM_SOURCE); } catch {}
      activeRef.current = false;
      setVisible(false);
    };

    const checkZoom = () => {
      const z = map.getZoom();
      if (z >= BUILDING_MIN_ZOOM) {
        if (!activeRef.current) {
          addSource();
          addLayers();
          activeRef.current = true;
          setVisible(true);
        }
      } else {
        if (activeRef.current) {
          removeAll();
        }
      }
    };

    const onStyleData = () => {
      // Style swap wipes custom sources/layers — re-add if zoom qualifies
      if (map.getZoom() >= BUILDING_MIN_ZOOM) {
        activeRef.current = false;
        addSource();
        addLayers();
        activeRef.current = true;
        setVisible(true);
      }
    };

    checkZoom();

    map.on('zoomend', checkZoom);
    map.on('styledata', onStyleData);

    return () => {
      map.off('zoomend', checkZoom);
      map.off('styledata', onStyleData);
      removeAll();
    };
  }, [mapRef]);

  // Update extrusion opacity when slider changes
  useEffect(() => {
    const map = mapRef;
    if (!map || !map.getLayer(OFM_EXTRUSION_LAYER)) return;
    map.setPaintProperty(OFM_EXTRUSION_LAYER, 'fill-extrusion-opacity', buildingOpacity);
  }, [mapRef, buildingOpacity]);

  if (!visible) return null;

  return (
    <div className="absolute top-14 left-2 z-[5] bg-slate-800/90 rounded px-2.5 py-1.5 flex items-center gap-2 shadow-lg">
      <span className="text-[10px] text-slate-300 whitespace-nowrap">
        {t('buildings', lang)}
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(buildingOpacity * 100)}
        onChange={(e) => setBuildingOpacity(parseInt(e.target.value) / 100)}
        className="w-20 h-1 accent-amber-500"
      />
      <span className="text-[10px] text-white font-mono w-7 text-right">
        {Math.round(buildingOpacity * 100)}%
      </span>
    </div>
  );
}
