import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const TRAFFIC_SOURCE = 'traffic-data';
const LAYER_CIRCLE = 'traffic-circle';
const LAYER_ICON = 'traffic-icon';
const LAYER_PULSE = 'traffic-pulse';

const ALL_LAYERS = [LAYER_PULSE, LAYER_CIRCLE, LAYER_ICON];

// Map incident types to colors
const TYPE_COLORS = {
  roadworks: '#f97316', // orange
  roadClosed: '#ef4444', // red
  accident: '#dc2626', // bright red
  obstruction: '#eab308', // yellow
  conditions: '#3b82f6', // blue
  default: '#a855f7', // purple
};

// Get color for incident type
function getTypeColor(type) {
  if (!type) return TYPE_COLORS.default;
  const lowerType = type.toLowerCase();
  if (lowerType.includes('roadworks') || lowerType.includes('construction') || lowerType.includes('maintenance')) {
    return TYPE_COLORS.roadworks;
  }
  if (lowerType.includes('closed') || lowerType.includes('steng')) {
    return TYPE_COLORS.roadClosed;
  }
  if (lowerType.includes('accident') || lowerType.includes('ulykke')) {
    return TYPE_COLORS.accident;
  }
  if (lowerType.includes('obstruction') || lowerType.includes('hinder')) {
    return TYPE_COLORS.obstruction;
  }
  if (lowerType.includes('condition') || lowerType.includes('weather') || lowerType.includes('snow') || lowerType.includes('ice')) {
    return TYPE_COLORS.conditions;
  }
  return TYPE_COLORS.default;
}

// MapLibre expression for type-based coloring
const TYPE_COLOR_EXPR = [
  'case',
  ['any',
    ['in', 'roadworks', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'construction', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'maintenance', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ],
  TYPE_COLORS.roadworks,
  ['any',
    ['in', 'closed', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'steng', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ],
  TYPE_COLORS.roadClosed,
  ['any',
    ['in', 'accident', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'ulykke', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ],
  TYPE_COLORS.accident,
  ['any',
    ['in', 'obstruction', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'hinder', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ],
  TYPE_COLORS.obstruction,
  ['any',
    ['in', 'condition', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'weather', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'snow', ['downcase', ['coalesce', ['get', 'type'], '']]],
    ['in', 'ice', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ],
  TYPE_COLORS.conditions,
  TYPE_COLORS.default,
];

// Check if type is accident (for pulsing)
const IS_ACCIDENT_EXPR = ['any',
  ['in', 'accident', ['downcase', ['coalesce', ['get', 'type'], '']]],
  ['in', 'ulykke', ['downcase', ['coalesce', ['get', 'type'], '']]],
];

function formatTime(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    return d.toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return null;
  }
}

export default function TrafficLayer({ data, mapRef }) {
  const popupRef = useRef(null);
  const dataRef = useRef(data);
  const [ready, setReady] = useState(false);
  const trafficOpacity = useMapStore((s) => s.trafficOpacity);
  const lang = useMapStore((s) => s.lang);

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

    if (!mapRef.getSource(TRAFFIC_SOURCE)) {
      mapRef.addSource(TRAFFIC_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // Highlight ring for accidents (larger, semi-transparent)
    if (!mapRef.getLayer(LAYER_PULSE)) {
      mapRef.addLayer({
        id: LAYER_PULSE,
        type: 'circle',
        source: TRAFFIC_SOURCE,
        filter: IS_ACCIDENT_EXPR,
        paint: {
          'circle-radius': 16,
          'circle-color': 'transparent',
          'circle-stroke-color': TYPE_COLORS.accident,
          'circle-stroke-width': 3,
          'circle-stroke-opacity': 0.6,
        },
      });
    }

    // Main circle marker
    if (!mapRef.getLayer(LAYER_CIRCLE)) {
      mapRef.addLayer({
        id: LAYER_CIRCLE,
        type: 'circle',
        source: TRAFFIC_SOURCE,
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'severity'], 'high'], 10,
            8,
          ],
          'circle-color': TYPE_COLOR_EXPR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      });
    }

    // Icon layer with symbols
    if (!mapRef.getLayer(LAYER_ICON)) {
      mapRef.addLayer({
        id: LAYER_ICON,
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        layout: {
          'text-field': [
            'case',
            ['any',
              ['in', 'roadworks', ['downcase', ['coalesce', ['get', 'type'], '']]],
              ['in', 'construction', ['downcase', ['coalesce', ['get', 'type'], '']]],
              ['in', 'maintenance', ['downcase', ['coalesce', ['get', 'type'], '']]],
            ],
            '\u26A0', // Warning triangle
            ['any',
              ['in', 'closed', ['downcase', ['coalesce', ['get', 'type'], '']]],
              ['in', 'steng', ['downcase', ['coalesce', ['get', 'type'], '']]],
            ],
            '\u2715', // X
            ['any',
              ['in', 'accident', ['downcase', ['coalesce', ['get', 'type'], '']]],
              ['in', 'ulykke', ['downcase', ['coalesce', ['get', 'type'], '']]],
            ],
            '!',
            '?',
          ],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': opacity,
        },
      });
    }
  }, [mapRef]);

  // Setup layers and re-add after style swaps
  useEffect(() => {
    if (!mapRef) return;
    let cancelled = false;

    const setup = () => {
      addLayers(trafficOpacity);
      if (!cancelled) setReady(true);
    };

    const onStyleData = () => {
      if (!mapRef.getSource(TRAFFIC_SOURCE)) {
        addLayers(trafficOpacity);
        if (dataRef.current) {
          const src = mapRef.getSource(TRAFFIC_SOURCE);
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
      ALL_LAYERS.forEach((l) => { try { if (mapRef.getLayer(l)) mapRef.removeLayer(l); } catch { /* ignore */ } });
      try { if (mapRef.getSource(TRAFFIC_SOURCE)) mapRef.removeSource(TRAFFIC_SOURCE); } catch { /* ignore */ }
      setReady(false);
    };
  }, [mapRef, removePopup, addLayers, trafficOpacity]);

  // Update data source when data changes
  useEffect(() => {
    if (!mapRef || !ready) return;
    const src = mapRef.getSource(TRAFFIC_SOURCE);
    if (src) {
      // Convert LineString geometries to Point (use first coordinate)
      const pointData = data ? {
        ...data,
        features: (data.features || []).map((f) => {
          if (f.geometry?.type === 'LineString' && f.geometry.coordinates?.length > 0) {
            return {
              ...f,
              geometry: {
                type: 'Point',
                coordinates: f.geometry.coordinates[0],
              },
            };
          }
          return f;
        }),
      } : { type: 'FeatureCollection', features: [] };
      src.setData(pointData);
    }
  }, [mapRef, data, ready]);

  // Update opacity
  useEffect(() => {
    if (!mapRef) return;
    try {
      if (mapRef.getLayer(LAYER_CIRCLE)) {
        mapRef.setPaintProperty(LAYER_CIRCLE, 'circle-opacity', trafficOpacity);
        mapRef.setPaintProperty(LAYER_CIRCLE, 'circle-stroke-opacity', trafficOpacity);
      }
      if (mapRef.getLayer(LAYER_ICON)) {
        mapRef.setPaintProperty(LAYER_ICON, 'text-opacity', trafficOpacity);
      }
    } catch { /* ignore */ }
  }, [mapRef, trafficOpacity]);

  // Click handler for popups
  useEffect(() => {
    if (!mapRef) return;

    const handleClick = (e) => {
      const activeLayers = [LAYER_CIRCLE, LAYER_ICON].filter((l) => {
        try { return !!mapRef.getLayer(l); } catch { return false; }
      });
      if (activeLayers.length === 0) return;

      const features = mapRef.queryRenderedFeatures(e.point, { layers: activeLayers });

      removePopup();
      if (features.length === 0) return;

      const props = features[0].properties;
      const coords = features[0].geometry.coordinates.slice();
      const typeColor = getTypeColor(props.type);

      const startTime = formatTime(props.startTime);
      const endTime = formatTime(props.endTime);

      const html = `
        <div style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;min-width:220px;max-width:320px">
          <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${typeColor}">
            ${props.type || (lang === 'no' ? 'Trafikkhendelse' : 'Traffic incident')}
          </div>
          ${props.road ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Veg:' : 'Road:'}</span> ${props.road}</div>` : ''}
          ${props.location ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Sted:' : 'Location:'}</span> ${props.location}</div>` : ''}
          ${props.description ? `<div style="margin-top:6px;color:#e2e8f0;word-wrap:break-word">${props.description}</div>` : ''}
          ${props.severity === 'high' ? `<div style="margin-top:6px;color:#ef4444;font-weight:bold">${lang === 'no' ? 'Alvorlig' : 'Severe'}</div>` : ''}
          ${startTime ? `<div style="margin-top:6px"><span style="color:#94a3b8">${lang === 'no' ? 'Fra:' : 'From:'}</span> ${startTime}</div>` : ''}
          ${endTime ? `<div><span style="color:#94a3b8">${lang === 'no' ? 'Til:' : 'To:'}</span> ${endTime}</div>` : ''}
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'position:absolute;z-index:50;pointer-events:auto';
      popupEl.innerHTML = `
        <div style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);overflow:hidden">
          <div class="popup-drag-handle" style="height:24px;cursor:grab;background:#334155;display:flex;align-items:center;justify-content:center;border-radius:8px 8px 0 0;touch-action:none">
            <div style="width:40px;height:4px;background:#64748b;border-radius:2px"></div>
          </div>
          <div style="padding:10px 12px;position:relative">
            <button class="popup-close-btn" style="position:absolute;top:0px;right:4px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:4px 8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:4px">\u00d7</button>
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

      // Drag logic
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

      // Touch support
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

        const onTouchMove = (ev) => {
          const t = ev.touches[0];
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          popupEl.style.left = `${startLeft + dx}px`;
          popupEl.style.top = `${startTop + dy}px`;
        };

        const onTouchEnd = () => {
          mapRef.dragPan.enable();
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
        };

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
      };

      handle.addEventListener('touchstart', onTouchStart, { passive: false });

      // Hover effect
      const closeBtn = popupEl.querySelector('.popup-close-btn');
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#475569'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none'; });

      const updatePos = () => {
        if (detached) return;
        try {
          const p = mapRef.project(coords);
          popupEl.style.left = `${p.x}px`;
          popupEl.style.top = `${p.y - 10}px`;
        } catch { /* ignore */ }
      };
      mapRef.on('move', updatePos);
      popupEl._cleanup = () => mapRef.off('move', updatePos);
    };

    mapRef.on('click', handleClick);

    const onEnter = () => { mapRef.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { mapRef.getCanvas().style.cursor = ''; };
    [LAYER_CIRCLE, LAYER_ICON].forEach((l) => {
      try {
        if (mapRef.getLayer(l)) {
          mapRef.on('mouseenter', l, onEnter);
          mapRef.on('mouseleave', l, onLeave);
        }
      } catch { /* ignore */ }
    });

    return () => {
      mapRef.off('click', handleClick);
      [LAYER_CIRCLE, LAYER_ICON].forEach((l) => {
        try {
          mapRef.off('mouseenter', l, onEnter);
          mapRef.off('mouseleave', l, onLeave);
        } catch { /* ignore */ }
      });
      removePopup();
    };
  }, [mapRef, removePopup, lang]);

  return null;
}

export function TrafficLegend({ count }) {
  const lang = useMapStore((s) => s.lang);

  const items = [
    { type: 'roadworks', color: TYPE_COLORS.roadworks, no: 'Vegarbeid', en: 'Road works' },
    { type: 'roadClosed', color: TYPE_COLORS.roadClosed, no: 'Stengt veg', en: 'Road closed' },
    { type: 'accident', color: TYPE_COLORS.accident, no: 'Ulykke', en: 'Accident' },
    { type: 'obstruction', color: TYPE_COLORS.obstruction, no: 'Hindring', en: 'Obstruction' },
    { type: 'conditions', color: TYPE_COLORS.conditions, no: 'Forhold', en: 'Conditions' },
    { type: 'other', color: TYPE_COLORS.default, no: 'Annet', en: 'Other' },
  ];

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 font-semibold text-[10px] uppercase tracking-wide mb-1.5">
        {t('layer.traffic', lang)}
        {count != null && <span className="ml-1 text-slate-500">({count})</span>}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <div key={item.type} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full border border-white/50"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-slate-400 text-[10px]">{lang === 'no' ? item.no : item.en}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
