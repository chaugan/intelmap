import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useInfrastructure } from '../../hooks/useInfrastructure.js';

const OFM_EXTRUSION_LAYER = 'openmaptiles-3d-buildings';

// Color scheme by layer
const LAYER_COLORS = {
  '66kv': '#eab308', '110kv': '#f97316', '132kv': '#f97316', '220kv': '#ef4444',
  '300kv': '#a855f7', '420kv': '#991b1b', 'distribution': '#84cc16',
  'powerlines': '#facc15', 'subsea_power': '#06b6d4', 'transformator': '#f59e0b',
  'eroad': '#3b82f6', 'rail': '#6b7280', 'rail_station': '#ef4444',
  'rail_substation': '#f97316', 'rail_filtered': '#9ca3af', 'railway_bridge': '#78716c',
  'ferry': '#0ea5e9', 'ferry_rail': '#0284c7',
  'fiber': '#a78bfa', 'radiotowers2': '#f43f5e', 'radar': '#ec4899',
  'airport': '#6366f1', 'lufthinder': '#ef4444',
  'military': '#22c55e',
  'hydro': '#0ea5e9', 'wind': '#10b981', 'oil_gas_chem': '#f59e0b',
  'pipes': '#a855f7', 'tilfluktsrom': '#14b8a6',
};

const LAYER_TYPES = {
  '66kv': 'line', '110kv': 'line', '132kv': 'line', '220kv': 'line',
  '300kv': 'line', '420kv': 'line', 'distribution': 'line', 'powerlines': 'line',
  'subsea_power': 'line', 'transformator': 'point',
  'eroad': 'line', 'rail': 'line', 'rail_station': 'point', 'rail_substation': 'point',
  'rail_filtered': 'line', 'railway_bridge': 'line', 'ferry': 'line', 'ferry_rail': 'line',
  'fiber': 'line', 'radiotowers2': 'point', 'radar': 'point',
  'airport': 'polygon', 'lufthinder': 'point',
  'military': 'polygon',
  'hydro': 'point', 'wind': 'point', 'oil_gas_chem': 'point',
  'pipes': 'line', 'tilfluktsrom': 'point',
};

const CATEGORIES = {
  power:     { no: 'Strømnett', en: 'Power Grid' },
  transport: { no: 'Transport', en: 'Transport' },
  telecom:   { no: 'Telekom', en: 'Telecom' },
  aviation:  { no: 'Luftfart', en: 'Aviation' },
  military:  { no: 'Militært', en: 'Military' },
  energy:    { no: 'Energi', en: 'Energy' },
  other:     { no: 'Annet', en: 'Other' },
};

const CATEGORY_ORDER = ['power', 'transport', 'telecom', 'aviation', 'military', 'energy', 'other'];

// Properties to skip in metadata popup
const SKIP_PROPS = new Set(['@id', 'id', 'ogc_fid', 'gml_id', 'fid']);

function buildPopupHtml(props, layerName) {
  const name = props.Name || props.name || props.NAME || props.navn || '';
  const rows = [];

  for (const [key, val] of Object.entries(props)) {
    if (SKIP_PROPS.has(key)) continue;
    if (val === null || val === undefined || val === '') continue;
    if (key === 'Name' || key === 'name' || key === 'NAME' || key === 'navn') continue;
    // Clean key: replace underscores, capitalize
    const label = key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const displayVal = typeof val === 'string' && val.length > 80 ? val.slice(0, 80) + '...' : val;
    rows.push(`<tr><td style="color:#94a3b8;padding-right:8px;white-space:nowrap;vertical-align:top">${label}</td><td>${displayVal}</td></tr>`);
  }

  const color = LAYER_COLORS[layerName] || '#94a3b8';
  return `
    <div style="font-size:12px;color:#e2e8f0;max-width:300px">
      <div style="font-weight:600;margin-bottom:4px;border-bottom:2px solid ${color};padding-bottom:3px">
        ${name || layerName}
      </div>
      ${rows.length > 0 ? `<table style="font-size:11px;border-collapse:collapse">${rows.join('')}</table>` : ''}
    </div>
  `;
}

export default function InfrastructureLayer({ mapRef }) {
  const infraVisible = useMapStore((s) => s.infraVisible);
  const infraOpacity = useMapStore((s) => s.infraOpacity);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const user = useAuthStore((s) => s.user);
  const canView = user?.infraviewEnabled || user?.role === 'admin';

  const { layerData } = useInfrastructure(infraVisible && canView);
  const addedLayersRef = useRef(new Set());
  const popupRef = useRef(null);

  // Helper to get map instance
  const getMap = useCallback(() => mapRef?.getMap?.() || mapRef, [mapRef]);

  // Remove a single infra layer + outline + source from map
  const removeLayer = useCallback((map, name) => {
    try { if (map.getLayer(`infra-${name}-outline`)) map.removeLayer(`infra-${name}-outline`); } catch {}
    try { if (map.getLayer(`infra-${name}`)) map.removeLayer(`infra-${name}`); } catch {}
    try { if (map.getSource(`infra-${name}`)) map.removeSource(`infra-${name}`); } catch {}
    addedLayersRef.current.delete(name);
  }, []);

  // Remove ALL infra layers from map
  const removeAllLayers = useCallback(() => {
    const map = getMap();
    if (!map) return;
    for (const name of [...addedLayersRef.current]) {
      removeLayer(map, name);
    }
  }, [getMap, removeLayer]);

  // Add or update a single layer on the map
  const addOrUpdateLayer = useCallback((map, name, data) => {
    const sourceId = `infra-${name}`;
    const layerId = `infra-${name}`;
    const color = LAYER_COLORS[name] || '#ffffff';
    const layerType = LAYER_TYPES[name] || 'line';

    let beforeId = null;
    try { if (map.getLayer(OFM_EXTRUSION_LAYER)) beforeId = OFM_EXTRUSION_LAYER; } catch {}

    // Add or update source
    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(data);
    } else {
      map.addSource(sourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(layerId)) {
      if (layerType === 'line') {
        const isRail = name === 'rail' || name === 'rail_filtered';
        const isHighVoltage = name.includes('kv');
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              5, isHighVoltage ? 2 : 1.5,
              8, isHighVoltage ? 3.5 : 2.5,
              12, isHighVoltage ? 5 : 4,
              16, isHighVoltage ? 7 : 5,
            ],
            'line-opacity': infraOpacity,
            ...(isRail ? { 'line-dasharray': [4, 2] } : {}),
          },
        }, beforeId);
      } else if (layerType === 'point') {
        map.addLayer({
          id: layerId,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-color': color,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 5, 12, 8, 16, 12],
            'circle-opacity': infraOpacity,
            'circle-stroke-color': '#000',
            'circle-stroke-width': 1,
          },
        }, beforeId);
      } else if (layerType === 'polygon') {
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': color,
            'fill-opacity': infraOpacity * 0.3,
          },
        }, beforeId);
        const outlineId = `${layerId}-outline`;
        if (!map.getLayer(outlineId)) {
          map.addLayer({
            id: outlineId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': color,
              'line-width': 2,
              'line-opacity': infraOpacity,
            },
          }, beforeId);
        }
      }
      addedLayersRef.current.add(name);
    } else {
      // Update opacity
      try {
        const mlLayer = map.getLayer(layerId);
        if (mlLayer) {
          const type = mlLayer.type;
          if (type === 'line') map.setPaintProperty(layerId, 'line-opacity', infraOpacity);
          else if (type === 'circle') map.setPaintProperty(layerId, 'circle-opacity', infraOpacity);
          else if (type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', infraOpacity * 0.3);
        }
        // Outline opacity
        if (map.getLayer(`${layerId}-outline`)) {
          map.setPaintProperty(`${layerId}-outline`, 'line-opacity', infraOpacity);
        }
      } catch {}
    }
  }, [infraOpacity]);

  // Sync layers: add what's needed, remove what's not
  const syncLayers = useCallback(() => {
    const map = getMap();
    if (!map || !map.getStyle()) return;

    if (!infraVisible || !canView) {
      removeAllLayers();
      return;
    }

    // Remove layers that are no longer toggled on or have no data
    for (const name of [...addedLayersRef.current]) {
      if (!infraLayers[name] || !layerData[name]) {
        removeLayer(map, name);
      }
    }

    // Add/update layers that should be visible
    for (const [name, data] of Object.entries(layerData)) {
      if (!infraLayers[name]) continue;
      try {
        addOrUpdateLayer(map, name, data);
      } catch (err) {
        console.warn(`Failed to add infra layer ${name}:`, err.message);
      }
    }
  }, [getMap, infraVisible, canView, infraLayers, layerData, removeAllLayers, removeLayer, addOrUpdateLayer]);

  // Main sync effect
  useEffect(() => {
    syncLayers();
  }, [syncLayers]);

  // Re-add on style change (map base layer switch)
  useEffect(() => {
    const map = getMap();
    if (!map) return;
    const handler = () => {
      addedLayersRef.current.clear();
      syncLayers();
    };
    map.on('styledata', handler);
    return () => map.off('styledata', handler);
  }, [getMap, syncLayers]);

  // Click handler for popups — shows all metadata
  useEffect(() => {
    const map = getMap();
    if (!map || !infraVisible || !canView) return;

    const handler = (e) => {
      const layerIds = [...addedLayersRef.current].flatMap(n => {
        const ids = [];
        try { if (map.getLayer(`infra-${n}`)) ids.push(`infra-${n}`); } catch {}
        return ids;
      });
      if (layerIds.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (features.length === 0) return;

      const f = features[0];
      const props = f.properties || {};
      // Determine which layer this belongs to
      const layerName = f.layer?.id?.replace('infra-', '') || '';

      // Close previous popup
      if (popupRef.current) popupRef.current.remove();

      popupRef.current = new maplibregl.Popup({ closeOnClick: true, maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(buildPopupHtml(props, layerName))
        .addTo(map);
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, [getMap, infraVisible, canView]);

  // Cursor pointer on hover
  useEffect(() => {
    const map = getMap();
    if (!map || !infraVisible || !canView) return;

    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };

    const attachCursor = () => {
      for (const name of addedLayersRef.current) {
        const id = `infra-${name}`;
        try {
          if (map.getLayer(id)) {
            map.on('mouseenter', id, enter);
            map.on('mouseleave', id, leave);
          }
        } catch {}
      }
    };

    // Attach after a tick (layers may just have been added)
    const timer = setTimeout(attachCursor, 100);

    return () => {
      clearTimeout(timer);
      for (const name of addedLayersRef.current) {
        const id = `infra-${name}`;
        try {
          map.off('mouseenter', id, enter);
          map.off('mouseleave', id, leave);
        } catch {}
      }
      map.getCanvas().style.cursor = '';
    };
  }, [getMap, infraVisible, canView, infraLayers, layerData]);

  return null;
}

// Legend component for Data Layers Drawer
export function InfrastructureLegend({ layerList }) {
  const lang = useMapStore((s) => s.lang);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const toggleInfraLayer = useMapStore((s) => s.toggleInfraLayer);
  const [collapsed, setCollapsed] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState({});

  const toggleCat = (cat) => setCollapsedCats(prev => ({ ...prev, [cat]: !prev[cat] }));

  // Group layers by category
  const grouped = {};
  for (const layer of layerList) {
    const cat = layer.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(layer);
  }

  const activeCount = Object.values(infraLayers).filter(Boolean).length;

  return (
    <div className="mt-1">
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full text-left py-0.5 text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          fill="currentColor" viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="uppercase tracking-wide font-semibold">
          {lang === 'no' ? 'Underlag' : 'Sublayers'}
        </span>
        {activeCount > 0 && (
          <span className="bg-indigo-600 text-white text-[9px] px-1.5 rounded-full leading-none py-0.5">
            {activeCount}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-1 space-y-1.5">
          {CATEGORY_ORDER.map(cat => {
            const layers = grouped[cat];
            if (!layers || layers.length === 0) return null;
            const catCollapsed = !!collapsedCats[cat];
            const catActiveCount = layers.filter(l => !!infraLayers[l.id]).length;

            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex items-center gap-1 w-full text-left py-0.5 text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <svg
                    className={`w-2.5 h-2.5 transition-transform ${catCollapsed ? '' : 'rotate-90'}`}
                    fill="currentColor" viewBox="0 0 20 20"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="uppercase tracking-wide font-semibold">
                    {CATEGORIES[cat]?.[lang] || cat}
                  </span>
                  {catActiveCount > 0 && (
                    <span className="text-[8px] text-indigo-400">({catActiveCount})</span>
                  )}
                </button>
                {!catCollapsed && (
                  <div className="ml-3 space-y-0.5">
                    {layers.map(layer => {
                      const on = !!infraLayers[layer.id];
                      const color = LAYER_COLORS[layer.id] || '#fff';
                      return (
                        <button
                          key={layer.id}
                          onClick={() => toggleInfraLayer(layer.id)}
                          className={`flex items-center gap-2 w-full text-left px-1.5 py-0.5 rounded transition-colors ${on ? 'bg-slate-700/50 text-slate-200' : 'text-slate-500 hover:text-slate-400'}`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: on ? color : '#475569' }}
                          />
                          <span className="text-[11px] truncate">{layer.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
