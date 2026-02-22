import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const AIRCRAFT_SOURCE = 'aircraft-data';
const CIVILIAN_LAYER = 'aircraft-civilian';
const MILITARY_LAYER = 'aircraft-military';
const CIVILIAN_IMAGE = 'aircraft-icon-civilian';
const MILITARY_IMAGE = 'aircraft-icon-military';

// Create airplane SVG as data URL
function createAircraftSvg(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M16 2 L14 12 L4 16 L14 17 L14 26 L10 28 L10 30 L16 29 L22 30 L22 28 L18 26 L18 17 L28 16 L18 12 Z"
      fill="${color}" stroke="#000" stroke-width="0.5"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatAltitude(alt) {
  if (alt === 'ground' || alt == null) return 'Ground';
  const ft = typeof alt === 'string' ? parseInt(alt) : alt;
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

export default function AircraftLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const aircraftOpacity = useMapStore((s) => s.aircraftOpacity);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mapRef) return;

    // Load aircraft images
    const civImg = new Image(32, 32);
    civImg.src = createAircraftSvg('#ffffff');
    civImg.onload = () => {
      if (!mapRef.hasImage(CIVILIAN_IMAGE)) mapRef.addImage(CIVILIAN_IMAGE, civImg);
    };

    const milImg = new Image(32, 32);
    milImg.src = createAircraftSvg('#f59e0b');
    milImg.onload = () => {
      if (!mapRef.hasImage(MILITARY_IMAGE)) mapRef.addImage(MILITARY_IMAGE, milImg);
    };

    return () => {
      removePopup();
      try { if (mapRef.getLayer(MILITARY_LAYER)) mapRef.removeLayer(MILITARY_LAYER); } catch {}
      try { if (mapRef.getLayer(CIVILIAN_LAYER)) mapRef.removeLayer(CIVILIAN_LAYER); } catch {}
      try { if (mapRef.getSource(AIRCRAFT_SOURCE)) mapRef.removeSource(AIRCRAFT_SOURCE); } catch {}
      try { if (mapRef.hasImage(CIVILIAN_IMAGE)) mapRef.removeImage(CIVILIAN_IMAGE); } catch {}
      try { if (mapRef.hasImage(MILITARY_IMAGE)) mapRef.removeImage(MILITARY_IMAGE); } catch {}
    };
  }, [mapRef, removePopup]);

  // Update data source
  useEffect(() => {
    if (!mapRef) return;

    const geojson = data || { type: 'FeatureCollection', features: [] };

    if (mapRef.getSource(AIRCRAFT_SOURCE)) {
      mapRef.getSource(AIRCRAFT_SOURCE).setData(geojson);
    } else {
      mapRef.addSource(AIRCRAFT_SOURCE, { type: 'geojson', data: geojson });

      // Civilian layer
      mapRef.addLayer({
        id: CIVILIAN_LAYER,
        type: 'symbol',
        source: AIRCRAFT_SOURCE,
        filter: ['!=', ['get', 'military'], true],
        layout: {
          'icon-image': CIVILIAN_IMAGE,
          'icon-size': 0.6,
          'icon-rotate': ['coalesce', ['get', 'track'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': aircraftOpacity,
        },
      });

      // Military layer (slightly larger)
      mapRef.addLayer({
        id: MILITARY_LAYER,
        type: 'symbol',
        source: AIRCRAFT_SOURCE,
        filter: ['==', ['get', 'military'], true],
        layout: {
          'icon-image': MILITARY_IMAGE,
          'icon-size': 0.75,
          'icon-rotate': ['coalesce', ['get', 'track'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': aircraftOpacity,
        },
      });
    }
  }, [mapRef, data, aircraftOpacity]);

  // Update opacity
  useEffect(() => {
    if (!mapRef) return;
    try {
      if (mapRef.getLayer(CIVILIAN_LAYER)) mapRef.setPaintProperty(CIVILIAN_LAYER, 'icon-opacity', aircraftOpacity);
      if (mapRef.getLayer(MILITARY_LAYER)) mapRef.setPaintProperty(MILITARY_LAYER, 'icon-opacity', aircraftOpacity);
    } catch {}
  }, [mapRef, aircraftOpacity]);

  // Click handler for popups
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      const features = mapRef.queryRenderedFeatures(e.point, {
        layers: [CIVILIAN_LAYER, MILITARY_LAYER].filter((l) => mapRef.getLayer(l)),
      });

      removePopup();

      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();

      const emergencySquawk = EMERGENCY_SQUAWKS[props.squawk];
      const squawkHtml = emergencySquawk
        ? `<span style="color:#ef4444;font-weight:bold">${props.squawk} (${emergencySquawk})</span>`
        : (props.squawk || 'N/A');

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:180px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${props.military === true || props.military === 'true' ? '#f59e0b' : '#fff'}">
            ${props.callsign || props.registration || props.hex || 'Unknown'}
            ${props.military === true || props.military === 'true' ? ' <span style="font-size:10px;background:#78350f;padding:1px 4px;border-radius:3px">MIL</span>' : ''}
          </div>
          ${props.type ? `<div><span style="color:#94a3b8">Type:</span> ${props.type}</div>` : ''}
          ${props.registration ? `<div><span style="color:#94a3b8">Reg:</span> ${props.registration}</div>` : ''}
          <div><span style="color:#94a3b8">Alt:</span> ${formatAltitude(props.altBaro)}</div>
          <div><span style="color:#94a3b8">Speed:</span> ${formatSpeed(props.groundSpeed)}</div>
          <div><span style="color:#94a3b8">Heading:</span> ${props.track != null ? `${Math.round(props.track)}°` : 'N/A'}</div>
          <div><span style="color:#94a3b8">Squawk:</span> ${squawkHtml}</div>
          ${props.hex ? `<div style="color:#64748b;font-size:10px;margin-top:2px">ICAO: ${props.hex}</div>` : ''}
        </div>
      `;

      const popup = new mapRef.__proto__.constructor.prototype.constructor
        ? null : null;

      // Use maplibregl Popup directly
      const maplibregl = mapRef.getContainer()?.__maplibre_map
        ? window.maplibregl
        : null;

      // Create popup element manually since we may not have direct maplibregl reference
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

      // Update position on map move
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

    // Change cursor on hover
    const onEnter = () => { mapRef.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { mapRef.getCanvas().style.cursor = ''; };
    const layers = [CIVILIAN_LAYER, MILITARY_LAYER];
    layers.forEach((l) => {
      if (mapRef.getLayer(l)) {
        mapRef.on('mouseenter', l, onEnter);
        mapRef.on('mouseleave', l, onLeave);
      }
    });

    return () => {
      mapRef.off('click', handleClick);
      layers.forEach((l) => {
        try {
          mapRef.off('mouseenter', l, onEnter);
          mapRef.off('mouseleave', l, onLeave);
        } catch {}
      });
      if (popupRef.current?._cleanup) popupRef.current._cleanup();
      removePopup();
    };
  }, [mapRef, removePopup]);

  return null;
}

export function AircraftLegend({ count }) {
  const lang = useMapStore((s) => s.lang);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1">
        {lang === 'no' ? 'Luftfart' : 'Aircraft'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 32 32">
            <path d="M16 2 L14 12 L4 16 L14 17 L14 26 L10 28 L10 30 L16 29 L22 30 L22 28 L18 26 L18 17 L28 16 L18 12 Z"
              fill="#ffffff" stroke="#000" strokeWidth="0.5"/>
          </svg>
          <span className="text-slate-300">{lang === 'no' ? 'Sivil' : 'Civilian'}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 32 32">
            <path d="M16 2 L14 12 L4 16 L14 17 L14 26 L10 28 L10 30 L16 29 L22 30 L22 28 L18 26 L18 17 L28 16 L18 12 Z"
              fill="#f59e0b" stroke="#000" strokeWidth="0.5"/>
          </svg>
          <span className="text-amber-400">{lang === 'no' ? 'Militær' : 'Military'}</span>
        </div>
      </div>
    </div>
  );
}
