import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { generateSymbolSvg } from '../../lib/milsymbol-utils.js';
import { DRAW_COLORS } from '../../lib/constants.js';
import { forward } from 'mgrs';

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

// Hex color to human-readable name
const COLOR_MAP = {};
for (const c of DRAW_COLORS) {
  COLOR_MAP[c.color.toLowerCase()] = { no: c.label, en: c.labelEn };
}

function colorName(hex, lang) {
  const entry = COLOR_MAP[hex?.toLowerCase()];
  if (entry) return entry[lang] || entry.en;
  return hex || '';
}

// Coordinate formatting
function toMgrs(lon, lat) {
  try { return forward([lon, lat], 5).replace(/(.{3})(.{2})(.{5})(.{5})/, '$1 $2 $3 $4'); } catch { return ''; }
}

function toUtm(lon, lat) {
  try {
    const mgrs = forward([lon, lat], 5);
    const m = mgrs.match(/^(\d{1,2})([A-Z])/);
    if (!m) return '';
    const zone = parseInt(m[1]);
    const band = m[2];
    // Use mgrs library to get accurate UTM via zone
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const a = 6378137;
    const f = 1 / 298.257223563;
    const e2 = 2 * f - f * f;
    const k0 = 0.9996;
    const lonOrigin = (zone - 1) * 6 - 180 + 3;
    const lonOriginRad = lonOrigin * Math.PI / 180;
    const ep2 = e2 / (1 - e2);
    const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = ep2 * Math.cos(latRad) ** 2;
    const A = Math.cos(latRad) * (lonRad - lonOriginRad);
    const M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * latRad
      - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*latRad)
      + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*latRad)
      - (35*e2**3/3072) * Math.sin(6*latRad));
    let easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*ep2)*A**5/120) + 500000;
    let northing = k0 * (M + N * Math.tan(latRad) * (A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*ep2)*A**6/720));
    if (lat < 0) northing += 10000000;
    return `${zone}${band} ${Math.round(easting)} ${Math.round(northing)}`;
  } catch { return ''; }
}

function formatGrid(lon, lat, gridMode) {
  if (!lon || !lat) return '';
  return gridMode === 'mgrs' ? toMgrs(lon, lat) : toUtm(lon, lat);
}

function getItemLonLat(type, item) {
  if (type === 'markers') return { lon: item.lon, lat: item.lat };
  if (type === 'viewsheds' || type === 'rfCoverages') return { lon: item.longitude, lat: item.latitude };
  if (type === 'drawings') {
    const g = item.geometry;
    if (g?.type === 'Point') return { lon: g.coordinates[0], lat: g.coordinates[1] };
    if (g?.type === 'LineString') { const mid = g.coordinates[Math.floor(g.coordinates.length / 2)]; return { lon: mid[0], lat: mid[1] }; }
    if (g?.type === 'Polygon') {
      const ring = g.coordinates[0];
      return { lon: ring.reduce((s, c) => s + c[0], 0) / ring.length, lat: ring.reduce((s, c) => s + c[1], 0) / ring.length };
    }
  }
  return { lon: null, lat: null };
}

// Column definitions per object type
function getColumns(type, lang, gridMode) {
  const gridCol = { key: 'grid', label: gridMode === 'mgrs' ? 'MGRS' : 'UTM', get: (item) => {
    const { lon, lat } = getItemLonLat(type, item);
    return formatGrid(lon, lat, gridMode);
  }};

  switch (type) {
    case 'markers': return [
      { key: 'name', label: lang === 'no' ? 'Navn' : 'Name', get: (m) => m.designation || m.customLabel || getSymbolName(m.sidc, lang) || '' },
      { key: 'sidc', label: 'SIDC', get: (m) => m.sidc || '' },
      { key: 'designation', label: lang === 'no' ? 'Betegnelse' : 'Designation', get: (m) => m.designation || '' },
      { key: 'higherFormation', label: lang === 'no' ? 'Høyere formasjon' : 'Higher formation', get: (m) => m.higherFormation || '' },
      { key: 'additionalInfo', label: lang === 'no' ? 'Tilleggsinformasjon' : 'Additional info', get: (m) => m.additionalInfo || '' },
      gridCol,
    ];
    case 'drawings': return [
      { key: 'label', label: lang === 'no' ? 'Navn' : 'Name', get: (d) => getDrawingLabel(d, lang) },
      { key: 'drawingType', label: 'Type', get: (d) => {
        const labels = { line: lang === 'no' ? 'Linje' : 'Line', arrow: lang === 'no' ? 'Pil' : 'Arrow', polygon: 'Polygon', circle: lang === 'no' ? 'Sirkel' : 'Circle', text: lang === 'no' ? 'Tekst' : 'Text', needle: lang === 'no' ? 'Nål' : 'Needle', grid: lang === 'no' ? 'Rutenett' : 'Grid' };
        return labels[d.drawingType] || d.drawingType || '';
      }},
      { key: 'color', label: lang === 'no' ? 'Farge' : 'Color', get: (d) => d.properties?.color || '#3b82f6' },
      gridCol,
    ];
    case 'viewsheds': return [
      { key: 'label', label: lang === 'no' ? 'Etikett' : 'Label', get: (v) => v.label || '' },
      { key: 'type', label: 'Type', get: (v) => v.type === 'horizon' ? (lang === 'no' ? 'Horisont' : 'Horizon') : (lang === 'no' ? 'Siktanalyse' : 'Viewshed') },
      { key: 'radiusKm', label: 'Radius', get: (v) => v.radiusKm ? `${Math.round(v.radiusKm * 10) / 10} km` : '' },
      { key: 'observerHeight', label: lang === 'no' ? 'Observatørhøyde' : 'Observer height', get: (v) => v.observerHeight ? `${v.observerHeight} m` : '' },
      { key: 'color', label: lang === 'no' ? 'Farge' : 'Color', get: (v) => v.color || '#ef4444' },
      gridCol,
    ];
    case 'rfCoverages': return [
      { key: 'frequency', label: lang === 'no' ? 'Frekvens' : 'Frequency', get: (c) => c.frequencyMHz ? `${c.frequencyMHz} MHz` : '' },
      { key: 'power', label: lang === 'no' ? 'Effekt' : 'Power', get: (c) => c.txPowerWatts ? `${c.txPowerWatts} W` : '' },
      { key: 'antennaHeight', label: lang === 'no' ? 'Antennehøyde' : 'Antenna height', get: (c) => c.antennaHeight ? `${c.antennaHeight} m` : '' },
      { key: 'radiusKm', label: 'Radius', get: (c) => c.radiusKm ? `${Math.round(c.radiusKm * 10) / 10} km` : '' },
      gridCol,
    ];
    default: return [];
  }
}

const TYPE_LABELS = {
  markers: { no: 'Markører', en: 'Markers' },
  drawings: { no: 'Tegninger', en: 'Drawings' },
  viewsheds: { no: 'Siktanalyser', en: 'Viewsheds' },
  rfCoverages: { no: 'RF-dekning', en: 'RF Coverages' },
};

function getItemCoords(type, item) {
  const { lon, lat } = getItemLonLat(type, item);
  return lon != null ? [lon, lat] : null;
}

// ── Export helpers ──

function escapeCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCsv(columns, data, filename, lang) {
  const header = columns.map(c => escapeCsv(c.label)).join(',');
  const rows = data.map(item =>
    columns.map(col => {
      const val = col.get(item);
      if (col.key === 'color') return escapeCsv(colorName(val, lang));
      return escapeCsv(val);
    }).join(',')
  );
  downloadFile('\uFEFF' + [header, ...rows].join('\r\n'), filename, 'text/csv;charset=utf-8');
}

function exportExcel(columns, data, filename, lang) {
  // Generate simple XLSX via XML spreadsheet format (Excel 2003 XML)
  const escXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#334155" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF" ss:Bold="1"/></Style></Styles>\n';
  xml += '<Worksheet ss:Name="Data"><Table>\n';
  // Header
  xml += '<Row ss:StyleID="header">';
  for (const col of columns) xml += `<Cell><Data ss:Type="String">${escXml(col.label)}</Data></Cell>`;
  xml += '</Row>\n';
  // Data rows
  for (const item of data) {
    xml += '<Row>';
    for (const col of columns) {
      let val = col.get(item);
      if (col.key === 'color') val = colorName(val, lang);
      const isNum = typeof val === 'number' || (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()));
      xml += `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(val)}</Data></Cell>`;
    }
    xml += '</Row>\n';
  }
  xml += '</Table></Worksheet></Workbook>';
  downloadFile(xml, filename, 'application/vnd.ms-excel');
}

export default function LayerTableView({ markers = [], drawings = [], viewsheds = [], rfCoverages = [], lang, mapRef, layerName, onClose, onSelectMarker, onSelectDrawing }) {
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
  const [filters, setFilters] = useState({});
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [gridMode, setGridMode] = useState('mgrs'); // 'mgrs' or 'utm'

  const rawData = useMemo(() => {
    switch (activeType) {
      case 'markers': return markers;
      case 'drawings': return drawings;
      case 'viewsheds': return viewsheds;
      case 'rfCoverages': return rfCoverages;
      default: return [];
    }
  }, [activeType, markers, drawings, viewsheds, rfCoverages]);

  const columns = useMemo(() => getColumns(activeType, lang, gridMode), [activeType, lang, gridMode]);

  const filteredData = useMemo(() => {
    let data = rawData;
    for (const col of columns) {
      const filterVal = filters[col.key]?.toLowerCase();
      if (filterVal) {
        let getVal = col.get;
        if (col.key === 'color') getVal = (item) => colorName(col.get(item), lang);
        data = data.filter(item => getVal(item).toString().toLowerCase().includes(filterVal));
      }
    }
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
  }, [rawData, columns, filters, sortCol, sortAsc, lang]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const pageData = filteredData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
    if (sortCol === key) setSortAsc(!sortAsc);
    else { setSortCol(key); setSortAsc(true); }
  };

  const flyTo = (coords) => {
    if (!mapRef || !coords) return;
    mapRef.flyTo({ center: coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
  };

  const safeName = layerName?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'layer';
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

  const totalCount = markers.length + drawings.length + viewsheds.length + rfCoverages.length;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl flex flex-col"
        style={{ width: 'min(95vw, 960px)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-emerald-400">{layerName}</h3>
            <span className="text-xs text-slate-500">{totalCount} {lang === 'no' ? 'objekter' : 'objects'}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Grid mode toggle */}
            <div className="flex rounded overflow-hidden border border-slate-600 text-[10px]">
              <button
                onClick={() => setGridMode('mgrs')}
                className={`px-2 py-0.5 ${gridMode === 'mgrs' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
              >MGRS</button>
              <button
                onClick={() => setGridMode('utm')}
                className={`px-2 py-0.5 ${gridMode === 'utm' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
              >UTM</button>
            </div>
            {/* Export buttons */}
            <button
              onClick={() => exportCsv(columns, filteredData, `${safeName}_${ts}.csv`, lang)}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600"
              title="CSV"
            >CSV</button>
            <button
              onClick={() => exportExcel(columns, filteredData, `${safeName}_${ts}.xls`, lang)}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600"
              title="Excel"
            >Excel</button>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none ml-2">&times;</button>
          </div>
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
                    <input
                      value={filters[col.key] || ''}
                      onChange={(e) => handleFilter(col.key, e.target.value)}
                      placeholder="Filter..."
                      className="w-full px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                    />
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
                        if (col.key === 'color') {
                          const name = colorName(val, lang);
                          return (
                            <td key={col.key} className="py-1 px-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-3 h-3 rounded-sm border border-slate-600 shrink-0"
                                  style={{ backgroundColor: val }}
                                />
                                <span className="text-slate-300">{name}</span>
                              </div>
                            </td>
                          );
                        }
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
                        if (col.key === 'grid') {
                          return (
                            <td key={col.key} className="py-1 px-2 text-slate-400 font-mono text-[10px] whitespace-nowrap" title={val}>
                              {val}
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
            >&laquo;</button>
            <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >&raquo;</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
