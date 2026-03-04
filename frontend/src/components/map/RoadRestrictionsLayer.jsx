import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/useMapStore.js';

const RESTRICTION_SOURCE = 'road-restrictions-data';
const LAYER_HEIGHT_POINTS = 'road-restrictions-height-points';
const LAYER_WEIGHT_POINTS = 'road-restrictions-weight-points';

const ALL_LAYERS = [LAYER_HEIGHT_POINTS, LAYER_WEIGHT_POINTS];

export default function RoadRestrictionsLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const dataRef = useRef(data);
  const [ready, setReady] = useState(false);
  const roadRestrictionsOpacity = useMapStore((s) => s.roadRestrictionsOpacity);
  const showWeightLimits = useMapStore((s) => s.showWeightLimits);
  const showHeightLimits = useMapStore((s) => s.showHeightLimits);
  const weightFilterMax = useMapStore((s) => s.weightFilterMax);
  const heightFilterMax = useMapStore((s) => s.heightFilterMax);

  useEffect(() => { dataRef.current = data; }, [data]);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, []);

  const addLayers = useCallback((opacity) => {
    if (!mapRef) return;

    if (!mapRef.getSource(RESTRICTION_SOURCE)) {
      mapRef.addSource(RESTRICTION_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // Height restriction points (red circles)
    if (!mapRef.getLayer(LAYER_HEIGHT_POINTS)) {
      mapRef.addLayer({
        id: LAYER_HEIGHT_POINTS,
        type: 'circle',
        source: RESTRICTION_SOURCE,
        filter: ['==', ['get', 'restrictionType'], 'height'],
        paint: {
          'circle-radius': 10,
          'circle-color': '#dc2626',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // Weight restriction points (orange circles)
    if (!mapRef.getLayer(LAYER_WEIGHT_POINTS)) {
      mapRef.addLayer({
        id: LAYER_WEIGHT_POINTS,
        type: 'circle',
        source: RESTRICTION_SOURCE,
        filter: ['==', ['get', 'restrictionType'], 'weight'],
        paint: {
          'circle-radius': [
            'case',
            ['<', ['coalesce', ['get', 'maxWeight'], 100], 10], 14,
            ['<', ['coalesce', ['get', 'maxWeight'], 100], 20], 12,
            ['<', ['coalesce', ['get', 'maxWeight'], 100], 50], 10,
            8,
          ],
          'circle-color': '#f97316',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      });
    }
  }, [mapRef]);

  // Setup layers and handle style swaps
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const setup = () => {
      try {
        addLayers(roadRestrictionsOpacity);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('RoadRestrictionsLayer setup error:', err);
      }
    };

    const onStyleData = () => {
      if (!mapRef.getSource(RESTRICTION_SOURCE)) {
        addLayers(roadRestrictionsOpacity);
        if (dataRef.current) {
          const src = mapRef.getSource(RESTRICTION_SOURCE);
          if (src) src.setData(dataRef.current);
        }
      }
    };

    mapRef.on('styledata', onStyleData);
    setup();

    return () => {
      cancelled = true;
      mapRef.off('styledata', onStyleData);
      removePopup();
      ALL_LAYERS.forEach((l) => { try { if (mapRef.getLayer(l)) mapRef.removeLayer(l); } catch {} });
      try { if (mapRef.getSource(RESTRICTION_SOURCE)) mapRef.removeSource(RESTRICTION_SOURCE); } catch {}
      setReady(false);
    };
  }, [mapRef, removePopup, addLayers, roadRestrictionsOpacity]);

  // Update data source when data changes
  useEffect(() => {
    if (!mapRef || !ready) return;
    const src = mapRef.getSource(RESTRICTION_SOURCE);
    if (src) {
      src.setData(data || { type: 'FeatureCollection', features: [] });
    }
  }, [mapRef, data, ready]);

  // Update opacity
  useEffect(() => {
    if (!mapRef) return;
    ALL_LAYERS.forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.setPaintProperty(l, 'circle-opacity', roadRestrictionsOpacity);
          mapRef.setPaintProperty(l, 'circle-stroke-opacity', roadRestrictionsOpacity);
        }
      } catch {}
    });
  }, [mapRef, roadRestrictionsOpacity]);

  // Update filters based on visibility and filter values
  useEffect(() => {
    if (!mapRef) return;

    // Height points filter
    try {
      if (mapRef.getLayer(LAYER_HEIGHT_POINTS)) {
        const filter = showHeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'height'],
              ['<', ['coalesce', ['get', 'height'], 999], heightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__']; // Never matches
        mapRef.setFilter(LAYER_HEIGHT_POINTS, filter);
      }
    } catch (e) { console.error('Height filter error:', e); }

    // Weight points filter
    try {
      if (mapRef.getLayer(LAYER_WEIGHT_POINTS)) {
        const filter = showWeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'weight'],
              ['<', ['coalesce', ['get', 'maxWeight'], 999], weightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__']; // Never matches
        mapRef.setFilter(LAYER_WEIGHT_POINTS, filter);
      }
    } catch (e) { console.error('Weight filter error:', e); }
  }, [mapRef, showWeightLimits, showHeightLimits, weightFilterMax, heightFilterMax]);

  // Click handler for popups
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      const activeLayers = ALL_LAYERS.filter((l) => {
        try { return !!mapRef.getLayer(l); } catch { return false; }
      });
      if (activeLayers.length === 0) return;

      const features = mapRef.queryRenderedFeatures(e.point, { layers: activeLayers });

      removePopup();
      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();

      const isHeight = props.restrictionType === 'height';
      const lang = useMapStore.getState().lang;

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:180px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${isHeight ? '#dc2626' : '#f97316'}">
            ${isHeight
              ? (lang === 'no' ? 'Hoydebegrensning' : 'Height Restriction')
              : (lang === 'no' ? 'Vektbegrensning' : 'Weight Restriction')}
          </div>
          ${props.name ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Navn' : 'Name'}:</span> ${props.name}</div>` : ''}
          ${props.road ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Veg' : 'Road'}:</span> ${props.road}</div>` : ''}
          ${props.height != null ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks hoyde' : 'Max height'}:</span> <strong>${props.height}m</strong></div>` : ''}
          ${props.heightType ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Type' : 'Type'}:</span> ${props.heightType}</div>` : ''}
          ${props.maxWeight != null ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks vekt' : 'Max weight'}:</span> <strong>${props.maxWeight}t</strong></div>` : ''}
          ${props.loadClass ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Bruksklasse' : 'Load class'}:</span> ${props.loadClass}</div>` : ''}
          ${props.maxAxleLoad != null ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks aksellast' : 'Max axle load'}:</span> ${props.maxAxleLoad}t</div>` : ''}
          ${props.municipality ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Kommune' : 'Municipality'}:</span> ${props.municipality}</div>` : ''}
          <div style="margin-top:6px;font-size:10px;color:#64748b">${lang === 'no' ? 'Kilde' : 'Source'}: NVDB</div>
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:280px;overflow:hidden">
          <div style="display:flex;justify-content:flex-end;padding:4px">
            <button class="popup-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;padding:2px 6px">×</button>
          </div>
          <div style="padding:0 12px 10px 12px">
            ${html}
          </div>
        </div>
      `;

      popupEl.querySelector('.popup-close-btn').addEventListener('click', () => removePopup());

      const point = mapRef.project(coords);
      popupEl.style.left = `${point.x}px`;
      popupEl.style.top = `${point.y - 10}px`;
      popupEl.style.transform = 'translate(-50%, -100%)';

      mapRef.getContainer().appendChild(popupEl);
      popupRef.current = popupEl;

      const updatePos = () => {
        try {
          const p = mapRef.project(coords);
          popupEl.style.left = `${p.x}px`;
          popupEl.style.top = `${p.y - 10}px`;
        } catch {}
      };
      mapRef.on('move', updatePos);
      popupEl._cleanup = () => mapRef.off('move', updatePos);

      // Hover effect on close button
      const closeBtn = popupEl.querySelector('.popup-close-btn');
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#475569'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none'; });
    };

    mapRef.on('click', handleClick);

    const onEnter = () => { mapRef.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { mapRef.getCanvas().style.cursor = ''; };
    ALL_LAYERS.forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.on('mouseenter', l, onEnter);
          mapRef.on('mouseleave', l, onLeave);
        }
      } catch {}
    });

    return () => {
      mapRef.off('click', handleClick);
      ALL_LAYERS.forEach((l) => {
        try {
          mapRef.off('mouseenter', l, onEnter);
          mapRef.off('mouseleave', l, onLeave);
        } catch {}
      });
      removePopup();
    };
  }, [mapRef, removePopup]);

  return null;
}

// Legend component
export function RoadRestrictionsLegend({ count }) {
  const lang = useMapStore((s) => s.lang);
  const showWeightLimits = useMapStore((s) => s.showWeightLimits);
  const showHeightLimits = useMapStore((s) => s.showHeightLimits);
  const toggleWeightLimits = useMapStore((s) => s.toggleWeightLimits);
  const toggleHeightLimits = useMapStore((s) => s.toggleHeightLimits);
  const weightFilterMax = useMapStore((s) => s.weightFilterMax);
  const heightFilterMax = useMapStore((s) => s.heightFilterMax);
  const setWeightFilterMax = useMapStore((s) => s.setWeightFilterMax);
  const setHeightFilterMax = useMapStore((s) => s.setHeightFilterMax);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs min-w-[180px]">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {lang === 'no' ? 'Vegrestriksjoner' : 'Road Restrictions'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>

      {/* Weight Limits Toggle + Filter */}
      <div className="space-y-1.5 mb-2">
        <button
          onClick={toggleWeightLimits}
          className={`flex items-center gap-1.5 w-full text-left transition-opacity cursor-pointer ${!showWeightLimits ? 'opacity-30' : ''}`}
        >
          <div className="w-4 h-4 rounded-full bg-orange-500 border-2 border-white flex-shrink-0" />
          <span className="text-slate-300 text-[11px]">
            {lang === 'no' ? 'Vektgrenser' : 'Weight Limits'}
          </span>
        </button>
        {showWeightLimits && (
          <div className="ml-5 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500 w-14">{lang === 'no' ? 'Maks vekt' : 'Max weight'}:</span>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={weightFilterMax}
                onChange={(e) => setWeightFilterMax(parseInt(e.target.value))}
                className="flex-1 h-1 accent-orange-500"
              />
              <span className="text-[10px] text-orange-400 w-8 text-right">{weightFilterMax}t</span>
            </div>
            <div className="text-[9px] text-slate-500">
              {lang === 'no' ? `Viser broer under ${weightFilterMax}t` : `Showing bridges under ${weightFilterMax}t`}
            </div>
          </div>
        )}
      </div>

      {/* Height Limits Toggle + Filter */}
      <div className="space-y-1.5 border-t border-slate-700 pt-2">
        <button
          onClick={toggleHeightLimits}
          className={`flex items-center gap-1.5 w-full text-left transition-opacity cursor-pointer ${!showHeightLimits ? 'opacity-30' : ''}`}
        >
          <div className="w-4 h-4 rounded-full bg-red-600 border-2 border-white flex-shrink-0" />
          <span className="text-slate-300 text-[11px]">
            {lang === 'no' ? 'Hoydegrenser' : 'Height Limits'}
          </span>
        </button>
        {showHeightLimits && (
          <div className="ml-5 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500 w-14">{lang === 'no' ? 'Maks hoyde' : 'Max height'}:</span>
              <input
                type="range"
                min="2"
                max="10"
                step="0.5"
                value={heightFilterMax}
                onChange={(e) => setHeightFilterMax(parseFloat(e.target.value))}
                className="flex-1 h-1 accent-red-500"
              />
              <span className="text-[10px] text-red-400 w-8 text-right">{heightFilterMax}m</span>
            </div>
            <div className="text-[9px] text-slate-500">
              {lang === 'no' ? `Viser under ${heightFilterMax}m` : `Showing under ${heightFilterMax}m`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
