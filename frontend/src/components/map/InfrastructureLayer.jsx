import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useInfrastructure } from '../../hooks/useInfrastructure.js';

const OFM_EXTRUSION_LAYER = 'openmaptiles-3d-buildings';

const LAYER_COLORS = {
  '66kv': '#eab308', '110kv': '#f97316', '132kv': '#f97316', '220kv': '#ef4444',
  '300kv': '#a855f7', '420kv': '#991b1b', 'distribution': '#84cc16',
  'subsea_power': '#06b6d4', 'transformator': '#f59e0b',
  'eroad': '#00975e', 'rail': '#6b7280', 'rail_station': '#ef4444',
  'rail_substation': '#f97316', 'railway_bridge': '#78716c',
  'ferry': '#0ea5e9', 'ferry_rail': '#0284c7',
  'fiber': '#a78bfa', 'radiotowers2': '#f43f5e', 'radar': '#ec4899',
  'airport': '#6366f1', 'lufthinder': '#ef4444',
  'military': '#22c55e',
  'hydro': '#0ea5e9', 'wind': '#10b981', 'oil_gas_chem': '#f59e0b',
  'pipes': '#a855f7', 'tilfluktsrom': '#14b8a6',
};

const LAYER_NAMES_NO = (() => {
  const o = String.fromCharCode(0xF8); // ø
  const a = String.fromCharCode(0xE5); // å
  const ae = String.fromCharCode(0xE6); // æ
  return {
    '66kv': '66 kV', '110kv': '110 kV', '132kv': '132 kV', '220kv': '220 kV',
    '300kv': '300 kV', '420kv': '420 kV', 'distribution': 'Distribusjon',
    'subsea_power': `Sj${o}kabel str${o}m`, 'transformator': 'Transformator',
    'eroad': 'Europavei', 'rail': 'Jernbane', 'rail_station': 'Jernbanestasjoner',
    'rail_substation': 'Jernbanetransformatorer', 'railway_bridge': 'Jernbanebroer',
    'ferry': 'Fergeruter', 'ferry_rail': 'Fergeleier v/jernbane',
    'fiber': `Sj${o}kabel fiber`, 'radiotowers2': `Radiot${a}rn`, 'radar': 'Radar',
    'airport': 'Flyplasser', 'lufthinder': 'Lufthindre',
    'military': `Milit${ae}re omr${a}der`,
    'hydro': 'Vannkraftverk', 'wind': 'Vindkraftverk', 'oil_gas_chem': 'Olje/gass/kjemi',
    'pipes': `R${o}rledninger`, 'tilfluktsrom': 'Tilfluktsrom',
  };
})();

const LAYER_CATEGORY = {
  '66kv': 'power', '110kv': 'power', '132kv': 'power', '220kv': 'power',
  '300kv': 'power', '420kv': 'power', 'distribution': 'power',
  'subsea_power': 'power', 'transformator': 'power',
  'eroad': 'transport', 'rail': 'transport', 'rail_station': 'transport',
  'rail_substation': 'transport', 'railway_bridge': 'transport',
  'ferry': 'transport', 'ferry_rail': 'transport',
  'fiber': 'telecom', 'radiotowers2': 'telecom', 'radar': 'telecom',
  'airport': 'aviation', 'lufthinder': 'aviation',
  'military': 'military',
  'hydro': 'energy', 'wind': 'energy', 'oil_gas_chem': 'energy',
  'pipes': 'other', 'tilfluktsrom': 'other',
};

const CATEGORIES = (() => {
  const o = String.fromCharCode(0xF8);
  const ae = String.fromCharCode(0xE6);
  return {
    power:     { no: `Str${o}mnett`, en: 'Power Grid' },
    transport: { no: 'Transport', en: 'Transport' },
    telecom:   { no: 'Telekom', en: 'Telecom' },
    aviation:  { no: 'Luftfart', en: 'Aviation' },
    military:  { no: `Milit${ae}rt`, en: 'Military' },
    energy:    { no: 'Energi', en: 'Energy' },
    other:     { no: 'Annet', en: 'Other' },
  };
})();

const CATEGORY_ORDER = ['power', 'transport', 'telecom', 'aviation', 'military', 'energy', 'other'];

const SKIP_PROPS = new Set(['@id', 'id', 'ogc_fid', 'gml_id', 'fid']);

function splitByGeometry(geojson) {
  const points = [], lines = [], polygons = [];
  for (const f of geojson?.features || []) {
    const t = f.geometry?.type;
    if (!t) continue;
    if (t === 'Point' || t === 'MultiPoint') points.push(f);
    else if (t === 'LineString' || t === 'MultiLineString') lines.push(f);
    else if (t === 'Polygon' || t === 'MultiPolygon') polygons.push(f);
  }
  return { points, lines, polygons };
}

function computeCentroid(feature) {
  const geom = feature.geometry;
  let ring;
  if (geom.type === 'Polygon') ring = geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0][0];
  if (!ring || ring.length === 0) return null;
  let sumLon = 0, sumLat = 0;
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) { sumLon += ring[i][0]; sumLat += ring[i][1]; }
  return {
    type: 'Feature', properties: feature.properties,
    geometry: { type: 'Point', coordinates: [sumLon / n, sumLat / n] },
  };
}

function fc(features) {
  return { type: 'FeatureCollection', features };
}

function buildPopupHtml(props, layerName) {
  const name = props.Name || props.name || props.NAME || props.navn || props.official_name || '';
  const rows = [];
  for (const [key, val] of Object.entries(props)) {
    if (SKIP_PROPS.has(key)) continue;
    if (val === null || val === undefined || val === '') continue;
    if (/^(Name|name|NAME|navn|official_name)$/.test(key)) continue;
    if (/^[Dd]escription$/.test(key)) {
      if (typeof val === 'string' && (val.includes('<html') || val.includes('<table') || val.trim() === '')) continue;
    }
    const label = key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const displayVal = typeof val === 'string' && val.length > 100 ? val.slice(0, 100) + '...' : val;
    rows.push('<tr><td style="color:#94a3b8;padding:2px 8px 2px 0;white-space:nowrap;vertical-align:top;font-size:11px">' + label + '</td><td style="font-size:11px">' + displayVal + '</td></tr>');
  }
  const color = LAYER_COLORS[layerName] || '#94a3b8';
  const cat = LAYER_CATEGORY[layerName];
  const catLabel = cat ? (CATEGORIES[cat]?.no || cat) : '';
  const layerLabel = LAYER_NAMES_NO[layerName] || layerName;
  const emdash = String.fromCharCode(0x2014);
  return '<div style="font-size:13px;color:#e2e8f0;max-width:320px">' +
    '<div style="font-weight:600;margin-bottom:2px;border-bottom:2px solid ' + color + ';padding-bottom:4px;font-size:14px">' +
    (name || layerLabel) + '</div>' +
    '<div style="color:#64748b;font-size:10px;margin-bottom:6px">' + catLabel + ' ' + emdash + ' ' + layerLabel + '</div>' +
    (rows.length > 0 ? '<table style="border-collapse:collapse">' + rows.join('') + '</table>' : '') +
    '</div>';
}

const SUFFIXES = ['-polygons', '-centroids', '-points', '-lines'];

export default function InfrastructureLayer({ mapRef }) {
  const infraVisible = useMapStore((s) => s.infraVisible);
  const infraOpacity = useMapStore((s) => s.infraOpacity);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const user = useAuthStore((s) => s.user);
  const canView = user?.infraviewEnabled || user?.role === 'admin';
  const { layerData } = useInfrastructure(infraVisible && canView);
  const addedRef = useRef(new Set());
  const popupRef = useRef(null);
  const getMap = () => mapRef?.getMap?.() || mapRef;

  function removeLayers(map, name) {
    for (const suffix of SUFFIXES) {
      const id = 'infra-' + name + suffix;
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
      try { if (map.getSource(id)) map.removeSource(id); } catch {}
    }
    addedRef.current.delete(name);
  }

  function addLayers(map, name, data, opacity) {
    const color = LAYER_COLORS[name] || '#ffffff';
    const { points, lines, polygons } = splitByGeometry(data);
    let beforeId = null;
    try { if (map.getLayer(OFM_EXTRUSION_LAYER)) beforeId = OFM_EXTRUSION_LAYER; } catch {}
    const isRail = name === 'rail';
    const isHighVoltage = name.includes('kv');

    if (polygons.length > 0) {
      const sid = 'infra-' + name + '-polygons';
      if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: fc(polygons) });
      if (!map.getLayer(sid)) {
        map.addLayer({ id: sid, type: 'fill', source: sid, paint: { 'fill-color': color, 'fill-opacity': opacity * 0.5, 'fill-outline-color': '#000000' } }, beforeId);
      }
      const centroids = polygons.map(computeCentroid).filter(Boolean);
      if (centroids.length > 0) {
        const csid = 'infra-' + name + '-centroids';
        if (!map.getSource(csid)) map.addSource(csid, { type: 'geojson', data: fc(centroids) });
        if (!map.getLayer(csid)) {
          map.addLayer({ id: csid, type: 'circle', source: csid, paint: { 'circle-color': color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 5, 12, 8, 16, 12], 'circle-opacity': opacity * 0.65, 'circle-stroke-width': 0.8, 'circle-stroke-color': '#000000' } }, beforeId);
        }
      }
    }

    if (points.length > 0) {
      const sid = 'infra-' + name + '-points';
      if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: fc(points) });
      if (!map.getLayer(sid)) {
        map.addLayer({ id: sid, type: 'circle', source: sid, paint: { 'circle-color': color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 6, 12, 10, 16, 14], 'circle-opacity': opacity, 'circle-stroke-width': 1, 'circle-stroke-color': '#000000' } }, beforeId);
      }
    }

    if (lines.length > 0) {
      const sid = 'infra-' + name + '-lines';
      if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: fc(lines) });
      if (!map.getLayer(sid)) {
        map.addLayer({ id: sid, type: 'line', source: sid, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, isHighVoltage ? 2 : 1.5, 8, isHighVoltage ? 3.5 : 2.5, 12, isHighVoltage ? 5 : 4, 16, isHighVoltage ? 7 : 5], 'line-opacity': opacity, ...(isRail ? { 'line-dasharray': [4, 2] } : {}) } }, beforeId);
      }
    }

    addedRef.current.add(name);
  }

  function updateOpacity(map, name, opacity) {
    for (const suffix of SUFFIXES) {
      const id = 'infra-' + name + suffix;
      try {
        const layer = map.getLayer(id);
        if (!layer) continue;
        if (layer.type === 'fill') map.setPaintProperty(id, 'fill-opacity', opacity * 0.5);
        else if (layer.type === 'circle') map.setPaintProperty(id, 'circle-opacity', suffix === '-centroids' ? opacity * 0.65 : opacity);
        else if (layer.type === 'line') map.setPaintProperty(id, 'line-opacity', opacity);
      } catch {}
    }
  }

  useEffect(() => {
    const map = getMap();
    if (!map || !map.getStyle()) return;
    if (!infraVisible || !canView) {
      for (const name of [...addedRef.current]) removeLayers(map, name);
      return;
    }
    for (const name of [...addedRef.current]) {
      if (!infraLayers[name] || !layerData[name]) removeLayers(map, name);
    }
    for (const [name, data] of Object.entries(layerData)) {
      if (!infraLayers[name]) continue;
      if (addedRef.current.has(name)) { updateOpacity(map, name, infraOpacity); }
      else { try { addLayers(map, name, data, infraOpacity); } catch (err) { console.warn('Failed to add infra layer ' + name + ':', err.message); } }
    }
  }, [infraVisible, canView, infraLayers, layerData, infraOpacity]);

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    const handler = () => {
      addedRef.current.clear();
      if (!infraVisible || !canView) return;
      for (const [name, data] of Object.entries(layerData)) {
        if (!infraLayers[name]) continue;
        try { addLayers(map, name, data, infraOpacity); } catch {}
      }
    };
    map.on('styledata', handler);
    return () => map.off('styledata', handler);
  }, [infraVisible, canView, infraLayers, layerData, infraOpacity]);

  useEffect(() => {
    const map = getMap();
    if (!map || !infraVisible || !canView) return;
    const handler = (e) => {
      const queryLayers = [];
      for (const name of addedRef.current) {
        for (const suffix of SUFFIXES) {
          const id = 'infra-' + name + suffix;
          try { if (map.getLayer(id)) queryLayers.push(id); } catch {}
        }
      }
      if (queryLayers.length === 0) return;
      const features = map.queryRenderedFeatures(e.point, { layers: queryLayers });
      if (features.length === 0) return;
      const f = features[0];
      const props = f.properties || {};
      const layerName = (f.layer?.id || '').replace(/^infra-/, '').replace(/-(polygons|centroids|points|lines)$/, '');
      if (popupRef.current) popupRef.current.remove();
      popupRef.current = new maplibregl.Popup({ closeOnClick: true, maxWidth: '340px' })
        .setLngLat(e.lngLat).setHTML(buildPopupHtml(props, layerName)).addTo(map);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; } };
  }, [infraVisible, canView, infraLayers, layerData]);

  useEffect(() => {
    const map = getMap();
    if (!map || !infraVisible || !canView) return;
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    const attached = [];
    for (const name of addedRef.current) {
      for (const suffix of SUFFIXES) {
        const id = 'infra-' + name + suffix;
        try { if (map.getLayer(id)) { map.on('mouseenter', id, enter); map.on('mouseleave', id, leave); attached.push(id); } } catch {}
      }
    }
    return () => { for (const id of attached) { try { map.off('mouseenter', id, enter); map.off('mouseleave', id, leave); } catch {} } map.getCanvas().style.cursor = ''; };
  }, [infraVisible, canView, infraLayers, layerData]);

  return null;
}

// ---- Infrastructure Search ----

function InfraSearch({ onFilter }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const sok = 'S' + String.fromCharCode(0xF8) + 'k infrastruktur...';

  const doSearch = useCallback((q) => {
    if (!q || q.length < 2) { setSuggestions([]); setShowDropdown(false); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch('/api/infrastructure/search?q=' + encodeURIComponent(q), { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(results => { setSuggestions(results.slice(0, 3)); setShowDropdown(results.length > 0); setSelectedIdx(-1); })
        .catch(() => {});
    }, 150);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
    if (val.length >= 2) { onFilter({ type: 'fuzzy', query: val }); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(prev => Math.max(prev - 1, -1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && suggestions[selectedIdx]) {
        const s = suggestions[selectedIdx];
        setQuery(s.name);
        onFilter({ type: 'exact', name: s.name });
      } else if (query.length >= 2) {
        onFilter({ type: 'fuzzy', query });
      }
      setShowDropdown(false);
    } else if (e.key === 'Escape') { e.stopPropagation(); setShowDropdown(false); }
  };

  const handleSelect = (s) => { setQuery(s.name); onFilter({ type: 'exact', name: s.name }); setShowDropdown(false); };

  const handleClear = () => { setQuery(''); setSuggestions([]); setShowDropdown(false); onFilter({ type: 'clear' }); inputRef.current?.focus(); };

  return (
    <div className="relative mb-1.5">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input ref={inputRef} type="text" value={query} onChange={handleChange} onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
            placeholder={sok}
            className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {query && (
            <button onClick={handleClear} className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs px-1">
              {String.fromCharCode(0x2715)}
            </button>
          )}
        </div>
      </div>
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-0.5 bg-slate-800 border border-slate-600 rounded shadow-lg overflow-hidden">
          {suggestions.map((s, i) => {
            const color = LAYER_COLORS[s.layer] || '#94a3b8';
            const layerLabel = LAYER_NAMES_NO[s.layer] || s.layer;
            return (
              <button key={s.layer + '-' + i} onClick={() => handleSelect(s)}
                className={'w-full text-left px-2 py-1.5 text-[11px] flex items-center gap-2 transition-colors ' + (i === selectedIdx ? 'bg-indigo-700 text-white' : 'text-slate-300 hover:bg-slate-700')}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate flex-1">{s.name}</span>
                <span className="text-[9px] text-slate-500 shrink-0">{layerLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Legend Component ----

export function InfrastructureLegend({ layerList }) {
  const lang = useMapStore((s) => s.lang);
  const infraLayers = useMapStore((s) => s.infraLayers);
  const toggleInfraLayer = useMapStore((s) => s.toggleInfraLayer);
  const [collapsed, setCollapsed] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState({});

  const toggleCat = (cat) => setCollapsedCats(prev => ({ ...prev, [cat]: !prev[cat] }));

  const grouped = {};
  for (const layer of layerList) {
    const cat = layer.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(layer);
  }

  const activeCount = Object.values(infraLayers).filter(Boolean).length;

  const getLayerName = (layer) => {
    if (lang === 'no' && LAYER_NAMES_NO[layer.id]) return LAYER_NAMES_NO[layer.id];
    return layer.name;
  };

  const handleFilter = useCallback((filter) => {
    const store = useMapStore.getState();
    if (filter.type === 'clear') {
      const reset = {};
      for (const key of Object.keys(store.infraLayers)) reset[key] = false;
      useMapStore.setState({ infraLayers: reset });
      return;
    }
    if (filter.type === 'exact') {
      fetch('/api/infrastructure/search?q=' + encodeURIComponent(filter.name), { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(results => {
          const newLayers = {};
          for (const key of Object.keys(store.infraLayers)) newLayers[key] = false;
          for (const r of results) { if (r.name === filter.name) newLayers[r.layer] = true; }
          useMapStore.setState({ infraLayers: newLayers });
        }).catch(() => {});
    } else if (filter.type === 'fuzzy') {
      fetch('/api/infrastructure/search?q=' + encodeURIComponent(filter.query), { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(results => {
          const newLayers = {};
          for (const key of Object.keys(store.infraLayers)) newLayers[key] = false;
          for (const r of results) newLayers[r.layer] = true;
          useMapStore.setState({ infraLayers: newLayers });
        }).catch(() => {});
    }
  }, []);

  return (
    <div className="mt-1">
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full text-left py-1 text-xs text-slate-400 hover:text-slate-300 transition-colors">
        <svg className={'w-3.5 h-3.5 transition-transform ' + (collapsed ? '' : 'rotate-90')} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="uppercase tracking-wide font-semibold text-xs">
          {lang === 'no' ? 'Underlag' : 'Sublayers'}
        </span>
        {activeCount > 0 && (
          <span className="bg-indigo-600 text-white text-[10px] px-1.5 rounded-full leading-none py-0.5">{activeCount}</span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-1">
          <InfraSearch onFilter={handleFilter} />
          <div className="space-y-2">
            {CATEGORY_ORDER.map(cat => {
              const layers = grouped[cat];
              if (!layers || layers.length === 0) return null;
              const catCollapsed = !!collapsedCats[cat];
              const catActiveCount = layers.filter(l => !!infraLayers[l.id]).length;
              return (
                <div key={cat}>
                  <button onClick={() => toggleCat(cat)}
                    className="flex items-center gap-1 w-full text-left py-0.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                    <svg className={'w-3 h-3 transition-transform ' + (catCollapsed ? '' : 'rotate-90')} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className="uppercase tracking-wide font-semibold">{CATEGORIES[cat]?.[lang] || cat}</span>
                    {catActiveCount > 0 && <span className="text-[10px] text-indigo-400">({catActiveCount})</span>}
                  </button>
                  {!catCollapsed && (
                    <div className="ml-3 space-y-0.5">
                      {layers.map(layer => {
                        const on = !!infraLayers[layer.id];
                        const color = LAYER_COLORS[layer.id] || '#fff';
                        return (
                          <button key={layer.id} onClick={() => toggleInfraLayer(layer.id)}
                            className={'flex items-center gap-2 w-full text-left px-1.5 py-1 rounded transition-colors ' + (on ? 'bg-slate-700/50 text-slate-200' : 'text-slate-500 hover:text-slate-400')}>
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: on ? color : '#475569' }} />
                            <span className="text-[12px] truncate">{getLayerName(layer)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
