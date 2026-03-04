import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const TRAIN_SOURCE = 'train-data';
const STATION_SOURCE = 'station-data';
const TRACK_SOURCE = 'track-data';
const LAYER_TRAIN_ICON = 'train-icon';
const LAYER_TRAIN_LABEL = 'train-label';
const LAYER_STATION_CIRCLE = 'train-station-circle';
const LAYER_STATION_LABEL = 'train-station-label';
const LAYER_TRACK_LINE = 'train-track-line';
const IMG_TRAIN = 'img-train-sdf';

const ALL_LAYERS = [LAYER_TRACK_LINE, LAYER_STATION_CIRCLE, LAYER_STATION_LABEL, LAYER_TRAIN_ICON, LAYER_TRAIN_LABEL];
const ALL_SOURCES = [TRAIN_SOURCE, STATION_SOURCE, TRACK_SOURCE];

// Top-down train silhouette SVG for SDF tinting
function createTrainSvgSdf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <rect x="18" y="4" width="12" height="40" rx="5" ry="5" fill="#ffffff"/>
    <rect x="16" y="10" width="16" height="8" rx="2" ry="2" fill="#ffffff"/>
    <rect x="16" y="30" width="16" height="8" rx="2" ry="2" fill="#ffffff"/>
    <circle cx="20" cy="6" r="2" fill="#ffffff"/>
    <circle cx="28" cy="6" r="2" fill="#ffffff"/>
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

const DELAY_COLOR = [
  'match', ['get', 'delayCategory'],
  'onTime', '#22c55e',
  'slight', '#eab308',
  'moderate', '#f97316',
  'severe', '#ef4444',
  '#94a3b8',
];

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export default function TrainLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const dataRef = useRef(data);
  const stationDataRef = useRef(null);
  const trackDataRef = useRef(null);
  const [ready, setReady] = useState(false);
  const trainsOpacity = useMapStore((s) => s.trainsOpacity);
  const imagesRef = useRef(null);

  useEffect(() => { dataRef.current = data; }, [data]);

  const removePopup = useCallback(() => {
    if (popupRef.current) {
      if (popupRef.current._cleanup) popupRef.current._cleanup();
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, []);

  const addLayers = useCallback((opacity) => {
    if (!mapRef || !imagesRef.current) return;

    if (!mapRef.hasImage(IMG_TRAIN)) {
      mapRef.addImage(IMG_TRAIN, imagesRef.current, { sdf: true });
    }

    // Sources
    if (!mapRef.getSource(TRACK_SOURCE)) {
      mapRef.addSource(TRACK_SOURCE, { type: 'geojson', data: trackDataRef.current || EMPTY_FC });
    }
    if (!mapRef.getSource(STATION_SOURCE)) {
      mapRef.addSource(STATION_SOURCE, { type: 'geojson', data: stationDataRef.current || EMPTY_FC });
    }
    if (!mapRef.getSource(TRAIN_SOURCE)) {
      mapRef.addSource(TRAIN_SOURCE, { type: 'geojson', data: EMPTY_FC });
    }

    // 1. Track lines (bottom)
    if (!mapRef.getLayer(LAYER_TRACK_LINE)) {
      mapRef.addLayer({
        id: LAYER_TRACK_LINE,
        type: 'line',
        source: TRACK_SOURCE,
        paint: {
          'line-color': '#0ea5e9',
          'line-width': 3.5,
          'line-opacity': opacity * 0.7,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    }

    // 2. Station circles
    if (!mapRef.getLayer(LAYER_STATION_CIRCLE)) {
      mapRef.addLayer({
        id: LAYER_STATION_CIRCLE,
        type: 'circle',
        source: STATION_SOURCE,
        minzoom: 8,
        paint: {
          'circle-radius': 6,
          'circle-color': '#e2e8f0',
          'circle-stroke-color': '#0ea5e9',
          'circle-stroke-width': 2,
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // 3. Station labels
    if (!mapRef.getLayer(LAYER_STATION_LABEL)) {
      mapRef.addLayer({
        id: LAYER_STATION_LABEL,
        type: 'symbol',
        source: STATION_SOURCE,
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.8,
          'text-justify': 'auto',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#94a3b8',
          'text-halo-color': '#000000',
          'text-halo-width': 1,
          'text-opacity': opacity,
        },
      });
    }

    // 4. Train icon (SDF, colored by delay)
    if (!mapRef.getLayer(LAYER_TRAIN_ICON)) {
      mapRef.addLayer({
        id: LAYER_TRAIN_ICON,
        type: 'symbol',
        source: TRAIN_SOURCE,
        layout: {
          'icon-image': IMG_TRAIN,
          'icon-size': 0.9,
          'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': DELAY_COLOR,
          'icon-halo-color': '#000000',
          'icon-halo-width': 1,
          'icon-opacity': opacity,
        },
      });
    }

    // 5. Train label
    if (!mapRef.getLayer(LAYER_TRAIN_LABEL)) {
      mapRef.addLayer({
        id: LAYER_TRAIN_LABEL,
        type: 'symbol',
        source: TRAIN_SOURCE,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#e2e8f0',
          'text-halo-color': '#000000',
          'text-halo-width': 1,
          'text-opacity': opacity,
        },
      });
    }
  }, [mapRef]);

  // Fetch static data (stations + tracks) once on mount
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const fetchStatic = async () => {
      try {
        const [stationsRes, tracksRes] = await Promise.all([
          fetch('/api/trains/stations'),
          fetch('/api/trains/tracks'),
        ]);

        if (!cancelled && stationsRes.ok) {
          const stations = await stationsRes.json();
          stationDataRef.current = stations;
          const src = mapRef.getSource(STATION_SOURCE);
          if (src) src.setData(stations);
        }

        if (!cancelled && tracksRes.ok) {
          const tracks = await tracksRes.json();
          trackDataRef.current = tracks;
          const src = mapRef.getSource(TRACK_SOURCE);
          if (src) src.setData(tracks);
        }
      } catch (err) {
        console.error('Train static data fetch error:', err);
      }
    };

    fetchStatic();
    return () => { cancelled = true; };
  }, [mapRef]);

  // Load image, create layers, handle style swaps
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const setup = async () => {
      try {
        if (!imagesRef.current) {
          const img = await loadImage(svgToDataUrl(createTrainSvgSdf()), 48);
          if (cancelled) return;
          imagesRef.current = img;
        }
        addLayers(trainsOpacity);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('TrainLayer setup error:', err);
      }
    };

    const onStyleData = () => {
      if (imagesRef.current && !mapRef.getSource(TRAIN_SOURCE)) {
        addLayers(trainsOpacity);
        if (dataRef.current) {
          const src = mapRef.getSource(TRAIN_SOURCE);
          if (src) src.setData(dataRef.current);
        }
        if (stationDataRef.current) {
          const src = mapRef.getSource(STATION_SOURCE);
          if (src) src.setData(stationDataRef.current);
        }
        if (trackDataRef.current) {
          const src = mapRef.getSource(TRACK_SOURCE);
          if (src) src.setData(trackDataRef.current);
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
      ALL_SOURCES.forEach((s) => { try { if (mapRef.getSource(s)) mapRef.removeSource(s); } catch {} });
      try { if (mapRef.hasImage(IMG_TRAIN)) mapRef.removeImage(IMG_TRAIN); } catch {}
      setReady(false);
    };
  }, [mapRef, removePopup, addLayers, trainsOpacity]);

  // Update train data
  useEffect(() => {
    if (!mapRef || !ready) return;
    const src = mapRef.getSource(TRAIN_SOURCE);
    if (src) src.setData(data || EMPTY_FC);
  }, [mapRef, data, ready]);

  // Update opacity
  useEffect(() => {
    if (!mapRef) return;
    try { if (mapRef.getLayer(LAYER_TRACK_LINE)) mapRef.setPaintProperty(LAYER_TRACK_LINE, 'line-opacity', trainsOpacity * 0.7); } catch {}
    try { if (mapRef.getLayer(LAYER_STATION_CIRCLE)) mapRef.setPaintProperty(LAYER_STATION_CIRCLE, 'circle-opacity', trainsOpacity); } catch {}
    try { if (mapRef.getLayer(LAYER_STATION_CIRCLE)) mapRef.setPaintProperty(LAYER_STATION_CIRCLE, 'circle-stroke-opacity', trainsOpacity); } catch {}
    try { if (mapRef.getLayer(LAYER_STATION_LABEL)) mapRef.setPaintProperty(LAYER_STATION_LABEL, 'text-opacity', trainsOpacity); } catch {}
    try { if (mapRef.getLayer(LAYER_TRAIN_ICON)) mapRef.setPaintProperty(LAYER_TRAIN_ICON, 'icon-opacity', trainsOpacity); } catch {}
    try { if (mapRef.getLayer(LAYER_TRAIN_LABEL)) mapRef.setPaintProperty(LAYER_TRAIN_LABEL, 'text-opacity', trainsOpacity); } catch {}
  }, [mapRef, trainsOpacity]);

  // Click handlers
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      // Check train icons first
      const trainLayers = [LAYER_TRAIN_ICON].filter((l) => { try { return !!mapRef.getLayer(l); } catch { return false; } });
      const stationLayers = [LAYER_STATION_CIRCLE].filter((l) => { try { return !!mapRef.getLayer(l); } catch { return false; } });

      let features = trainLayers.length ? mapRef.queryRenderedFeatures(e.point, { layers: trainLayers }) : [];
      let isStation = false;

      if (features.length === 0 && stationLayers.length) {
        features = mapRef.queryRenderedFeatures(e.point, { layers: stationLayers });
        isStation = features.length > 0;
      }

      removePopup();
      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();

      let html;
      if (isStation) {
        html = `
          <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:140px">
            <div style="font-weight:bold;font-size:14px;margin-bottom:2px;color:#cbd5e1">
              ${props.name || 'Unknown Station'}
            </div>
            ${props.operator ? `<div><span style="color:#94a3b8">Operator:</span> ${props.operator}</div>` : ''}
          </div>
        `;
      } else {
        const delayLabel = {
          onTime: '<span style="color:#22c55e">On time</span>',
          slight: `<span style="color:#eab308">+${Math.ceil((props.delay || 0) / 60)} min</span>`,
          moderate: `<span style="color:#f97316">+${Math.ceil((props.delay || 0) / 60)} min</span>`,
          severe: `<span style="color:#ef4444">+${Math.ceil((props.delay || 0) / 60)} min</span>`,
        };
        const statusLabel = {
          0: 'Incoming',
          1: 'At stop',
          2: 'In transit',
        };

        html = `
          <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:180px">
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px;color:#22c55e">
              ${props.label || props.id || 'Unknown'}
            </div>
            ${props.routeId ? `<div><span style="color:#94a3b8">Route:</span> ${props.routeId}</div>` : ''}
            <div><span style="color:#94a3b8">Speed:</span> ${props.speedKmh != null ? `${props.speedKmh} km/h` : 'N/A'}</div>
            ${props.bearing != null ? `<div><span style="color:#94a3b8">Bearing:</span> ${Math.round(props.bearing)}\u00b0</div>` : ''}
            <div><span style="color:#94a3b8">Delay:</span> ${props.delayCategory ? delayLabel[props.delayCategory] : '<span style="color:#64748b">No data</span>'}</div>
            <div><span style="color:#94a3b8">Status:</span> ${statusLabel[props.currentStatus] ?? 'Unknown'}</div>
            ${props.timestamp ? `<div style="color:#64748b;font-size:10px;margin-top:2px">Updated: ${new Date(props.timestamp * 1000).toLocaleTimeString()}</div>` : ''}
          </div>
        `;
      }

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-width:280px;overflow:hidden">
          <div class="popup-drag-handle" style="height:28px;cursor:grab;background:#334155;display:flex;align-items:center;justify-content:center;border-radius:8px 8px 0 0;touch-action:none">
            <div style="width:40px;height:4px;background:#64748b;border-radius:2px"></div>
          </div>
          <div style="padding:10px 12px;position:relative">
            <button class="popup-close-btn" style="position:absolute;top:0;right:4px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:4px 8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:4px">\u00d7</button>
            ${html}
          </div>
        </div>
      `;

      popupEl.querySelector('.popup-close-btn').addEventListener('click', () => removePopup());

      const closeBtn = popupEl.querySelector('.popup-close-btn');
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#475569'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none'; });

      const point = mapRef.project(coords);
      popupEl.style.left = `${point.x}px`;
      popupEl.style.top = `${point.y - 10}px`;
      popupEl.style.transform = 'translate(-50%, -100%)';

      mapRef.getContainer().appendChild(popupEl);
      popupRef.current = popupEl;

      // Drag logic
      let detached = false;
      const handle = popupEl.querySelector('.popup-drag-handle');

      const onMouseDown = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handle.style.cursor = 'grabbing';
        const startX = ev.clientX;
        const startY = ev.clientY;
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

        const onMouseMove = (e2) => {
          popupEl.style.left = `${startLeft + e2.clientX - startX}px`;
          popupEl.style.top = `${startTop + e2.clientY - startY}px`;
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

      // Touch drag
      const onTouchStart = (te) => {
        te.preventDefault();
        te.stopPropagation();
        const touch = te.touches[0];
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
        const onTouchMove = (ev2) => {
          const t = ev2.touches[0];
          popupEl.style.left = `${startLeft + t.clientX - startX}px`;
          popupEl.style.top = `${startTop + t.clientY - startY}px`;
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
    const clickableLayers = [LAYER_TRAIN_ICON, LAYER_STATION_CIRCLE];
    clickableLayers.forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.on('mouseenter', l, onEnter);
          mapRef.on('mouseleave', l, onLeave);
        }
      } catch {}
    });

    return () => {
      mapRef.off('click', handleClick);
      clickableLayers.forEach((l) => {
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
const DELAY_ITEMS = [
  { color: '#22c55e', no: 'I rute', en: 'On time' },
  { color: '#eab308', no: '1-5 min', en: '1-5 min' },
  { color: '#f97316', no: '5-15 min', en: '5-15 min' },
  { color: '#ef4444', no: '>15 min', en: '>15 min' },
];

export function TrainLegend({ count }) {
  const lang = useMapStore((s) => s.lang);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {lang === 'no' ? 'Tog' : 'Trains'}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>

      {/* Delay colors */}
      <div className="mb-1">
        <div className="text-slate-500 text-[9px] mb-0.5">{lang === 'no' ? 'Forsinkelse' : 'Delay'}</div>
        <div className="flex gap-2">
          {DELAY_ITEMS.map((item) => (
            <div key={item.en} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-slate-500 text-[9px]">{lang === 'no' ? item.no : item.en}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Icon indicators */}
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-slate-300 border border-slate-500" />
          <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Stasjon' : 'Station'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-4 bg-slate-500 rounded-sm" />
          <span className="text-slate-400 text-[10px]">{lang === 'no' ? 'Spor' : 'Track'}</span>
        </div>
      </div>
    </div>
  );
}
