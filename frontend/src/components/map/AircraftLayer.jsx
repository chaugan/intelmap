import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const AIRCRAFT_SOURCE = 'aircraft-data';
const LAYER_RING = 'aircraft-highlight-ring';
const LAYER_PLANE = 'aircraft-plane';
const LAYER_HELI = 'aircraft-heli';
const IMG_PLANE = 'img-plane-sdf';
const IMG_HELI = 'img-heli-sdf';

const TRACE_SOURCE = 'aircraft-trace';
const TRACE_LAYER = 'aircraft-trace-line';

const SYMBOL_LAYERS = [LAYER_PLANE, LAYER_HELI];
const ALL_LAYERS = [LAYER_RING, LAYER_PLANE, LAYER_HELI];
const ALL_IMAGES = [IMG_PLANE, IMG_HELI];

// SDF plane silhouette — pure white fill, no stroke (MapLibre tints via icon-color)
function createPlaneSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <path d="M24 3 L22 16 L8 22 L8 25 L22 23 L22 37 L17 40 L17 43 L24 41 L31 43 L31 40 L26 37 L26 23 L40 25 L40 22 L26 16 Z" fill="#ffffff" stroke="none"/>
  </svg>`;
}

// SDF heli silhouette — detailed top-down helicopter, scaled from high-res source
// Raw path is in source coordinates; transform: matrix(.1,0,0,-.1,0,1920) maps to
// 1308×1920, then scale(0.025) fits height to 48, translate centers horizontally.
const HELI_RAW_PATH = 'm347 19179c-241-57-395-312-332-552 35-135-56-39 1886-1982l1819-1820v-2175-2175l-1819-1820c-1694-1695-1821-1824-1850-1885-186-392 217-795 609-609 61 29 198 164 2006 1971l1940 1939 49-111c160-366 406-656 752-886 126-85 333-185 472-230l120-39-2-2489-2-2489-909-243c-500-133-927-250-950-260-177-77-313-226-373-409-24-73-27-98-31-276-3-127 0-216 8-252 37-180 192-334 369-367 33-6 399-10 972-10h919v-75c0-98 15-165 56-252 38-80 119-174 183-213l40-25 1-611c0-670-1-662 60-736 43-52 121-88 188-88 84 0 131 19 189 75 85 83 83 63 83 759l1 601 56 40c133 95 207 240 220 432l6 93h917c582 0 937 4 971 10 166 32 310 159 359 318 29 94 29 423 0 536-49 194-180 353-355 433-45 21-394 118-982 275l-913 243v2490 2491l74 22c171 50 407 167 564 279 332 238 545 493 692 827l64 147 1951-1949c1846-1845 1953-1950 2012-1976 88-38 170-50 257-36 314 49 479 387 329 674-21 39-445 469-1845 1871l-1818 1820v2175 2175l1823 1825c1698 1699 1826 1829 1850 1885 103 238 7 500-223 609-57 27-78 31-170 34-122 4-183-12-275-73-33-22-668-652-1578-1566l-1524-1529-32 11c-18 6-59 9-91 7-48-3-67-10-97-35-63-50-77-84-81-194l-4-96-243-243-242-242-23 59c-103 259-260 493-466 698l-91 90-17 85c-115 578-560 1007-1141 1097-119 18-352 13-460-11-532-115-935-503-1060-1019-14-56-25-113-25-127 0-18-19-42-70-88-183-166-379-448-480-694l-36-87-242 242-242 242v85c0 101-22 156-83 204-29 24-50 31-97 34-32 2-74-1-92-7l-32-11-1546 1544c-1645 1644-1575 1578-1705 1612-56 15-160 17-218 3zm8613-5479v-730h-180-180v552 553l177 177c98 98 179 178 180 178 2 0 3-328 3-730zm-4652 547 172-173v-552-552h-180-180v725c0 399 4 725 8 725s85-78 180-173zm172-2274v-638l-27-77c-27-76-31-82-180-230l-153-153v868 867h180 180zm4480-225v-863l-155 155c-144 143-156 159-180 223l-25 68v640 639h180 180z';
const HELI_TRANSFORM = 'translate(7.65,0) scale(0.025) matrix(.1,0,0,-.1,0,1920)';

function createHeliSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g transform="${HELI_TRANSFORM}">
      <path d="${HELI_RAW_PATH}" fill="#ffffff" stroke="none"/>
    </g>
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

// Build/update the compact "SAS · Departed 14:32 UTC" line below route info
function updateExtraInfo(popupEl) {
  const airline = popupEl._airlineName;
  const depTime = popupEl._departureTime;
  if (!airline && !depTime) return;

  const parts = [];
  if (airline) parts.push(airline);
  if (depTime) parts.push(`Departed ${depTime}`);

  let el = popupEl.querySelector('.extra-info');
  if (!el) {
    el = document.createElement('div');
    el.className = 'extra-info';
    el.style.cssText = 'margin-top:4px;color:#94a3b8;font-size:11px';
    // Insert after route-info if it exists, otherwise after trace-status area
    const routeEl = popupEl.querySelector('.route-info');
    if (routeEl) {
      routeEl.parentNode.insertBefore(el, routeEl.nextSibling);
    }
  }
  el.textContent = parts.join(' \u00b7 ');
}

function removeTrace(map) {
  try { if (map.getLayer(TRACE_LAYER)) map.removeLayer(TRACE_LAYER); } catch {}
  try { if (map.getSource(TRACE_SOURCE)) map.removeSource(TRACE_SOURCE); } catch {}
}

async function fetchAndDrawTrace(map, hex, currentCoords) {
  try {
    const res = await fetch(`/api/aircraft/trace/${hex}`);
    if (!res.ok) return;
    const geojson = await res.json();
    if (!geojson.geometry?.coordinates?.length) return;

    // Append aircraft's current live position so the line connects to the icon
    if (currentCoords) {
      geojson.geometry.coordinates.push(currentCoords);
    }

    // Remove any previous trace
    removeTrace(map);

    map.addSource(TRACE_SOURCE, { type: 'geojson', data: geojson, lineMetrics: true });
    map.addLayer({
      id: TRACE_LAYER,
      type: 'line',
      source: TRACE_SOURCE,
      paint: {
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0, '#06b6d4',
          1, '#f43f5e',
        ],
        'line-width': 3,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    }, LAYER_RING); // insert before ring layer so trace is below icons

    return geojson;
  } catch (err) {
    console.error('Failed to fetch trace:', err);
    return null;
  }
}

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
  const dataRef = useRef(data);
  const [ready, setReady] = useState(false);
  const aircraftOpacity = useMapStore((s) => s.aircraftOpacity);

  // Keep dataRef in sync so the styledata handler can re-push data
  useEffect(() => { dataRef.current = data; }, [data]);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
    if (mapRef) removeTrace(mapRef);
  }, [mapRef]);

  // Pre-load SDF image HTMLImageElements once (shared across style reloads)
  const imagesRef = useRef(null);

  // Add images, source, and layers to the current map style
  const addLayers = useCallback((opacity) => {
    if (!mapRef || !imagesRef.current) return;
    const { planeImg, heliImg } = imagesRef.current;

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
          'circle-radius': 33,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ef4444',
          'circle-stroke-width': 2.5,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // Size expression: larger for military/special
    const iconSize = [
      'case',
      ['any', ['to-boolean', ['get', 'military']], ['to-boolean', ['get', 'special']]],
      1.275,
      1.05,
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
          'icon-opacity': opacity,
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
          'icon-opacity': opacity,
        },
      });
    }
  }, [mapRef]);

  // Load SDF images, create layers, and re-add after style swaps
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const setup = async () => {
      try {
        if (!imagesRef.current) {
          const [planeImg, heliImg] = await Promise.all([
            loadImage(svgToDataUrl(createPlaneSvgSdf()), 48),
            loadImage(svgToDataUrl(createHeliSvgSdf()), 48),
          ]);
          if (cancelled) return;
          imagesRef.current = { planeImg, heliImg };
        }

        addLayers(aircraftOpacity);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('AircraftLayer setup error:', err);
      }
    };

    // Re-add layers after a map style swap (e.g. changing base layer)
    const onStyleData = () => {
      // Style swap wipes all custom sources/layers/images — re-add them
      if (imagesRef.current && !mapRef.getSource(AIRCRAFT_SOURCE)) {
        addLayers(aircraftOpacity);
        // Re-push current data into the fresh source
        if (dataRef.current) {
          const src = mapRef.getSource(AIRCRAFT_SOURCE);
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
      removeTrace(mapRef);
      ALL_LAYERS.forEach((l) => { try { if (mapRef.getLayer(l)) mapRef.removeLayer(l); } catch {} });
      try { if (mapRef.getSource(AIRCRAFT_SOURCE)) mapRef.removeSource(AIRCRAFT_SOURCE); } catch {}
      ALL_IMAGES.forEach((i) => { try { if (mapRef.hasImage(i)) mapRef.removeImage(i); } catch {} });
      setReady(false);
    };
  }, [mapRef, removePopup, addLayers, aircraftOpacity]);

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

      const routePlaceholder = props.callsign
        ? `<div class="route-info" style="margin-top:6px;padding-top:6px;border-top:1px solid #334155;color:#64748b;font-size:11px">Loading route...</div>`
        : '';

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
          ${routePlaceholder}
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:280px;overflow:hidden">
          <div class="popup-drag-handle" style="height:28px;cursor:grab;background:#334155;display:flex;align-items:center;justify-content:center;border-radius:8px 8px 0 0;touch-action:none">
            <div style="width:40px;height:4px;background:#64748b;border-radius:2px"></div>
          </div>
          <div style="padding:10px 12px;position:relative">
            <button class="popup-close-btn" style="position:absolute;top:0px;right:4px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:4px 8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:4px">×</button>
            ${html}
            <div class="trace-status" style="color:#64748b;font-size:10px;margin-top:4px">Loading trace...</div>
          </div>
        </div>
      `;

      // Wire close button to removePopup so trace is also cleaned up
      popupEl.querySelector('.popup-close-btn').addEventListener('click', () => removePopup());

      const point = mapRef.project(coords);
      popupEl.style.left = `${point.x}px`;
      popupEl.style.top = `${point.y - 10}px`;
      popupEl.style.transform = 'translate(-50%, -100%)';

      mapRef.getContainer().appendChild(popupEl);
      popupRef.current = popupEl;

      // --- Drag logic ---
      let detached = false;
      const handle = popupEl.querySelector('.popup-drag-handle');

      const onMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.style.cursor = 'grabbing';

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = popupEl.getBoundingClientRect();
        const containerRect = mapRef.getContainer().getBoundingClientRect();
        const startLeft = rect.left - containerRect.left;
        const startTop = rect.top - containerRect.top;

        if (!detached) {
          detached = true;
          mapRef.off('move', updatePos);
          popupEl.style.transform = 'none';
          popupEl.style.left = `${startLeft}px`;
          popupEl.style.top = `${startTop}px`;
        }

        mapRef.dragPan.disable();

        const onMouseMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          popupEl.style.left = `${startLeft + dx}px`;
          popupEl.style.top = `${startTop + dy}px`;
        };

        const onMouseUp = () => {
          handle.style.cursor = 'grab';
          mapRef.dragPan.enable();
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      handle.addEventListener('mousedown', onMouseDown);

      // Touch drag support
      const onTouchStart = (te) => {
        te.preventDefault();
        te.stopPropagation();
        const touch = te.touches[0];
        handle.style.cursor = 'grabbing';

        const startX = touch.clientX;
        const startY = touch.clientY;
        const rect = popupEl.getBoundingClientRect();
        const containerRect = mapRef.getContainer().getBoundingClientRect();
        const startLeft = rect.left - containerRect.left;
        const startTop = rect.top - containerRect.top;

        if (!detached) {
          detached = true;
          mapRef.off('move', updatePos);
          popupEl.style.transform = 'none';
          popupEl.style.left = `${startLeft}px`;
          popupEl.style.top = `${startTop}px`;
        }

        mapRef.dragPan.disable();

        const onTouchMove = (ev) => {
          const t = ev.touches[0];
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          popupEl.style.left = `${startLeft + dx}px`;
          popupEl.style.top = `${startTop + dy}px`;
        };

        const onTouchEnd = () => {
          handle.style.cursor = 'grab';
          mapRef.dragPan.enable();
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
        };

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
      };

      handle.addEventListener('touchstart', onTouchStart, { passive: false });

      // Hover effect on close button
      const closeBtn = popupEl.querySelector('.popup-close-btn');
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#475569'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none'; });

      // Fetch and draw trace (fire-and-forget)
      if (props.hex) {
        fetchAndDrawTrace(mapRef, props.hex, coords).then((geojson) => {
          const statusEl = popupEl.querySelector('.trace-status');
          if (statusEl) statusEl.remove();

          // Show departure time from trace data
          const depTs = geojson?.properties?.departureTime;
          if (depTs) {
            const d = new Date(depTs * 1000);
            const hh = String(d.getUTCHours()).padStart(2, '0');
            const mm = String(d.getUTCMinutes()).padStart(2, '0');
            popupEl._departureTime = `${hh}:${mm} UTC`;
          }
          // Update the extra-info line (airline may already be there)
          updateExtraInfo(popupEl);
        });
      }

      // Fetch route info (fire-and-forget)
      if (props.callsign) {
        fetch(`/api/aircraft/route/${props.callsign}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            const routeEl = popupEl.querySelector('.route-info');
            if (!routeEl) return;
            if (!data || !data.route) {
              routeEl.remove();
              return;
            }
            const fmtAirport = (a) => {
              if (!a) return 'Unknown';
              const code = a.iata || a.icao || '??';
              const parts = [code];
              if (a.name) parts.push(a.name);
              if (a.country) parts[parts.length - 1] += `, ${a.country}`;
              return parts.join(' - ');
            };
            routeEl.style.color = '#e2e8f0';
            routeEl.innerHTML = `
              <div><span style="color:#94a3b8">From:</span> ${fmtAirport(data.departure)}</div>
              <div><span style="color:#94a3b8">To:</span> ${fmtAirport(data.arrival)}</div>
            `;

            // Store airline name for the extra-info line
            if (data.airline?.name) {
              popupEl._airlineName = data.airline.name;
            }
            updateExtraInfo(popupEl);
          })
          .catch(() => {
            const routeEl = popupEl.querySelector('.route-info');
            if (routeEl) routeEl.remove();
          });
      }

      const updatePos = () => {
        if (detached) return;
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
// Legend uses same silhouette as SDF icon, just re-transformed for the 14×14 legend box

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
            <g transform={HELI_TRANSFORM}>
              <path d={HELI_RAW_PATH} fill="#94a3b8" stroke="none"/>
            </g>
          </svg>
          <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Helikopter' : 'Heli'}</span>
        </div>
      </div>
    </div>
  );
}
