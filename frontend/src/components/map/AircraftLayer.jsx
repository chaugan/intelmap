import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const AIRCRAFT_SOURCE = 'aircraft-data';
const LAYER_CIV_PLANE = 'aircraft-civ-plane';
const LAYER_MIL_PLANE = 'aircraft-mil-plane';
const LAYER_CIV_HELI = 'aircraft-civ-heli';
const LAYER_MIL_HELI = 'aircraft-mil-heli';
const IMG_CIV_PLANE = 'img-civ-plane';
const IMG_MIL_PLANE = 'img-mil-plane';
const IMG_CIV_HELI = 'img-civ-heli';
const IMG_MIL_HELI = 'img-mil-heli';

const ALL_LAYERS = [LAYER_CIV_PLANE, LAYER_MIL_PLANE, LAYER_CIV_HELI, LAYER_MIL_HELI];
const ALL_IMAGES = [IMG_CIV_PLANE, IMG_MIL_PLANE, IMG_CIV_HELI, IMG_MIL_HELI];

// Top-down airplane silhouette (pointing up)
function createPlaneSvg(fill, stroke = '#000') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round">
      <path d="M24 3 L22 16 L8 22 L8 25 L22 23 L22 37 L17 40 L17 43 L24 41 L31 43 L31 40 L26 37 L26 23 L40 25 L40 22 L26 16 Z"/>
    </g>
  </svg>`;
}

// Top-down helicopter silhouette (pointing up) with rotor
function createHeliSvg(fill, stroke = '#000') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round">
      <path d="M24 6 L22.5 18 L19 20 L19 30 L22 32 L22 38 L17 42 L17 44 L24 42 L31 44 L31 42 L26 38 L26 32 L29 30 L29 20 L25.5 18 Z"/>
      <line x1="6" y1="10" x2="42" y2="10" stroke="${fill}" stroke-width="2.5"/>
      <line x1="6" y1="10" x2="42" y2="10" stroke="${stroke}" stroke-width="1"/>
      <circle cx="24" cy="10" r="2.5" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
    </g>
  </svg>`;
}

function svgToDataUrl(svg) {
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
  const setupDone = useRef(false);
  const aircraftOpacity = useMapStore((s) => s.aircraftOpacity);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, []);

  // Load images and create source + layers once
  useEffect(() => {
    if (!mapRef || setupDone.current) return;

    const setup = async () => {
      try {
        const [civPlane, milPlane, civHeli, milHeli] = await Promise.all([
          loadImage(svgToDataUrl(createPlaneSvg('#ffffff')), 48),
          loadImage(svgToDataUrl(createPlaneSvg('#f59e0b')), 48),
          loadImage(svgToDataUrl(createHeliSvg('#ffffff')), 48),
          loadImage(svgToDataUrl(createHeliSvg('#f59e0b')), 48),
        ]);

        if (!mapRef.hasImage(IMG_CIV_PLANE)) mapRef.addImage(IMG_CIV_PLANE, civPlane);
        if (!mapRef.hasImage(IMG_MIL_PLANE)) mapRef.addImage(IMG_MIL_PLANE, milPlane);
        if (!mapRef.hasImage(IMG_CIV_HELI)) mapRef.addImage(IMG_CIV_HELI, civHeli);
        if (!mapRef.hasImage(IMG_MIL_HELI)) mapRef.addImage(IMG_MIL_HELI, milHeli);

        if (!mapRef.getSource(AIRCRAFT_SOURCE)) {
          mapRef.addSource(AIRCRAFT_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }

        const addSymbolLayer = (id, image, size, filter) => {
          if (!mapRef.getLayer(id)) {
            mapRef.addLayer({
              id,
              type: 'symbol',
              source: AIRCRAFT_SOURCE,
              filter,
              layout: {
                'icon-image': image,
                'icon-size': size,
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
        };

        // Civilian airplanes: not military AND not helicopter
        addSymbolLayer(LAYER_CIV_PLANE, IMG_CIV_PLANE, 0.7, [
          'all', ['!=', ['get', 'military'], true], ['!=', ['get', 'helicopter'], true],
        ]);
        // Military airplanes: military AND not helicopter
        addSymbolLayer(LAYER_MIL_PLANE, IMG_MIL_PLANE, 0.85, [
          'all', ['==', ['get', 'military'], true], ['!=', ['get', 'helicopter'], true],
        ]);
        // Civilian helicopters: not military AND helicopter
        addSymbolLayer(LAYER_CIV_HELI, IMG_CIV_HELI, 0.7, [
          'all', ['!=', ['get', 'military'], true], ['==', ['get', 'helicopter'], true],
        ]);
        // Military helicopters: military AND helicopter
        addSymbolLayer(LAYER_MIL_HELI, IMG_MIL_HELI, 0.85, [
          'all', ['==', ['get', 'military'], true], ['==', ['get', 'helicopter'], true],
        ]);

        setupDone.current = true;
      } catch (err) {
        console.error('AircraftLayer setup error:', err);
      }
    };

    setup();

    return () => {
      removePopup();
      ALL_LAYERS.forEach((l) => { try { if (mapRef.getLayer(l)) mapRef.removeLayer(l); } catch {} });
      try { if (mapRef.getSource(AIRCRAFT_SOURCE)) mapRef.removeSource(AIRCRAFT_SOURCE); } catch {}
      ALL_IMAGES.forEach((i) => { try { if (mapRef.hasImage(i)) mapRef.removeImage(i); } catch {} });
      setupDone.current = false;
    };
  }, [mapRef, removePopup, aircraftOpacity]);

  // Update data source when data changes
  useEffect(() => {
    if (!mapRef || !setupDone.current) return;
    const src = mapRef.getSource(AIRCRAFT_SOURCE);
    if (src) {
      src.setData(data || { type: 'FeatureCollection', features: [] });
    }
  }, [mapRef, data]);

  // Update opacity
  useEffect(() => {
    if (!mapRef) return;
    ALL_LAYERS.forEach((l) => {
      try { if (mapRef.getLayer(l)) mapRef.setPaintProperty(l, 'icon-opacity', aircraftOpacity); } catch {}
    });
  }, [mapRef, aircraftOpacity]);

  // Click handler for popups
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      const activeLayers = ALL_LAYERS.filter((l) => { try { return !!mapRef.getLayer(l); } catch { return false; } });
      if (activeLayers.length === 0) return;

      const features = mapRef.queryRenderedFeatures(e.point, { layers: activeLayers });

      removePopup();
      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();
      const isMil = props.military === true || props.military === 'true';
      const isHeli = props.helicopter === true || props.helicopter === 'true';

      const emergencySquawk = EMERGENCY_SQUAWKS[props.squawk];
      const squawkHtml = emergencySquawk
        ? `<span style="color:#ef4444;font-weight:bold">${props.squawk} (${emergencySquawk})</span>`
        : (props.squawk || 'N/A');

      const typeLabel = isHeli ? 'Helicopter' : 'Aircraft';
      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:180px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${isMil ? '#f59e0b' : '#fff'}">
            ${props.callsign || props.registration || props.hex || 'Unknown'}
            ${isMil ? ' <span style="font-size:10px;background:#78350f;padding:1px 4px;border-radius:3px">MIL</span>' : ''}
            ${isHeli ? ' <span style="font-size:10px;background:#1e3a5f;padding:1px 4px;border-radius:3px">HELI</span>' : ''}
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

// Airplane icon for legend
const PLANE_PATH = 'M24 3 L22 16 L8 22 L8 25 L22 23 L22 37 L17 40 L17 43 L24 41 L31 43 L31 40 L26 37 L26 23 L40 25 L40 22 L26 16 Z';

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
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path d={PLANE_PATH} fill="#ffffff" stroke="#000" strokeWidth="1"/>
          </svg>
          <span className="text-slate-300">{lang === 'no' ? 'Sivil' : 'Civilian'}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path d={PLANE_PATH} fill="#f59e0b" stroke="#000" strokeWidth="1"/>
          </svg>
          <span className="text-amber-400">{lang === 'no' ? 'Militær' : 'Military'}</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path d="M24 6 L22.5 18 L19 20 L19 30 L22 32 L22 38 L17 42 L17 44 L24 42 L31 44 L31 42 L26 38 L26 32 L29 30 L29 20 L25.5 18 Z" fill="#ffffff" stroke="#000" strokeWidth="1"/>
            <line x1="6" y1="10" x2="42" y2="10" stroke="#ffffff" strokeWidth="2.5"/>
            <circle cx="24" cy="10" r="2.5" fill="#ffffff" stroke="#000" strokeWidth="1"/>
          </svg>
          <span className="text-slate-300">{lang === 'no' ? 'Helikopter' : 'Helicopter'}</span>
        </div>
      </div>
    </div>
  );
}
