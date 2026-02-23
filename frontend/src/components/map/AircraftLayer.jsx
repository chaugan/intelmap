import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const AIRCRAFT_SOURCE = 'aircraft-data';
const LAYER_RING = 'aircraft-highlight-ring';
const LAYER_PLANE = 'aircraft-plane';
const LAYER_HELI = 'aircraft-heli';
const IMG_PLANE = 'img-plane-sdf';
const IMG_HELI = 'img-heli-sdf';

const SYMBOL_LAYERS = [LAYER_PLANE, LAYER_HELI];
const ALL_LAYERS = [LAYER_RING, LAYER_PLANE, LAYER_HELI];
const ALL_IMAGES = [IMG_PLANE, IMG_HELI];

// SDF plane silhouette — pure white fill, no stroke (MapLibre tints via icon-color)
function createPlaneSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <path d="M24 3 L22 16 L8 22 L8 25 L22 23 L22 37 L17 40 L17 43 L24 41 L31 43 L31 40 L26 37 L26 23 L40 25 L40 22 L26 16 Z" fill="#ffffff" stroke="none"/>
  </svg>`;
}

// SDF heli silhouette — pure white fill, thicker rotor for SDF clarity
function createHeliSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <path d="M24 6 L22.5 18 L19 20 L19 30 L22 32 L22 38 L17 42 L17 44 L24 42 L31 44 L31 42 L26 38 L26 32 L29 30 L29 20 L25.5 18 Z" fill="#ffffff" stroke="none"/>
    <line x1="6" y1="10" x2="42" y2="10" stroke="#ffffff" stroke-width="3.5"/>
    <circle cx="24" cy="10" r="2.5" fill="#ffffff" stroke="none"/>
  </svg>`;
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatAltitude(alt, onGround) {
  if (onGround) return 'Ground';
  if (alt == null) return 'N/A';
  const ft = typeof alt === 'number' ? alt : parseInt(alt);
  if (isNaN(ft)) return String(alt);
  const m = Math.round(ft * 0.3048);
  return `${ft.toLocaleString()} ft (${m.toLocaleString()} m)`;
}

function formatSpeed(kts) {
  if (kts == null) return 'N/A';
  const kmh = Math.round(kts * 1.852);
  return `${Math.round(kts)} kts (${kmh} km/h)`;
}

const EMERGENCY_SQUAWKS = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'EMERGENCY' };

// Altitude-based color expression matching ADS-B Exchange / tar1090 HSL gradient
const ALT_COLOR = [
  'case',
  // Emergency squawk override — red
  ['in', ['get', 'squawk'], ['literal', ['7500', '7600', '7700']]], '#ef4444',
  // On ground — dark gray
  ['to-boolean', ['get', 'onGround']], '#737373',
  // No altitude data — light gray
  ['!', ['has', 'altBaro']], '#bfbfbf',
  // Altitude interpolation: orange-red → green → cyan → purple → magenta
  ['interpolate', ['linear'], ['max', ['get', 'altBaro'], 0],
    0, '#d34f0d',
    2000, '#d34f0d',
    6000, '#82d30d',
    10000, '#0dd34f',
    20000, '#0da8d3',
    30000, '#4f0dd3',
    40000, '#d30dd3',
  ],
];

function loadImage(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export default function AircraftLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const [ready, setReady] = useState(false);
  const aircraftOpacity = useMapStore((s) => s.aircraftOpacity);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, []);

  // Load SDF images and create source + layers once
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const setup = async () => {
      try {
        const [planeImg, heliImg] = await Promise.all([
          loadImage(svgToDataUrl(createPlaneSvgSdf()), 48),
          loadImage(svgToDataUrl(createHeliSvgSdf()), 48),
        ]);

        if (cancelled) return;

        if (!mapRef.hasImage(IMG_PLANE)) mapRef.addImage(IMG_PLANE, planeImg, { sdf: true });
        if (!mapRef.hasImage(IMG_HELI)) mapRef.addImage(IMG_HELI, heliImg, { sdf: true });

        if (!mapRef.getSource(AIRCRAFT_SOURCE)) {
          mapRef.addSource(AIRCRAFT_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }

        // 1. Red circle ring layer (below icons) for military/special aircraft
        if (!mapRef.getLayer(LAYER_RING)) {
          mapRef.addLayer({
            id: LAYER_RING,
            type: 'circle',
            source: AIRCRAFT_SOURCE,
            filter: ['any',
              ['to-boolean', ['get', 'military']],
              ['to-boolean', ['get', 'special']],
            ],
            paint: {
              'circle-radius': 22,
              'circle-color': 'transparent',
              'circle-stroke-color': '#ef4444',
              'circle-stroke-width': 2.5,
              'circle-stroke-opacity': aircraftOpacity,
            },
          });
        }

        // Size expression: larger for military/special
        const iconSize = [
          'case',
          ['any', ['to-boolean', ['get', 'military']], ['to-boolean', ['get', 'special']]],
          0.85,
          0.7,
        ];

        // 2. Airplane symbol layer (non-helicopter)
        if (!mapRef.getLayer(LAYER_PLANE)) {
          mapRef.addLayer({
            id: LAYER_PLANE,
            type: 'symbol',
            source: AIRCRAFT_SOURCE,
            filter: ['!', ['to-boolean', ['get', 'helicopter']]],
            layout: {
              'icon-image': IMG_PLANE,
              'icon-size': iconSize,
              'icon-rotate': ['coalesce', ['get', 'track'], 0],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: {
              'icon-color': ALT_COLOR,
              'icon-halo-color': '#000000',
              'icon-halo-width': 1,
              'icon-opacity': aircraftOpacity,
            },
          });
        }

        // 3. Helicopter symbol layer
        if (!mapRef.getLayer(LAYER_HELI)) {
          mapRef.addLayer({
            id: LAYER_HELI,
            type: 'symbol',
            source: AIRCRAFT_SOURCE,
            filter: ['to-boolean', ['get', 'helicopter']],
            layout: {
              'icon-image': IMG_HELI,
              'icon-size': iconSize,
              'icon-rotate': ['coalesce', ['get', 'track'], 0],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: {
              'icon-color': ALT_COLOR,
              'icon-halo-color': '#000000',
              'icon-halo-width': 1,
              'icon-opacity': aircraftOpacity,
            },
          });
        }

        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('AircraftLayer setup error:', err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      removePopup();
      ALL_LAYERS.forEach((l) => { try { if (mapRef.getLayer(l)) mapRef.removeLayer(l); } catch {} });
      try { if (mapRef.getSource(AIRCRAFT_SOURCE)) mapRef.removeSource(AIRCRAFT_SOURCE); } catch {}
      ALL_IMAGES.forEach((i) => { try { if (mapRef.hasImage(i)) mapRef.removeImage(i); } catch {} });
      setReady(false);
    };
  }, [mapRef, removePopup, aircraftOpacity]);

  // Update data source when data changes
  useEffect(() => {
    if (!mapRef || !ready) return;
    const src = mapRef.getSource(AIRCRAFT_SOURCE);
    if (src) {
      src.setData(data || { type: 'FeatureCollection', features: [] });
    }
  }, [mapRef, data, ready]);

  // Update opacity on all layers
  useEffect(() => {
    if (!mapRef) return;
    SYMBOL_LAYERS.forEach((l) => {
      try { if (mapRef.getLayer(l)) mapRef.setPaintProperty(l, 'icon-opacity', aircraftOpacity); } catch {}
    });
    try { if (mapRef.getLayer(LAYER_RING)) mapRef.setPaintProperty(LAYER_RING, 'circle-stroke-opacity', aircraftOpacity); } catch {}
  }, [mapRef, aircraftOpacity]);

  // Click handler for popups — query only symbol layers (not circle ring)
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      const activeLayers = SYMBOL_LAYERS.filter((l) => { try { return !!mapRef.getLayer(l); } catch { return false; } });
      if (activeLayers.length === 0) return;

      const features = mapRef.queryRenderedFeatures(e.point, { layers: activeLayers });

      removePopup();
      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();
      const isMil = props.military === true || props.military === 'true';
      const isSpecial = props.special === true || props.special === 'true';
      const isHeli = props.helicopter === true || props.helicopter === 'true';
      const onGround = props.onGround === true || props.onGround === 'true';

      const emergencySquawk = EMERGENCY_SQUAWKS[props.squawk];
      const squawkHtml = emergencySquawk
        ? `<span style="color:#ef4444;font-weight:bold">${props.squawk} (${emergencySquawk})</span>`
        : (props.squawk || 'N/A');

      const titleColor = isMil ? '#f59e0b' : isSpecial ? '#ef4444' : '#fff';

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:180px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${titleColor}">
            ${props.callsign || props.registration || props.hex || 'Unknown'}
            ${isMil ? ' <span style="font-size:10px;background:#78350f;padding:1px 4px;border-radius:3px">MIL</span>' : ''}
            ${isSpecial ? ' <span style="font-size:10px;background:#7f1d1d;padding:1px 4px;border-radius:3px">GOV</span>' : ''}
            ${isHeli ? ' <span style="font-size:10px;background:#1e3a5f;padding:1px 4px;border-radius:3px">HELI</span>' : ''}
          </div>
          ${props.type ? `<div><span style="color:#94a3b8">Type:</span> ${props.type}</div>` : ''}
          ${props.registration ? `<div><span style="color:#94a3b8">Reg:</span> ${props.registration}</div>` : ''}
          <div><span style="color:#94a3b8">Alt:</span> ${formatAltitude(props.altBaro, onGround)}</div>
          <div><span style="color:#94a3b8">Speed:</span> ${formatSpeed(props.groundSpeed)}</div>
          <div><span style="color:#94a3b8">Heading:</span> ${props.track != null ? `${Math.round(props.track)}°` : 'N/A'}</div>
          <div><span style="color:#94a3b8">Squawk:</span> ${squawkHtml}</div>
          ${props.hex ? `<div style="color:#64748b;font-size:10px;margin-top:2px">ICAO: ${props.hex}</div>` : ''}
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;padding:10px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:280px">
          <button style="position:absolute;top:4px;right:8px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:2px 4px" onclick="this.parentElement.parentElement.remove()">×</button>
          ${html}
        </div>
      `;

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
    };

    mapRef.on('click', handleClick);

    const onEnter = () => { mapRef.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { mapRef.getCanvas().style.cursor = ''; };
    SYMBOL_LAYERS.forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.on('mouseenter', l, onEnter);
          mapRef.on('mouseleave', l, onLeave);
        }
      } catch {}
    });

    return () => {
      mapRef.off('click', handleClick);
      SYMBOL_LAYERS.forEach((l) => {
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

// Altitude gradient colors for the legend
const ALT_GRADIENT = [
  { color: '#737373', label: 'GND' },
  { color: '#d34f0d', label: '0' },
  { color: '#82d30d', label: '6k' },
  { color: '#0dd34f', label: '10k' },
  { color: '#0da8d3', label: '20k' },
  { color: '#4f0dd3', label: '30k' },
  { color: '#d30dd3', label: '40k+' },
];

const PLANE_PATH = 'M24 3 L22 16 L8 22 L8 25 L22 23 L22 37 L17 40 L17 43 L24 41 L31 43 L31 40 L26 37 L26 23 L40 25 L40 22 L26 16 Z';
const HELI_PATH = 'M24 6 L22.5 18 L19 20 L19 30 L22 32 L22 38 L17 42 L17 44 L24 42 L31 44 L31 42 L26 38 L26 32 L29 30 L29 20 L25.5 18 Z';

export function AircraftLegend({ count }) {
  const lang = useMapStore((s) => s.lang);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {lang === 'no' ? 'Luftfart' : 'Aircraft'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>

      {/* Altitude gradient bar */}
      <div className="mb-1.5">
        <div className="text-slate-500 text-[9px] mb-0.5">{lang === 'no' ? 'Hoyde (ft)' : 'Altitude (ft)'}</div>
        <div className="flex">
          {ALT_GRADIENT.map((item) => (
            <div key={item.label} className="flex flex-col items-center flex-1 min-w-0">
              <div className="w-full h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="text-slate-500 text-[9px] mt-0.5 whitespace-nowrap">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Icon indicators */}
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="#ef4444" strokeWidth="3"/>
            <path d={PLANE_PATH} fill="#94a3b8" stroke="none" transform="scale(0.7) translate(10,10)"/>
          </svg>
          <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Mil / Myndighet' : 'Mil / Gov'}</span>
        </div>
        <div className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 48 48">
            <path d={HELI_PATH} fill="#94a3b8" stroke="none"/>
            <line x1="6" y1="10" x2="42" y2="10" stroke="#94a3b8" strokeWidth="3"/>
            <circle cx="24" cy="10" r="2.5" fill="#94a3b8" stroke="none"/>
          </svg>
          <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Helikopter' : 'Heli'}</span>
        </div>
      </div>
    </div>
  );
}
