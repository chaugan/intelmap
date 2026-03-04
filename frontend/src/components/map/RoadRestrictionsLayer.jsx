import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import DraggablePopup from './DraggablePopup.jsx';

const RESTRICTION_SOURCE = 'road-restrictions-data';
const LAYER_HEIGHT_LINES = 'road-restrictions-height-lines';
const LAYER_WEIGHT_LINES = 'road-restrictions-weight-lines';
const LAYER_HEIGHT_POINTS = 'road-restrictions-height-points';
const LAYER_WEIGHT_POINTS = 'road-restrictions-weight-points';

const LINE_LAYERS = [LAYER_HEIGHT_LINES, LAYER_WEIGHT_LINES];
const POINT_LAYERS = [LAYER_HEIGHT_POINTS, LAYER_WEIGHT_POINTS];
const ALL_LAYERS = [...LINE_LAYERS, ...POINT_LAYERS];

// Discrete color buckets for restrictions
// Height: purple/blue scheme (dark purple = very low, cyan = high)
const HEIGHT_COLORS = [
  { threshold: 3, color: '#7c3aed' },    // <3m: violet
  { threshold: 3.5, color: '#8b5cf6' },  // 3-3.5m: purple
  { threshold: 4, color: '#3b82f6' },    // 3.5-4m: blue
  { threshold: 4.5, color: '#0ea5e9' },  // 4-4.5m: sky
  { threshold: 999, color: '#06b6d4' },  // >4.5m: cyan
];

// Weight: orange/red scheme (dark red = very low, yellow = high)
const WEIGHT_COLORS = [
  { threshold: 20, color: '#b91c1c' },   // <20t: dark red
  { threshold: 30, color: '#dc2626' },   // 20-30t: red
  { threshold: 40, color: '#ea580c' },   // 30-40t: orange
  { threshold: 60, color: '#f59e0b' },   // 40-60t: amber
  { threshold: 999, color: '#fbbf24' },  // >60t: yellow
];

// MapLibre step expression for height colors
const HEIGHT_COLOR_EXPR = [
  'step', ['coalesce', ['get', 'height'], 5],
  HEIGHT_COLORS[0].color,
  3, HEIGHT_COLORS[1].color,
  3.5, HEIGHT_COLORS[2].color,
  4, HEIGHT_COLORS[3].color,
  4.5, HEIGHT_COLORS[4].color,
];

// MapLibre step expression for weight colors
const WEIGHT_COLOR_EXPR = [
  'step', ['coalesce', ['get', 'maxWeight'], 50],
  WEIGHT_COLORS[0].color,
  20, WEIGHT_COLORS[1].color,
  30, WEIGHT_COLORS[2].color,
  40, WEIGHT_COLORS[3].color,
  60, WEIGHT_COLORS[4].color,
];

export default function RoadRestrictionsLayer({ data, mapRef }) {
  const dataRef = useRef(data);
  const [ready, setReady] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const roadRestrictionsOpacity = useMapStore((s) => s.roadRestrictionsOpacity);
  const showWeightLimits = useMapStore((s) => s.showWeightLimits);
  const showHeightLimits = useMapStore((s) => s.showHeightLimits);
  const weightFilterMax = useMapStore((s) => s.weightFilterMax);
  const heightFilterMax = useMapStore((s) => s.heightFilterMax);
  const lang = useMapStore((s) => s.lang);

  useEffect(() => { dataRef.current = data; }, [data]);

  const addLayers = useCallback((opacity) => {
    if (!mapRef) return;

    if (!mapRef.getSource(RESTRICTION_SOURCE)) {
      mapRef.addSource(RESTRICTION_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // Weight restriction lines - orange/red buckets (solid, drawn first/below)
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
          'line-color': WEIGHT_COLOR_EXPR,
          'line-width': 5,
          'line-opacity': opacity,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    }

    // Height restriction lines - purple/blue buckets (dashed, drawn on top)
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
          'line-color': HEIGHT_COLOR_EXPR,
          'line-width': 4,
          'line-opacity': opacity,
          'line-dasharray': [2, 2],
        },
        layout: {
          'line-cap': 'butt',
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
          'circle-color': HEIGHT_COLOR_EXPR,
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
          'circle-color': WEIGHT_COLOR_EXPR,
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

      if (features.length === 0) {
        setSelectedFeature(null);
        return;
      }

      const feature = features[0];
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

      setSelectedFeature({
        properties: feature.properties,
        coords: popupCoords,
      });
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
    };
  }, [mapRef]);

  // Close popup on map click outside features or on movestart (unpinned only)
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!mapRef || !selectedFeature) return;
    const closeUnpinned = () => {
      if (!pinned) setSelectedFeature(null);
    };
    mapRef.on('movestart', closeUnpinned);
    return () => mapRef.off('movestart', closeUnpinned);
  }, [mapRef, selectedFeature, pinned]);

  // Reset pinned state when popup closes
  useEffect(() => {
    if (!selectedFeature) setPinned(false);
  }, [selectedFeature]);

  return selectedFeature ? (
    <RestrictionPopupWrapper
      feature={selectedFeature}
      mapRef={mapRef}
      lang={lang}
      pinned={pinned}
      onPin={() => setPinned(true)}
      onClose={() => setSelectedFeature(null)}
    />
  ) : null;
}

// Wrapper component for the draggable popup
function RestrictionPopupWrapper({ feature, mapRef, lang, pinned, onPin, onClose }) {
  const [lon, lat] = feature.coords;

  const popupOrigin = useMemo(() => {
    if (!mapRef) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    try {
      const pt = mapRef.project([lon, lat]);
      return { x: pt.x, y: pt.y - 30 };
    } catch {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
  }, [lon, lat, mapRef]);

  return (
    <DraggablePopup
      originLng={lon}
      originLat={lat}
      originX={popupOrigin.x}
      originY={popupOrigin.y}
      showConnectionLine={true}
      onPin={onPin}
    >
      <RestrictionPopupContent
        properties={feature.properties}
        lang={lang}
        pinned={pinned}
        onTogglePin={onPin}
        onClose={onClose}
      />
    </DraggablePopup>
  );
}

// Get color based on value (matching bucket thresholds)
function getValueColor(props) {
  const isHeight = props.restrictionType === 'height';
  if (isHeight) {
    const h = props.height || 5;
    if (h < 3) return '#7c3aed';       // violet
    if (h < 3.5) return '#8b5cf6';     // purple
    if (h < 4) return '#3b82f6';       // blue
    if (h < 4.5) return '#0ea5e9';     // sky
    return '#06b6d4';                  // cyan
  } else {
    const w = props.maxWeight || 50;
    if (w < 20) return '#b91c1c';      // dark red
    if (w < 30) return '#dc2626';      // red
    if (w < 40) return '#ea580c';      // orange
    if (w < 60) return '#f59e0b';      // amber
    return '#fbbf24';                  // yellow
  }
}

// Popup content component
function RestrictionPopupContent({ properties: props, lang, pinned, onTogglePin, onClose }) {
  const isHeight = props.restrictionType === 'height';
  const valueColor = getValueColor(props);

  return (
    <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-600 max-w-xs overflow-hidden">
      {/* Header with type label - draggable area */}
      <div
        className="px-3 py-1.5 draggable-header cursor-grab flex justify-between items-center"
        style={{ backgroundColor: isHeight ? 'rgba(139, 92, 246, 0.6)' : 'rgba(234, 88, 12, 0.6)' }}
      >
        <span className="text-white text-sm font-semibold">
          {isHeight
            ? (lang === 'no' ? 'Høydebegrensning' : 'Height Restriction')
            : (lang === 'no' ? 'Vektbegrensning' : 'Weight Restriction')}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {/* Pin button */}
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            className={`text-xs p-0.5 rounded transition-colors ${pinned ? 'text-emerald-400' : 'text-slate-300 hover:text-white'}`}
            title={lang === 'no' ? (pinned ? 'Løsne' : 'Fest') : (pinned ? 'Unpin' : 'Pin')}
          >
            <svg className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 text-slate-200 hover:text-white text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 text-xs text-slate-200 space-y-1" style={{ fontFamily: 'ui-monospace, monospace' }}>
        {props.name && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Navn' : 'Name'}:</span> {props.name}</div>
        )}
        {props.road && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Veg' : 'Road'}:</span> {props.road}</div>
        )}
        {props.height != null && (
          <div>
            <span className="text-slate-400">{lang === 'no' ? 'Maks høyde' : 'Max height'}:</span>{' '}
            <strong style={{ color: valueColor }}>{props.height}m</strong>
          </div>
        )}
        {props.heightType && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Type' : 'Type'}:</span> {props.heightType}</div>
        )}
        {props.maxWeight != null && (
          <div>
            <span className="text-slate-400">{lang === 'no' ? 'Maks vekt' : 'Max weight'}:</span>{' '}
            <strong style={{ color: valueColor }}>{props.maxWeight}t</strong>
          </div>
        )}
        {props.loadClass && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Bruksklasse' : 'Load class'}:</span> {props.loadClass}</div>
        )}
        {props.maxVehicleLength && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Maks lengde' : 'Max length'}:</span> {props.maxVehicleLength}m</div>
        )}
        {props.description && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Strekning' : 'Route'}:</span> {props.description}</div>
        )}
        {props.municipality && (
          <div><span className="text-slate-400">{lang === 'no' ? 'Kommune' : 'Municipality'}:</span> {props.municipality}</div>
        )}
        <div className="pt-1 text-[10px] text-slate-500">{lang === 'no' ? 'Kilde' : 'Source'}: NVDB</div>
      </div>
    </div>
  );
}

// Legend bucket items
const HEIGHT_BUCKETS = [
  { label: '<3m', color: '#7c3aed' },
  { label: '3-3.5', color: '#8b5cf6' },
  { label: '3.5-4', color: '#3b82f6' },
  { label: '4-4.5', color: '#0ea5e9' },
  { label: '>4.5m', color: '#06b6d4' },
];

const WEIGHT_BUCKETS = [
  { label: '<20t', color: '#b91c1c' },
  { label: '20-30', color: '#dc2626' },
  { label: '30-40', color: '#ea580c' },
  { label: '40-60', color: '#f59e0b' },
  { label: '>60t', color: '#fbbf24' },
];

// Toggle switch component
function ToggleSwitch({ checked, onChange, accentClass }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-7 h-4 rounded-full transition-colors cursor-pointer ${
        checked ? accentClass : 'bg-slate-600'
      }`}
    >
      <div
        className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Legend component with discrete color buckets
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
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs min-w-[240px]">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {lang === 'no' ? 'Vegrestriksjoner' : 'Road Restrictions'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>

      {/* Weight Limits Section (solid lines) */}
      <div className={`space-y-1.5 mb-2 transition-opacity ${!showWeightLimits ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-300 text-[11px] font-medium">
              {lang === 'no' ? 'Vektgrenser' : 'Weight Limits'}
            </span>
            <span className="text-slate-500 text-[9px]">({lang === 'no' ? 'heltrukket' : 'solid'})</span>
          </div>
          <ToggleSwitch
            checked={showWeightLimits}
            onChange={toggleWeightLimits}
            accentClass="bg-orange-500"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-0.5">
            {WEIGHT_BUCKETS.map((b) => (
              <div key={b.label} className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className="w-full h-2.5 rounded-sm transition-colors"
                  style={{ backgroundColor: showWeightLimits ? b.color : '#475569' }}
                />
                <span className="text-slate-500 text-[8px] mt-0.5 whitespace-nowrap">{b.label}</span>
              </div>
            ))}
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
              disabled={!showWeightLimits}
            />
            <span className={`text-[10px] w-8 text-right ${showWeightLimits ? 'text-orange-400' : 'text-slate-500'}`}>
              {weightFilterMax}t
            </span>
          </div>
        </div>
      </div>

      {/* Height Limits Section (dashed lines on map) */}
      <div className={`space-y-1.5 border-t border-slate-700 pt-2 transition-opacity ${!showHeightLimits ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-300 text-[11px] font-medium">
              {lang === 'no' ? 'Høydegrenser' : 'Height Limits'}
            </span>
            <span className="text-slate-500 text-[9px]">({lang === 'no' ? 'stiplet' : 'dashed'})</span>
          </div>
          <ToggleSwitch
            checked={showHeightLimits}
            onChange={toggleHeightLimits}
            accentClass="bg-violet-500"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-0.5">
            {HEIGHT_BUCKETS.map((b) => (
              <div key={b.label} className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className="w-full h-2.5 rounded-sm transition-colors"
                  style={{ backgroundColor: showHeightLimits ? b.color : '#475569' }}
                />
                <span className="text-slate-500 text-[8px] mt-0.5 whitespace-nowrap">{b.label}</span>
              </div>
            ))}
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
              className="flex-1 h-1 accent-violet-500"
              disabled={!showHeightLimits}
            />
            <span className={`text-[10px] w-8 text-right ${showHeightLimits ? 'text-violet-400' : 'text-slate-500'}`}>
              {heightFilterMax}m
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
