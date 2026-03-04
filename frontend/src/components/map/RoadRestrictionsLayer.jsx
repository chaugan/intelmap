import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const RESTRICTION_SOURCE = 'road-restrictions-data';
const LAYER_HEIGHT_LINES = 'road-restrictions-height-lines';
const LAYER_WEIGHT_LINES = 'road-restrictions-weight-lines';
const LAYER_HEIGHT_POINTS = 'road-restrictions-height-points';
const LAYER_WEIGHT_POINTS = 'road-restrictions-weight-points';

const LINE_LAYERS = [LAYER_HEIGHT_LINES, LAYER_WEIGHT_LINES];
const POINT_LAYERS = [LAYER_HEIGHT_POINTS, LAYER_WEIGHT_POINTS];
const ALL_LAYERS = [...LINE_LAYERS, ...POINT_LAYERS];

// Color gradients based on restriction severity
// Height: green (high clearance) -> yellow -> red (low clearance)
// Weight: green (high capacity) -> yellow -> red (low capacity)

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

    // Height restriction lines - gradient from green (high) to red (low)
    if (!mapRef.getLayer(LAYER_HEIGHT_LINES)) {
      mapRef.addLayer({
        id: LAYER_HEIGHT_LINES,
        type: 'line',
        source: RESTRICTION_SOURCE,
        filter: ['all',
          ['==', ['get', 'restrictionType'], 'height'],
          ['any',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['geometry-type'], 'MultiLineString'],
          ],
        ],
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'height'], 5],
            2.5, '#dc2626',  // Very low (red)
            3.5, '#f97316',  // Low (orange)
            4.5, '#eab308',  // Medium (yellow)
            6, '#22c55e',    // High (green)
          ],
          'line-width': 5,
          'line-opacity': opacity,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    }

    // Weight restriction lines - gradient from green (high) to red (low)
    if (!mapRef.getLayer(LAYER_WEIGHT_LINES)) {
      mapRef.addLayer({
        id: LAYER_WEIGHT_LINES,
        type: 'line',
        source: RESTRICTION_SOURCE,
        filter: ['all',
          ['==', ['get', 'restrictionType'], 'weight'],
          ['any',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['geometry-type'], 'MultiLineString'],
          ],
        ],
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'maxWeight'], 50],
            10, '#dc2626',   // Very low capacity (red)
            30, '#f97316',   // Low (orange)
            50, '#eab308',   // Medium (yellow)
            80, '#22c55e',   // High capacity (green)
          ],
          'line-width': 5,
          'line-opacity': opacity,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    }

    // Height restriction points (for Point geometries)
    if (!mapRef.getLayer(LAYER_HEIGHT_POINTS)) {
      mapRef.addLayer({
        id: LAYER_HEIGHT_POINTS,
        type: 'circle',
        source: RESTRICTION_SOURCE,
        filter: ['all',
          ['==', ['get', 'restrictionType'], 'height'],
          ['==', ['geometry-type'], 'Point'],
        ],
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'height'], 5],
            2.5, '#dc2626',
            3.5, '#f97316',
            4.5, '#eab308',
            6, '#22c55e',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // Weight restriction points (for Point geometries)
    if (!mapRef.getLayer(LAYER_WEIGHT_POINTS)) {
      mapRef.addLayer({
        id: LAYER_WEIGHT_POINTS,
        type: 'circle',
        source: RESTRICTION_SOURCE,
        filter: ['all',
          ['==', ['get', 'restrictionType'], 'weight'],
          ['==', ['geometry-type'], 'Point'],
        ],
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'maxWeight'], 50],
            10, '#dc2626',
            30, '#f97316',
            50, '#eab308',
            80, '#22c55e',
          ],
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
    LINE_LAYERS.forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.setPaintProperty(l, 'line-opacity', roadRestrictionsOpacity);
        }
      } catch {}
    });
    POINT_LAYERS.forEach((l) => {
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

    // Height lines filter
    try {
      if (mapRef.getLayer(LAYER_HEIGHT_LINES)) {
        const filter = showHeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'height'],
              ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
              ['<', ['coalesce', ['get', 'height'], 999], heightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__'];
        mapRef.setFilter(LAYER_HEIGHT_LINES, filter);
      }
    } catch (e) { console.error('Height line filter error:', e); }

    // Height points filter
    try {
      if (mapRef.getLayer(LAYER_HEIGHT_POINTS)) {
        const filter = showHeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'height'],
              ['==', ['geometry-type'], 'Point'],
              ['<', ['coalesce', ['get', 'height'], 999], heightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__'];
        mapRef.setFilter(LAYER_HEIGHT_POINTS, filter);
      }
    } catch (e) { console.error('Height point filter error:', e); }

    // Weight lines filter
    try {
      if (mapRef.getLayer(LAYER_WEIGHT_LINES)) {
        const filter = showWeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'weight'],
              ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
              ['<', ['coalesce', ['get', 'maxWeight'], 999], weightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__'];
        mapRef.setFilter(LAYER_WEIGHT_LINES, filter);
      }
    } catch (e) { console.error('Weight line filter error:', e); }

    // Weight points filter
    try {
      if (mapRef.getLayer(LAYER_WEIGHT_POINTS)) {
        const filter = showWeightLimits
          ? ['all',
              ['==', ['get', 'restrictionType'], 'weight'],
              ['==', ['geometry-type'], 'Point'],
              ['<', ['coalesce', ['get', 'maxWeight'], 999], weightFilterMax],
            ]
          : ['==', ['get', 'restrictionType'], '__hidden__'];
        mapRef.setFilter(LAYER_WEIGHT_POINTS, filter);
      }
    } catch (e) { console.error('Weight point filter error:', e); }
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

      const feature = features[0];
      const props = feature.properties;
      const geom = feature.geometry;

      // Get coordinates for popup placement
      let popupCoords;
      if (geom.type === 'Point') {
        popupCoords = geom.coordinates;
      } else if (geom.type === 'LineString') {
        // Use midpoint of line
        const midIdx = Math.floor(geom.coordinates.length / 2);
        popupCoords = geom.coordinates[midIdx];
      } else if (geom.type === 'MultiLineString') {
        // Use midpoint of first line
        const firstLine = geom.coordinates[0];
        const midIdx = Math.floor(firstLine.length / 2);
        popupCoords = firstLine[midIdx];
      } else {
        popupCoords = [e.lngLat.lng, e.lngLat.lat];
      }

      const isHeight = props.restrictionType === 'height';
      const lang = useMapStore.getState().lang;

      // Get color based on value
      let valueColor;
      if (isHeight) {
        const h = props.height || 5;
        if (h <= 3) valueColor = '#dc2626';
        else if (h <= 4) valueColor = '#f97316';
        else if (h <= 5) valueColor = '#eab308';
        else valueColor = '#22c55e';
      } else {
        const w = props.maxWeight || 50;
        if (w <= 20) valueColor = '#dc2626';
        else if (w <= 40) valueColor = '#f97316';
        else if (w <= 60) valueColor = '#eab308';
        else valueColor = '#22c55e';
      }

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:200px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${valueColor}">
            ${isHeight
              ? (lang === 'no' ? 'Høydebegrensning' : 'Height Restriction')
              : (lang === 'no' ? 'Vektbegrensning' : 'Weight Restriction')}
          </div>
          ${props.name ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Navn' : 'Name'}:</span> ${props.name}</div>` : ''}
          ${props.road ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Veg' : 'Road'}:</span> ${props.road}</div>` : ''}
          ${props.height != null ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks høyde' : 'Max height'}:</span> <strong style="color:${valueColor}">${props.height}m</strong></div>` : ''}
          ${props.heightType ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Type' : 'Type'}:</span> ${props.heightType}</div>` : ''}
          ${props.maxWeight != null ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks vekt' : 'Max weight'}:</span> <strong style="color:${valueColor}">${props.maxWeight}t</strong></div>` : ''}
          ${props.loadClass ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Bruksklasse' : 'Load class'}:</span> ${props.loadClass}</div>` : ''}
          ${props.maxVehicleLength ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Maks lengde' : 'Max length'}:</span> ${props.maxVehicleLength}m</div>` : ''}
          ${props.description ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Strekning' : 'Route'}:</span> ${props.description}</div>` : ''}
          ${props.municipality ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Kommune' : 'Municipality'}:</span> ${props.municipality}</div>` : ''}
          <div style="margin-top:6px;font-size:10px;color:#64748b">${lang === 'no' ? 'Kilde' : 'Source'}: NVDB</div>
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:300px;overflow:hidden">
          <div style="display:flex;justify-content:flex-end;padding:4px">
            <button class="popup-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;padding:2px 6px">×</button>
          </div>
          <div style="padding:0 12px 10px 12px">
            ${html}
          </div>
        </div>
      `;

      popupEl.querySelector('.popup-close-btn').addEventListener('click', () => removePopup());

      const point = mapRef.project(popupCoords);
      popupEl.style.left = `${point.x}px`;
      popupEl.style.top = `${point.y - 10}px`;
      popupEl.style.transform = 'translate(-50%, -100%)';

      mapRef.getContainer().appendChild(popupEl);
      popupRef.current = popupEl;

      const updatePos = () => {
        try {
          const p = mapRef.project(popupCoords);
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

// Legend component with gradient color indicators
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
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs min-w-[200px]">
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
          <div className="w-12 h-2 rounded" style={{ background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e)' }} />
          <span className="text-slate-300 text-[11px]">
            {lang === 'no' ? 'Vektgrenser' : 'Weight Limits'}
          </span>
        </button>
        {showWeightLimits && (
          <div className="ml-0 space-y-1">
            <div className="flex items-center justify-between text-[9px] text-slate-500 px-1">
              <span>10t</span>
              <span>30t</span>
              <span>50t</span>
              <span>80t+</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500">{lang === 'no' ? 'Vis under' : 'Show under'}:</span>
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
          </div>
        )}
      </div>

      {/* Height Limits Toggle + Filter */}
      <div className="space-y-1.5 border-t border-slate-700 pt-2">
        <button
          onClick={toggleHeightLimits}
          className={`flex items-center gap-1.5 w-full text-left transition-opacity cursor-pointer ${!showHeightLimits ? 'opacity-30' : ''}`}
        >
          <div className="w-12 h-2 rounded" style={{ background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e)' }} />
          <span className="text-slate-300 text-[11px]">
            {lang === 'no' ? 'Høydegrenser' : 'Height Limits'}
          </span>
        </button>
        {showHeightLimits && (
          <div className="ml-0 space-y-1">
            <div className="flex items-center justify-between text-[9px] text-slate-500 px-1">
              <span>2.5m</span>
              <span>3.5m</span>
              <span>4.5m</span>
              <span>6m+</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500">{lang === 'no' ? 'Vis under' : 'Show under'}:</span>
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
          </div>
        )}
      </div>
    </div>
  );
}
