import { useState, useRef } from 'react';
import { resolveMgrs } from '../../lib/mgrs-utils.js';
import { generateCirclePolygon } from '../../lib/drawing-utils.js';
import { t } from '../../lib/i18n.js';

const VALID_TYPES = ['circle', 'line', 'arrow'];

function normalizeColor(color, defaultColor) {
  if (!color || !color.trim()) return defaultColor;
  let c = color.trim();
  // Bare hex (6 or 3 chars) → prepend #
  if (/^[0-9a-fA-F]{6}$/.test(c) || /^[0-9a-fA-F]{3}$/.test(c)) {
    c = '#' + c;
  }
  // Validate via Option.style trick
  const s = new Option().style;
  s.color = c;
  if (s.color === '') return defaultColor;
  return c;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseRows(text, mapCenter, defaultColor, lang) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  let startIdx = 0;
  // Auto-detect header row
  const firstLower = lines[0].toLowerCase();
  if (firstLower.includes('coordinate') || firstLower.includes('type')) {
    startIdx = 1;
  }

  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const [coord1Raw = '', coord2Raw = '', typeRaw = '', sizeRaw = '', label = '', colorRaw = ''] = fields;

    const type = typeRaw.trim().toLowerCase();
    const size = parseFloat(sizeRaw);
    const color = normalizeColor(colorRaw, defaultColor);
    let valid = true;
    let error = '';

    // Validate type
    if (!VALID_TYPES.includes(type)) {
      valid = false;
      error = t('draw.csvInvalidType', lang);
    }

    // Parse coord1
    let lon1 = null, lat1 = null;
    if (valid && coord1Raw.trim()) {
      const candidates = resolveMgrs(coord1Raw.trim(), mapCenter);
      if (candidates.length > 0) {
        lon1 = candidates[0].lon;
        lat1 = candidates[0].lat;
      } else {
        valid = false;
        error = t('draw.csvInvalidCoord', lang);
      }
    } else if (valid) {
      valid = false;
      error = t('draw.csvInvalidCoord', lang);
    }

    // Type-specific validation
    let lon2 = null, lat2 = null;
    if (valid && (type === 'line' || type === 'arrow')) {
      if (coord2Raw.trim()) {
        const candidates2 = resolveMgrs(coord2Raw.trim(), mapCenter);
        if (candidates2.length > 0) {
          lon2 = candidates2[0].lon;
          lat2 = candidates2[0].lat;
        } else {
          valid = false;
          error = t('draw.csvNeedsTwoCoords', lang);
        }
      } else {
        valid = false;
        error = t('draw.csvNeedsTwoCoords', lang);
      }
    }

    if (valid && type === 'circle') {
      if (!size || size <= 0 || isNaN(size)) {
        valid = false;
        error = t('draw.csvNeedsSize', lang);
      }
    }

    rows.push({
      coord1: coord1Raw.trim(),
      coord2: coord2Raw.trim(),
      type,
      size: isNaN(size) ? null : size,
      label: label.trim(),
      color,
      lon1, lat1, lon2, lat2,
      valid,
      error,
      checked: valid,
    });
  }
  return rows;
}

function buildDrawing(row) {
  if (row.type === 'circle') {
    const coords = generateCirclePolygon([row.lon1, row.lat1], row.size / 1000);
    return {
      drawingType: 'circle',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {
        color: row.color,
        lineType: 'solid',
        fillOpacity: 0.15,
        label: row.label || undefined,
        strokeWidth: 3,
      },
    };
  }
  // line or arrow
  return {
    drawingType: row.type,
    geometry: {
      type: 'LineString',
      coordinates: [[row.lon1, row.lat1], [row.lon2, row.lat2]],
    },
    properties: {
      color: row.color,
      lineType: row.type === 'arrow' ? 'arrow' : 'solid',
      fillOpacity: 0.15,
      label: row.label || undefined,
      strokeWidth: 3,
    },
  };
}

export default function CsvDrawingImportDialog({ open, onClose, onImport, defaultColor, lang, mapCenter }) {
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);
  const [parsed, setParsed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const fileRef = useRef(null);

  if (!open) return null;

  const handleParse = () => {
    const center = { lng: mapCenter.lng, lat: mapCenter.lat };
    const result = parseRows(csvText, center, defaultColor, lang);
    setRows(result);
    setParsed(true);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target.result);
      setParsed(false);
      setRows([]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toggleRow = (idx) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, checked: !r.checked } : r));
  };

  const validRows = rows.filter((r) => r.valid);
  const checkedRows = rows.filter((r) => r.checked && r.valid);
  const allValidChecked = validRows.length > 0 && validRows.every((r) => r.checked);

  const toggleAll = () => {
    const newVal = !allValidChecked;
    setRows((prev) => prev.map((r) => r.valid ? { ...r, checked: newVal } : r));
  };

  const handleImport = () => {
    const drawings = checkedRows.map(buildDrawing);
    onImport(drawings);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-2xl p-6 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">{t('draw.importCsv', lang)}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Help toggle */}
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-blue-400 hover:text-blue-300 mb-2 text-left"
        >
          {showHelp ? '▼' : '▶'} {t('draw.csvFormatHelp', lang)}
        </button>
        {showHelp && (
          <div className="bg-slate-900 border border-slate-600 rounded p-3 mb-3 text-xs text-slate-300 font-mono leading-relaxed">
            <div className="mb-1 font-sans text-slate-400">{t('draw.csvFormatDesc', lang)}</div>
            <div>coord1, coord2, type, size, label, color</div>
            <div className="text-slate-500 mt-1">32VNM7878776938,,circle,500,HQ,#ff0000</div>
            <div className="text-slate-500">32VNM1234567890,32VNM9876543210,line,,Supply Route,blue</div>
            <div className="text-slate-500">32VNM1111122222,32VNM3333344444,arrow,,Attack Axis,</div>
          </div>
        )}

        {/* Textarea */}
        <textarea
          value={csvText}
          onChange={(e) => { setCsvText(e.target.value); setParsed(false); setRows([]); }}
          placeholder={t('draw.csvPaste', lang)}
          className="w-full h-32 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white font-mono focus:outline-none focus:border-blue-500 resize-y mb-3"
        />

        {/* Buttons row */}
        <div className="flex items-center gap-2 mb-3">
          <input type="file" accept=".csv,.txt" ref={fileRef} className="hidden" onChange={handleFileUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white transition-colors"
          >
            {t('draw.csvUpload', lang)}
          </button>
          <div className="flex-1" />
          <button
            onClick={handleParse}
            disabled={!csvText.trim()}
            className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm text-white transition-colors disabled:opacity-50"
          >
            {t('draw.csvParse', lang)}
          </button>
        </div>

        {/* Preview table */}
        {parsed && rows.length > 0 && (
          <div className="flex-1 overflow-auto min-h-0">
            {/* Select all */}
            <label className="flex items-center gap-2 mb-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={allValidChecked} onChange={toggleAll} className="accent-blue-500" />
              {allValidChecked ? t('draw.csvDeselectAll', lang) : t('draw.csvSelectAll', lang)}
              <span className="text-slate-500">({validRows.length} {lang === 'no' ? 'gyldige' : 'valid'})</span>
            </label>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-600">
                  <th className="w-8 py-1"></th>
                  <th className="w-8 py-1 text-left">#</th>
                  <th className="py-1 text-left">Coord1</th>
                  <th className="py-1 text-left">Coord2</th>
                  <th className="w-14 py-1 text-left">{lang === 'no' ? 'Type' : 'Type'}</th>
                  <th className="w-14 py-1 text-left">{lang === 'no' ? 'Størrelse' : 'Size'}</th>
                  <th className="py-1 text-left">{lang === 'no' ? 'Etikett' : 'Label'}</th>
                  <th className="w-10 py-1 text-left">{lang === 'no' ? 'Farge' : 'Color'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-700/50 ${!row.valid ? 'opacity-40' : ''}`}
                    title={row.error || ''}
                  >
                    <td className="py-1 text-center">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        disabled={!row.valid}
                        onChange={() => toggleRow(idx)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="py-1 text-slate-500">{idx + 1}</td>
                    <td className="py-1 text-slate-200 max-w-[120px] truncate" title={row.coord1}>{row.coord1 || '-'}</td>
                    <td className="py-1 text-slate-200 max-w-[120px] truncate" title={row.coord2}>{row.coord2 || '-'}</td>
                    <td className="py-1 text-slate-200">{row.type || '-'}</td>
                    <td className="py-1 text-slate-200">{row.size || '-'}</td>
                    <td className="py-1 text-slate-200 max-w-[100px] truncate" title={row.label}>{row.label || '-'}</td>
                    <td className="py-1">
                      <div className="w-4 h-4 rounded-full border border-slate-500" style={{ backgroundColor: row.color }} />
                    </td>
                    {!row.valid && (
                      <td className="py-1 text-red-400 text-[10px] pl-1">{row.error}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {parsed && rows.length === 0 && (
          <div className="text-sm text-slate-400 text-center py-4">
            {lang === 'no' ? 'Ingen rader funnet' : 'No rows found'}
          </div>
        )}

        {/* Import button */}
        {parsed && checkedRows.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <button
              onClick={handleImport}
              className="w-full px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm text-white font-medium transition-colors"
            >
              {t('draw.csvImport', lang)} ({checkedRows.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
