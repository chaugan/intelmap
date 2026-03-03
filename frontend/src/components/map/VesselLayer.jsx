import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const VESSEL_SOURCE = 'vessel-data';
const LAYER_RING = 'vessel-highlight-ring';
const LAYER_ICON = 'vessel-icon';
const IMG_SHIP = 'img-ship-sdf';

const TRACE_SOURCE = 'vessel-trace';
const TRACE_LAYER = 'vessel-trace-line';

const SYMBOL_LAYERS = [LAYER_ICON];
const ALL_LAYERS = [LAYER_RING, LAYER_ICON];
const ALL_IMAGES = [IMG_SHIP];

// Top-down ship silhouette — pointed bow, flat stern, white fill for SDF tinting
function createShipSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <path d="M24 4 L19 16 L17 18 L17 38 L19 40 L29 40 L31 38 L31 18 L29 16 Z" fill="#ffffff" stroke="none"/>
  </svg>`;
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadImage(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Color by vessel type category (MapLibre match expression)
const TYPE_COLOR = [
  'match',
  ['get', 'shipTypeCategory'],
  'Cargo', '#22c55e',
  'Tanker', '#ef4444',
  'Passenger', '#3b82f6',
  'Fishing', '#f97316',
  'High-speed', '#eab308',
  'Sailing/Pleasure', '#a855f7',
  '#737373', // default: Other
];

function formatSpeed(kts) {
  if (kts == null) return 'N/A';
  const kmh = Math.round(kts * 1.852);
  return `${kts.toFixed(1)} kts (${kmh} km/h)`;
}

function formatDimensions(length, width) {
  if (length == null && width == null) return null;
  const parts = [];
  if (length != null) parts.push(`${length}m`);
  if (width != null) parts.push(`${width}m`);
  return parts.join(' × ');
}

function removeTrace(map) {
  try { if (map.getLayer(TRACE_LAYER)) map.removeLayer(TRACE_LAYER); } catch {}
  try { if (map.getSource(TRACE_SOURCE)) map.removeSource(TRACE_SOURCE); } catch {}
}

async function fetchAndDrawTrace(map, mmsi, currentCoords) {
  try {
    const res = await fetch(`/api/ais/trace/${mmsi}`);
    if (!res.ok) return null;
    const geojson = await res.json();
    if (!geojson.geometry?.coordinates?.length) return null;

    // Historical data from BarentsWatch comes newest-first; reverse to oldest-first
    // so the gradient (cyan→red) correctly shows oldest→newest
    geojson.geometry.coordinates.reverse();

    // Append vessel's current live position so the line connects to the icon
    if (currentCoords) {
      geojson.geometry.coordinates.push(currentCoords);
    }

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
    }, LAYER_RING);

    return geojson;
  } catch (err) {
    console.error('Failed to fetch vessel trace:', err);
    return null;
  }
}

export default function VesselLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const dataRef = useRef(data);
  const [ready, setReady] = useState(false);
  const vesselsOpacity = useMapStore((s) => s.vesselsOpacity);
  const focusedVesselMmsi = useMapStore((s) => s.focusedVesselMmsi);
  const setFocusedVessel = useMapStore((s) => s.setFocusedVessel);
  const hiddenCategories = useMapStore((s) => s.hiddenVesselCategories);

  useEffect(() => { dataRef.current = data; }, [data]);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
    if (mapRef && !useMapStore.getState().focusedVesselMmsi) removeTrace(mapRef);
  }, [mapRef]);

  const imagesRef = useRef(null);

  const addLayers = useCallback((opacity) => {
    if (!mapRef || !imagesRef.current) return;
    const { shipImg } = imagesRef.current;

    if (!mapRef.hasImage(IMG_SHIP)) mapRef.addImage(IMG_SHIP, shipImg, { sdf: true });

    if (!mapRef.getSource(VESSEL_SOURCE)) {
      mapRef.addSource(VESSEL_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // Red circle ring for military or law enforcement
    if (!mapRef.getLayer(LAYER_RING)) {
      mapRef.addLayer({
        id: LAYER_RING,
        type: 'circle',
        source: VESSEL_SOURCE,
        filter: ['any',
          ['to-boolean', ['get', 'military']],
          ['to-boolean', ['get', 'lawEnforcement']],
        ],
        paint: {
          'circle-radius': 28,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ef4444',
          'circle-stroke-width': 2.5,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // Ship icon layer
    if (!mapRef.getLayer(LAYER_ICON)) {
      mapRef.addLayer({
        id: LAYER_ICON,
        type: 'symbol',
        source: VESSEL_SOURCE,
        layout: {
          'icon-image': IMG_SHIP,
          'icon-size': ['case',
            ['any', ['to-boolean', ['get', 'military']], ['to-boolean', ['get', 'lawEnforcement']]],
            1.1,
            0.9,
          ],
          'icon-rotate': ['coalesce', ['get', 'trueHeading'], ['get', 'courseOverGround'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': TYPE_COLOR,
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
          const shipImg = await loadImage(svgToDataUrl(createShipSvgSdf()), 48);
          if (cancelled) return;
          imagesRef.current = { shipImg };
        }

        addLayers(vesselsOpacity);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('VesselLayer setup error:', err);
      }
    };

    const onStyleData = () => {
      if (imagesRef.current && !mapRef.getSource(VESSEL_SOURCE)) {
        addLayers(vesselsOpacity);
        if (dataRef.current) {
          const src = mapRef.getSource(VESSEL_SOURCE);
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
      try { if (mapRef.getSource(VESSEL_SOURCE)) mapRef.removeSource(VESSEL_SOURCE); } catch {}
      ALL_IMAGES.forEach((i) => { try { if (mapRef.hasImage(i)) mapRef.removeImage(i); } catch {} });
      setReady(false);
    };
  }, [mapRef, removePopup, addLayers, vesselsOpacity]);

  // Update data source when data changes
  useEffect(() => {
    if (!mapRef || !ready) return;
    const src = mapRef.getSource(VESSEL_SOURCE);
    if (src) {
      src.setData(data || { type: 'FeatureCollection', features: [] });
    }
  }, [mapRef, data, ready]);

  // Update opacity on all layers
  useEffect(() => {
    if (!mapRef) return;
    SYMBOL_LAYERS.forEach((l) => {
      try { if (mapRef.getLayer(l)) mapRef.setPaintProperty(l, 'icon-opacity', vesselsOpacity); } catch {}
    });
    try { if (mapRef.getLayer(LAYER_RING)) mapRef.setPaintProperty(LAYER_RING, 'circle-stroke-opacity', vesselsOpacity); } catch {}
  }, [mapRef, vesselsOpacity]);

  // Dynamic MapLibre filters for focus mode and category hiding
  useEffect(() => {
    if (!mapRef) return;
    const focused = focusedVesselMmsi;

    // Build category filter - exclude hidden categories
    const categoryFilter = hiddenCategories.length > 0
      ? ['!', ['in', ['get', 'shipTypeCategory'], ['literal', hiddenCategories]]]
      : null;

    if (focused) {
      const mmsiMatch = ['==', ['to-string', ['get', 'mmsi']], focused];
      const focusFilter = categoryFilter ? ['all', mmsiMatch, categoryFilter] : mmsiMatch;
      try {
        if (mapRef.getLayer(LAYER_ICON))
          mapRef.setFilter(LAYER_ICON, focusFilter);
        if (mapRef.getLayer(LAYER_RING))
          mapRef.setFilter(LAYER_RING, ['all',
            ['any', ['to-boolean', ['get', 'military']], ['to-boolean', ['get', 'lawEnforcement']]],
            focusFilter,
          ]);
      } catch {}
    } else {
      // Apply category filter only
      try {
        if (mapRef.getLayer(LAYER_ICON))
          mapRef.setFilter(LAYER_ICON, categoryFilter);
        if (mapRef.getLayer(LAYER_RING))
          mapRef.setFilter(LAYER_RING, categoryFilter
            ? ['all',
                ['any', ['to-boolean', ['get', 'military']], ['to-boolean', ['get', 'lawEnforcement']]],
                categoryFilter,
              ]
            : ['any',
                ['to-boolean', ['get', 'military']],
                ['to-boolean', ['get', 'lawEnforcement']],
              ]);
      } catch {}
    }
  }, [mapRef, focusedVesselMmsi, hiddenCategories]);

  // Continuous trace refresh when focused
  useEffect(() => {
    if (!mapRef || !focusedVesselMmsi) return;
    let intervalId = null;
    let cancelled = false;

    const refreshTrace = () => {
      const mmsi = focusedVesselMmsi;
      let currentCoords = null;
      const features = dataRef.current?.features;
      if (features) {
        const f = features.find((ft) => String(ft.properties?.mmsi) === mmsi);
        if (f) currentCoords = f.geometry.coordinates;
      }
      fetchAndDrawTrace(mapRef, mmsi, currentCoords);
    };

    refreshTrace();
    intervalId = setInterval(() => {
      if (!cancelled) refreshTrace();
    }, 30000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      removeTrace(mapRef);
    };
  }, [mapRef, focusedVesselMmsi]);

  // Click handler for popups
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
      const isLaw = props.lawEnforcement === true || props.lawEnforcement === 'true';

      const titleColor = isMil ? '#f59e0b' : isLaw ? '#ef4444' : '#fff';
      const title = props.name || `MMSI ${props.mmsi}`;
      const dims = formatDimensions(props.shipLength, props.shipWidth);

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:200px">
          <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:${titleColor}">
            ${title}
            ${isMil ? ' <span style="font-size:10px;background:#78350f;padding:1px 4px;border-radius:3px">MIL</span>' : ''}
            ${isLaw ? ' <span style="font-size:10px;background:#7f1d1d;padding:1px 4px;border-radius:3px">LAW</span>' : ''}
          </div>
          <div><span style="color:#94a3b8">MMSI:</span> ${props.mmsi}</div>
          ${props.imoNumber ? `<div><span style="color:#94a3b8">IMO:</span> ${props.imoNumber}</div>` : ''}
          ${props.callSign ? `<div><span style="color:#94a3b8">Callsign:</span> ${props.callSign}</div>` : ''}
          <div><span style="color:#94a3b8">Type:</span> ${props.shipTypeCategory}${props.shipType != null ? ` (${props.shipType})` : ''}</div>
          ${props.countryCode ? `<div><span style="color:#94a3b8">Flag:</span> ${props.countryCode}</div>` : ''}
          <div><span style="color:#94a3b8">Speed:</span> ${formatSpeed(props.speedOverGround)}</div>
          <div><span style="color:#94a3b8">Course:</span> ${props.courseOverGround != null ? `${props.courseOverGround.toFixed(1)}°` : 'N/A'}</div>
          <div><span style="color:#94a3b8">Heading:</span> ${props.trueHeading != null ? `${props.trueHeading}°` : 'N/A'}</div>
          <div><span style="color:#94a3b8">Nav Status:</span> ${props.navStatusText || 'N/A'}</div>
          ${props.destination ? `<div><span style="color:#94a3b8">Destination:</span> ${props.destination}</div>` : ''}
          ${props.eta ? `<div><span style="color:#94a3b8">ETA:</span> ${props.eta}</div>` : ''}
          ${props.draught != null ? `<div><span style="color:#94a3b8">Draught:</span> ${props.draught}m</div>` : ''}
          ${dims ? `<div><span style="color:#94a3b8">Dimensions:</span> ${dims}</div>` : ''}
          ${props.imoNumber ? `<div style="margin-top:6px"><a href="https://www.vesselfinder.com/vessels/details/${props.imoNumber}" target="_blank" rel="noopener" style="color:#22d3ee;text-decoration:none;font-size:11px">View on VesselFinder &nearr;</a></div>` : ''}
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:300px;overflow:hidden">
          <div class="popup-drag-handle" style="height:28px;cursor:grab;background:#334155;display:flex;align-items:center;justify-content:center;border-radius:8px 8px 0 0;touch-action:none">
            <div style="width:40px;height:4px;background:#64748b;border-radius:2px"></div>
          </div>
          <div style="padding:10px 12px;position:relative">
            <div style="position:absolute;top:0px;right:4px;display:flex;gap:2px">
              <button class="popup-analysis-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:11px;padding:4px 8px;height:32px;display:flex;align-items:center;gap:3px;border-radius:4px;white-space:nowrap">\u{1F4CA} Analyze</button>
              <button class="popup-focus-btn" style="background:${useMapStore.getState().focusedVesselMmsi === String(props.mmsi) ? '#0ea5e9' : 'none'};border:none;color:${useMapStore.getState().focusedVesselMmsi === String(props.mmsi) ? '#fff' : '#94a3b8'};cursor:pointer;font-size:11px;padding:4px 8px;height:32px;display:flex;align-items:center;gap:3px;border-radius:4px;white-space:nowrap">${useMapStore.getState().focusedVesselMmsi === String(props.mmsi) ? '\u2299 Focused' : '\u2295 Focus'}</button>
              <button class="popup-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:4px 8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:4px">\u00d7</button>
            </div>
            ${html}
            <div class="trace-status" style="color:#64748b;font-size:10px;margin-top:4px">Loading trace...</div>
          </div>
        </div>
      `;

      popupEl.querySelector('.popup-close-btn').addEventListener('click', () => removePopup());

      // Wire focus button
      const mmsiStr = String(props.mmsi);
      const focusBtn = popupEl.querySelector('.popup-focus-btn');
      focusBtn.addEventListener('click', () => {
        const current = useMapStore.getState().focusedVesselMmsi;
        const isNowFocused = current === mmsiStr;
        setFocusedVessel(isNowFocused ? null : mmsiStr);
        focusBtn.style.background = isNowFocused ? 'none' : '#0ea5e9';
        focusBtn.style.color = isNowFocused ? '#94a3b8' : '#fff';
        focusBtn.textContent = isNowFocused ? '\u2295 Focus' : '\u2299 Focused';
      });
      focusBtn.addEventListener('mouseenter', () => {
        if (useMapStore.getState().focusedVesselMmsi !== mmsiStr) focusBtn.style.background = '#475569';
      });
      focusBtn.addEventListener('mouseleave', () => {
        if (useMapStore.getState().focusedVesselMmsi !== mmsiStr) focusBtn.style.background = 'none';
      });

      // Wire Deep Analysis button
      const analysisBtn = popupEl.querySelector('.popup-analysis-btn');
      analysisBtn.addEventListener('click', async () => {
        analysisBtn.textContent = '...';
        analysisBtn.disabled = true;
        try {
          const traceRes = await fetch(`/api/ais/trace/${props.mmsi}`);
          if (!traceRes.ok) throw new Error('Failed to fetch trace');
          const traceData = await traceRes.json();
          useMapStore.getState().setVesselDeepAnalysis({
            mmsi: props.mmsi,
            vessel: props,
            traceData,
          });
          removePopup();
        } catch (err) {
          console.error('Deep analysis error:', err);
          analysisBtn.textContent = '\u{1F4CA} Analyze';
          analysisBtn.disabled = false;
        }
      });
      analysisBtn.addEventListener('mouseenter', () => { analysisBtn.style.background = '#475569'; });
      analysisBtn.addEventListener('mouseleave', () => { analysisBtn.style.background = 'none'; });

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
      if (props.mmsi) {
        fetchAndDrawTrace(mapRef, String(props.mmsi), coords).then(() => {
          const statusEl = popupEl.querySelector('.trace-status');
          if (statusEl) statusEl.remove();
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

// Ship silhouette path for legend
const SHIP_PATH = 'M24 4 L19 16 L17 18 L17 38 L19 40 L29 40 L31 38 L31 18 L29 16 Z';

const VESSEL_CATEGORIES = [
  { category: 'Cargo', color: '#22c55e' },
  { category: 'Tanker', color: '#ef4444' },
  { category: 'Passenger', color: '#3b82f6' },
  { category: 'Fishing', color: '#f97316' },
  { category: 'High-speed', color: '#eab308' },
  { category: 'Sailing/Pleasure', color: '#a855f7' },
  { category: 'Other', color: '#737373' },
];

export function VesselLegend({ count }) {
  const lang = useMapStore((s) => s.lang);
  const hiddenCategories = useMapStore((s) => s.hiddenVesselCategories);
  const toggleCategory = useMapStore((s) => s.toggleVesselCategory);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {lang === 'no' ? 'Fart\u00f8y' : 'Vessels'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>

      {/* Type color swatches - clickable */}
      <div className="space-y-0.5">
        {VESSEL_CATEGORIES.map((item) => {
          const hidden = hiddenCategories.includes(item.category);
          return (
            <button
              key={item.category}
              onClick={() => toggleCategory(item.category)}
              className={`flex items-center gap-1.5 w-full text-left transition-opacity cursor-pointer ${hidden ? 'opacity-30' : ''}`}
              title={hidden ? (lang === 'no' ? 'Klikk for å vise' : 'Click to show') : (lang === 'no' ? 'Klikk for å skjule' : 'Click to hide')}
            >
              <svg width="12" height="12" viewBox="0 0 48 48">
                <path d={SHIP_PATH} fill={item.color} stroke="none"/>
              </svg>
              <span className="text-slate-400 text-[10px]">{item.category}</span>
            </button>
          );
        })}
      </div>

      {/* Military/Law ring indicator */}
      <div className="flex items-center gap-1 mt-1 pt-1 border-t border-slate-700">
        <svg width="14" height="14" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="18" fill="none" stroke="#ef4444" strokeWidth="3"/>
          <path d={SHIP_PATH} fill="#94a3b8" stroke="none" transform="scale(0.6) translate(16,16)"/>
        </svg>
        <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Milit\u00e6r / Kystvakt' : 'Military / Law Enf.'}</span>
      </div>
    </div>
  );
}
