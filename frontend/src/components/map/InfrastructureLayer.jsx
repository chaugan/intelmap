import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useInfrastructure } from '../../hooks/useInfrastructure.js';
import { t } from '../../lib/i18n.js';

const OFM_EXTRUSION_LAYER = 'openmaptiles-3d-buildings';

// Color scheme by layer
const LAYER_COLORS = {
  // Power lines by voltage
  '66kv': '#eab308',   // yellow
  '110kv': '#f97316',  // orange
  '132kv': '#f97316',  // orange
  '220kv': '#ef4444',  // red
  '300kv': '#a855f7',  // purple
  '420kv': '#991b1b',  // darkred
  'distribution': '#84cc16', // lime
  'powerlines': '#facc15',   // yellow
  'subsea_power': '#06b6d4', // cyan
  'transformator': '#f59e0b', // amber

  // Transport
  'eroad': '#3b82f6',     // blue
  'rail': '#6b7280',      // gray
  'rail_station': '#ef4444', // red
  'rail_substation': '#f97316', // orange
  'rail_filtered': '#9ca3af', // light gray
  'railway_bridge': '#78716c', // stone
  'ferry': '#0ea5e9',     // sky blue
  'ferry_rail': '#0284c7', // darker sky

  // Telecom
  'fiber': '#a78bfa',     // violet
  'radiotowers2': '#f43f5e', // rose
  'radar': '#ec4899',     // pink

  // Aviation
  'airport': '#6366f1',   // indigo
  'lufthinder': '#ef4444', // red

  // Military
  'military': '#22c55e',  // green

  // Energy
  'hydro': '#0ea5e9',     // sky
  'wind': '#10b981',      // emerald
  'oil_gas_chem': '#f59e0b', // amber

  // Other
  'pipes': '#a855f7',     // purple
  'tilfluktsrom': '#14b8a6', // teal
};

// Layer type definitions for styling
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

// Category grouping
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

export default function InfrastructureLayer({ mapRef }) {
  const infraVisible = useMapStore((s) => s.infraVisible);
  const infraOpacity = useMapStore((s) => s.infraOpacity);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const user = useAuthStore((s) => s.user);
  const canView = user?.infraviewEnabled || user?.role === 'admin';

  const { layerData } = useInfrastructure(infraVisible && canView);
  const addedLayersRef = useRef(new Set());

  const addLayers = useCallback(() => {
    const map = mapRef?.getMap?.() || mapRef;
    if (!map || !map.getStyle()) return;

    // Find beforeId
    let beforeId = null;
    try {
      if (map.getLayer(OFM_EXTRUSION_LAYER)) beforeId = OFM_EXTRUSION_LAYER;
    } catch {}

    // Remove layers no longer needed
    for (const layerName of addedLayersRef.current) {
      if (!infraLayers[layerName] || !layerData[layerName]) {
        try {
          if (map.getLayer(`infra-${layerName}`)) map.removeLayer(`infra-${layerName}`);
          if (map.getSource(`infra-${layerName}`)) map.removeSource(`infra-${layerName}`);
        } catch {}
        addedLayersRef.current.delete(layerName);
      }
    }

    // Add/update layers
    for (const [name, data] of Object.entries(layerData)) {
      if (!infraLayers[name]) continue;

      const sourceId = `infra-${name}`;
      const layerId = `infra-${name}`;
      const color = LAYER_COLORS[name] || '#ffffff';
      const layerType = LAYER_TYPES[name] || 'line';

      try {
        // Add or update source
        if (map.getSource(sourceId)) {
          map.getSource(sourceId).setData(data);
        } else {
          map.addSource(sourceId, { type: 'geojson', data });
        }

        // Add layer if not exists
        if (!map.getLayer(layerId)) {
          if (layerType === 'line') {
            map.addLayer({
              id: layerId,
              type: 'line',
              source: sourceId,
              paint: {
                'line-color': color,
                'line-width': name.includes('kv') ? 2.5 : 2,
                'line-opacity': infraOpacity,
              },
              ...(name === 'rail' || name === 'rail_filtered' ? {
                paint: {
                  'line-color': color,
                  'line-width': 2,
                  'line-opacity': infraOpacity,
                  'line-dasharray': [4, 2],
                },
              } : {}),
            }, beforeId);
          } else if (layerType === 'point') {
            map.addLayer({
              id: layerId,
              type: 'circle',
              source: sourceId,
              paint: {
                'circle-color': color,
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4, 14, 6],
                'circle-opacity': infraOpacity,
                'circle-stroke-color': '#000',
                'circle-stroke-width': 0.5,
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
            // Add outline
            const outlineId = `${layerId}-outline`;
            if (!map.getLayer(outlineId)) {
              map.addLayer({
                id: outlineId,
                type: 'line',
                source: sourceId,
                paint: {
                  'line-color': color,
                  'line-width': 1.5,
                  'line-opacity': infraOpacity,
                },
              }, beforeId);
            }
          }
          addedLayersRef.current.add(name);
        } else {
          // Update opacity
          const mlLayer = map.getLayer(layerId);
          if (mlLayer) {
            const type = mlLayer.type;
            if (type === 'line') map.setPaintProperty(layerId, 'line-opacity', infraOpacity);
            else if (type === 'circle') map.setPaintProperty(layerId, 'circle-opacity', infraOpacity);
            else if (type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', infraOpacity * 0.3);
          }
        }
      } catch (err) {
        console.warn(`Failed to add infra layer ${name}:`, err.message);
      }
    }
  }, [mapRef, infraLayers, layerData, infraOpacity]);

  // Add/remove layers when data or visibility changes
  useEffect(() => {
    if (!infraVisible || !canView) {
      // Cleanup all
      const map = mapRef?.getMap?.() || mapRef;
      if (map) {
        for (const name of addedLayersRef.current) {
          try {
            if (map.getLayer(`infra-${name}-outline`)) map.removeLayer(`infra-${name}-outline`);
            if (map.getLayer(`infra-${name}`)) map.removeLayer(`infra-${name}`);
            if (map.getSource(`infra-${name}`)) map.removeSource(`infra-${name}`);
          } catch {}
        }
        addedLayersRef.current.clear();
      }
      return;
    }
    addLayers();
  }, [infraVisible, canView, addLayers]);

  // Re-add on style change
  useEffect(() => {
    const map = mapRef?.getMap?.() || mapRef;
    if (!map) return;
    const handler = () => {
      addedLayersRef.current.clear();
      if (infraVisible && canView) addLayers();
    };
    map.on('styledata', handler);
    return () => map.off('styledata', handler);
  }, [mapRef, infraVisible, canView, addLayers]);

  // Click popup
  useEffect(() => {
    const map = mapRef?.getMap?.() || mapRef;
    if (!map || !infraVisible || !canView) return;

    const handler = (e) => {
      // Check all infra layers
      const layerIds = [...addedLayersRef.current].map(n => `infra-${n}`).filter(id => {
        try { return !!map.getLayer(id); } catch { return false; }
      });
      if (layerIds.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (features.length === 0) return;

      const f = features[0];
      const props = f.properties || {};
      const name = props.name || props.Name || props.NAME || props.navn || '';
      const desc = props.description || props.Description || props.type || '';

      if (!name && !desc) return;

      const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '250px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-size:12px;color:#e2e8f0">
            ${name ? `<strong>${name}</strong>` : ''}
            ${desc ? `<div style="color:#94a3b8;margin-top:2px">${desc}</div>` : ''}
          </div>
        `)
        .addTo(map);
    };

    map.on('click', handler);
    return () => map.off('click', handler);
  }, [mapRef, infraVisible, canView]);

  return null;
}

// Legend component for Data Layers Drawer
export function InfrastructureLegend({ layerList }) {
  const lang = useMapStore((s) => s.lang);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const toggleInfraLayer = useMapStore((s) => s.toggleInfraLayer);

  // Group layers by category
  const grouped = {};
  for (const layer of layerList) {
    const cat = layer.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(layer);
  }

  return (
    <div className="mt-2 space-y-2">
      {CATEGORY_ORDER.map(cat => {
        const layers = grouped[cat];
        if (!layers || layers.length === 0) return null;
        return (
          <div key={cat}>
            <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">
              {CATEGORIES[cat]?.[lang] || cat}
            </div>
            <div className="space-y-0.5">
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
          </div>
        );
      })}
    </div>
  );
}
