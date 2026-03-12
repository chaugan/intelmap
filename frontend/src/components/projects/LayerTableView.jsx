import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { generateSymbolSvg } from '../../lib/milsymbol-utils.js';

const PAGE_SIZE = 25;

function getDrawingLabel(d, lang) {
  if (d.drawingType === 'text' && d.properties?.text) return d.properties.text;
  if (d.properties?.label) return d.properties.label;
  const typeLabels = {
    line: { en: 'Line', no: 'Linje' },
    arrow: { en: 'Arrow', no: 'Pil' },
    polygon: { en: 'Polygon', no: 'Polygon' },
    circle: { en: 'Circle', no: 'Sirkel' },
    text: { en: 'Text', no: 'Tekst' },
    needle: { en: 'Needle', no: 'Nål' },
    grid: { en: 'Grid', no: 'Rutenett' },
  };
  return typeLabels[d.drawingType]?.[lang] || d.drawingType || 'Drawing';
}

// Column definitions per object type
const COLUMNS = {
  markers: (lang) => [
    { key: 'name', label: lang === 'no' ? 'Navn' : 'Name', get: (m) => m.designation || m.customLabel || getSymbolName(m.sidc, lang) || '' },
    { key: 'sidc', label: 'SIDC', get: (m) => m.sidc || '' },
    { key: 'designation', label: lang === 'no' ? 'Betegnelse' : 'Designation', get: (m) => m.designation || '' },
    { key: 'higherFormation', label: lang === 'no' ? 'Høyere formasjon' : 'Higher formation', get: (m) => m.higherFormation || '' },
    { key: 'additionalInfo', label: lang === 'no' ? 'Tilleggsinformasjon' : 'Additional info', get: (m) => m.additionalInfo || '' },
    { key: 'coords', label: lang === 'no' ? 'Koordinater' : 'Coordinates', get: (m) => `${m.lat?.toFixed(5)}, ${m.lon?.toFixed(5)}` },
  ],
  drawings: (lang) => [
    { key: 'label', label: lang === 'no' ? 'Navn' : 'Name', get: (d) => getDrawingLabel(d, lang) },
    { key: 'drawingType', label: lang === 'no' ? 'Type' : 'Type', get: (d) => {
      const labels = { line: lang === 'no' ? 'Linje' : 'Line', arrow: lang === 'no' ? 'Pil' : 'Arrow', polygon: 'Polygon', circle: lang === 'no' ? 'Sirkel' : 'Circle', text: lang === 'no' ? 'Tekst' : 'Text', needle: lang === 'no' ? 'Nål' : 'Needle', grid: lang === 'no' ? 'Rutenett' : 'Grid' };
      return labels[d.drawingType] || d.drawingType || '';
    }},
    { key: 'color', label: lang === 'no' ? 'Farge' : 'Color', get: (d) => d.properties?.color || '#3b82f6' },
    { key: 'text', label: lang === 'no' ? 'Tekst' : 'Text', get: (d) => d.properties?.text || '' },
  ],
  viewsheds: (lang) => [
    { key: 'label', label: lang === 'no' ? 'Etikett' : 'Label', get: (v) => v.label || '' },
    { key: 'type', label: 'Type', get: (v) => v.type === 'horizon' ? (lang === 'no' ? 'Horisont' : 'Horizon') : (lang === 'no' ? 'Siktanalyse' : 'Viewshed') },
    { key: 'radiusKm', label: lang === 'no' ? 'Radius' : 'Radius', get: (v) => v.radiusKm ? `${Math.round(v.radiusKm * 10) / 10} km` : '' },
    { key: 'observerHeight', label: lang === 'no' ? 'Observatørhøyde' : 'Observer height', get: (v) => v.observerHeight ? `${v.observerHeight} m` : '' },
    { key: 'color', label: lang === 'no' ? 'Farge' : 'Color', get: (v) => v.color || '#ef4444' },
    { key: 'coords', label: lang === 'no' ? 'Koordinater' : 'Coordinates', get: (v) => `${v.latitude?.toFixed(5)}, ${v.longitude?.toFixed(5)}` },
  ],
  rfCoverages: (lang) => [
    { key: 'frequency', label: lang === 'no' ? 'Frekvens' : 'Frequency', get: (c) => c.frequencyMHz ? `${c.frequencyMHz} MHz` : '' },
    { key: 'power', label: lang === 'no' ? 'Effekt' : 'Power', get: (c) => c.txPowerWatts ? `${c.txPowerWatts} W` : '' },
    { key: 'antennaHeight', label: lang === 'no' ? 'Antennehøyde' : 'Antenna height', get: (c) => c.antennaHeight ? `${c.antennaHeight} m` : '' },
    { key: 'radiusKm', label: lang === 'no' ? 'Radius' : 'Radius', get: (c) => c.radiusKm ? `${Math.round(c.radiusKm * 10) / 10} km` : '' },
    { key: 'coords', label: lang === 'no' ? 'Koordinater' : 'Coordinates', get: (c) => `${c.latitude?.toFixed(5)}, ${c.longitude?.toFixed(5)}` },
  ],
};

const TYPE_LABELS = {
  markers: { no: 'Markører', en: 'Markers' },
  drawings: { no: 'Tegninger', en: 'Drawings' },
  viewsheds: { no: 'Siktanalyser', en: 'Viewsheds' },
  rfCoverages: { no: 'RF-dekning', en: 'RF Coverages' },
};

function getItemCoords(type, item) {
  if (type === 'markers') return [item.lon, item.lat];
  if (type === 'viewsheds' || type === 'rfCoverages') return [item.longitude, item.latitude];
  if (type === 'drawings') {
    const g = item.geometry;
    if (g?.type === 'Point') return g.coordinates;
    if (g?.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (g?.type === 'Polygon') {
      const ring = g.coordinates[0];
      return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
    }
  }
  return null;
}

export default function LayerTableView({ markers = [], drawings = [], viewsheds = [], rfCoverages = [], lang, mapRef, layerName, onClose, onSelectMarker, onSelectDrawing }) {
  // Determine which tabs to show based on available data
  const availableTypes = useMemo(() => {
    const types = [];
    if (markers.length > 0) types.push('markers');
    if (drawings.length > 0) types.push('drawings');
    if (viewsheds.length > 0) types.push('viewsheds');
    if (rfCoverages.length > 0) types.push('rfCoverages');
    return types;
  }, [markers.length, drawings.length, viewsheds.length, rfCoverages.length]);

  const [activeType, setActiveType] = useState(availableTypes[0] || 'markers');
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({}); // { columnKey: filterValue }
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  // Get data for current type
  const rawData = useMemo(() => {
    switch (activeType) {
      case 'markers': return markers;
      case 'drawings': return drawings;
      case 'viewsheds': return viewsheds;
      case 'rfCoverages': return rfCoverages;
      default: return [];
    }
  }, [activeType, markers, drawings, viewsheds, rfCoverages]);

  const columns = useMemo(() => (COLUMNS[activeType] || (() => []))(lang), [activeType, lang]);

  // Apply filters
  const filteredData = useMemo(() => {
    let data = rawData;
    for (const col of columns) {
      const filterVal = filters[col.key]?.toLowerCase();
      if (filterVal) {
        data = data.filter(item => col.get(item).toString().toLowerCase().includes(filterVal));
      }
    }
    // Sort
    if (sortCol) {
      const col = columns.find(c => c.key === sortCol);
      if (col) {
        data = [...data].sort((a, b) => {
          const va = col.get(a).toString().toLowerCase();
          const vb = col.get(b).toString().toLowerCase();
          return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
    }
    return data;
  }, [rawData, columns, filters, sortCol, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const pageData = filteredData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when type or filters change
  const handleTypeChange = (type) => {
    setActiveType(type);
    setPage(0);
    setFilters({});
    setSortCol(null);
  };

  const handleFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
  };

  const flyTo = (coords) => {
    if (!mapRef || !coords) return;
    mapRef.flyTo({ center: coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
  };

  const totalCount = markers.length + drawings.length + viewsheds.length + rfCoverages.length;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl flex flex-col"
        style={{ width: 'min(95vw, 900px)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-emerald-400">{layerName}</h3>
            <span className="text-xs text-slate-500">{totalCount} {lang === 'no' ? 'objekter' : 'objects'}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
        </div>

        {/* Type tabs */}
        {availableTypes.length > 1 && (
          <div className="flex gap-1 px-4 pt-2 shrink-0">
            {availableTypes.map(type => (
              <button
                key={type}
                onClick={() => handleTypeChange(type)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeType === type
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {TYPE_LABELS[type]?.[lang] || type} ({
                  type === 'markers' ? markers.length :
                  type === 'drawings' ? drawings.length :
                  type === 'viewsheds' ? viewsheds.length :
                  rfCoverages.length
                })
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto px-4 py-2">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-600">
                <th className="py-1.5 px-2 text-left text-slate-500 font-medium w-8">#</th>
                {columns.map(col => (
                  <th key={col.key} className="py-1.5 px-2 text-left text-slate-500 font-medium">
                    <button
                      onClick={() => handleSort(col.key)}
                      className="hover:text-slate-300 transition-colors flex items-center gap-1"
                    >
                      {col.label}
                      {sortCol === col.key && (
                        <span className="text-emerald-400">{sortAsc ? '\u25B2' : '\u25BC'}</span>
                      )}
                    </button>
                  </th>
                ))}
                <th className="py-1.5 px-2 w-8" />
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-700">
                <td className="py-1 px-2" />
                {columns.map(col => (
                  <td key={col.key} className="py-1 px-2">
                    {col.key !== 'color' ? (
                      <input
                        value={filters[col.key] || ''}
                        onChange={(e) => handleFilter(col.key, e.target.value)}
                        placeholder={lang === 'no' ? 'Filter...' : 'Filter...'}
                        className="w-full px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                      />
                    ) : <span />}
                  </td>
                ))}
                <td className="py-1 px-2" />
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="py-4 text-center text-slate-500 italic">
                    {lang === 'no' ? 'Ingen treff' : 'No results'}
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => {
                  const coords = getItemCoords(activeType, item);
                  return (
                    <tr
                      key={item.id || idx}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors"
                      onClick={() => {
                        flyTo(coords);
                        if (activeType === 'markers' && onSelectMarker) onSelectMarker(item.id);
                        if (activeType === 'drawings' && onSelectDrawing) onSelectDrawing(item.id);
                      }}
                    >
                      <td className="py-1 px-2 text-slate-600">{page * PAGE_SIZE + idx + 1}</td>
                      {columns.map(col => {
                        const val = col.get(item);
                        // Render color as swatch
                        if (col.key === 'color') {
                          return (
                            <td key={col.key} className="py-1 px-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-3 h-3 rounded-sm border border-slate-600 shrink-0"
                                  style={{ backgroundColor: val }}
                                />
                                <span className="text-slate-400 font-mono text-[10px]">{val}</span>
                              </div>
                            </td>
                          );
                        }
                        // Render marker name with symbol icon
                        if (col.key === 'name' && activeType === 'markers') {
                          const sym = generateSymbolSvg(item.sidc, { size: 14 });
                          return (
                            <td key={col.key} className="py-1 px-2">
                              <div className="flex items-center gap-1.5">
                                <span className="w-4 h-4 shrink-0 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: sym.svg }} />
                                <span className="text-slate-200 truncate">{val}</span>
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className="py-1 px-2 text-slate-300 truncate max-w-[200px]" title={val}>
                            {val}
                          </td>
                        );
                      })}
                      <td className="py-1 px-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); flyTo(coords); }}
                          className="text-slate-600 hover:text-cyan-400 transition-colors"
                          title={lang === 'no' ? 'Fly til' : 'Fly to'}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 shrink-0">
          <span className="text-xs text-slate-500">
            {filteredData.length} / {rawData.length} {lang === 'no' ? 'rader' : 'rows'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              &laquo;
            </button>
            <span className="text-xs text-slate-400">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              &raquo;
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
