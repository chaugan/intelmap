import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { t } from '../../lib/i18n.js';
import { resolveMgrs, toMGRS } from '../../lib/mgrs-utils.js';
import { socket } from '../../lib/socket.js';

const FIRE_SUPPORT_TYPES = ['AD', 'CAS', 'ROC', 'GUN', 'MRT'];
const GEOMETRY_OPTIONS = ['point', 'area', 'line', 'custom'];
const FIELDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function loadSaved(letter) {
  try {
    const save = localStorage.getItem(`fireReport_${letter}_save`);
    if (save === 'true') {
      return localStorage.getItem(`fireReport_${letter}_value`) || '';
    }
  } catch {}
  return '';
}

function loadSaveChecked(letter) {
  try {
    return localStorage.getItem(`fireReport_${letter}_save`) === 'true';
  } catch {}
  return false;
}

export default function FireReportDrawer() {
  const lang = useMapStore((s) => s.lang);
  const phase = useMapStore((s) => s.fireReportPhase);
  const target = useMapStore((s) => s.fireReportTarget);
  const setTarget = useMapStore((s) => s.setFireReportTarget);
  const setPhase = useMapStore((s) => s.setFireReportPhase);
  const toggleTool = useMapStore((s) => s.toggleFireReportTool);
  const longitude = useMapStore((s) => s.longitude);
  const latitude = useMapStore((s) => s.latitude);

  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Form state
  const [fieldA, setFieldA] = useState(loadSaved('A'));
  const [fieldB, setFieldB] = useState(loadSaved('B') || '');
  const [fieldC, setFieldC] = useState(loadSaved('C'));
  const [fieldD, setFieldD] = useState('');
  const [fieldE, setFieldE] = useState(loadSaved('E'));
  const [fieldF, setFieldF] = useState(loadSaved('F') || 'point');
  const [fieldFCustom, setFieldFCustom] = useState(loadSaved('F_custom'));
  const [fieldG, setFieldG] = useState(loadSaved('G') || 'ASAP');
  const [fieldH, setFieldH] = useState(loadSaved('H'));

  // Save checkboxes
  const [saveA, setSaveA] = useState(loadSaveChecked('A'));
  const [saveB, setSaveB] = useState(loadSaveChecked('B'));
  const [saveC, setSaveC] = useState(loadSaveChecked('C'));
  const [saveE, setSaveE] = useState(loadSaveChecked('E'));
  const [saveF, setSaveF] = useState(loadSaveChecked('F'));
  const [saveG, setSaveG] = useState(loadSaveChecked('G'));
  const [saveH, setSaveH] = useState(loadSaveChecked('H'));

  const [copied, setCopied] = useState(false);

  // Sync field D with target MGRS
  useEffect(() => {
    if (target?.mgrs) {
      setFieldD(target.mgrs);
    }
  }, [target?.mgrs]);

  // Persist save states
  useEffect(() => {
    const saves = { A: saveA, B: saveB, C: saveC, E: saveE, F: saveF, G: saveG, H: saveH };
    const vals = { A: fieldA, B: fieldB, C: fieldC, E: fieldE, F: fieldF, G: fieldG, H: fieldH };
    for (const [letter, checked] of Object.entries(saves)) {
      localStorage.setItem(`fireReport_${letter}_save`, String(checked));
      if (checked) {
        localStorage.setItem(`fireReport_${letter}_value`, vals[letter]);
      }
    }
    if (saveF) {
      localStorage.setItem('fireReport_F_custom_value', fieldFCustom);
    }
  }, [saveA, saveB, saveC, saveE, saveF, saveG, saveH, fieldA, fieldB, fieldC, fieldE, fieldF, fieldFCustom, fieldG, fieldH]);

  // Search MGRS/UTM
  const handleSearch = useCallback(() => {
    if (!searchInput.trim()) { setSearchResults([]); return; }
    const center = { lng: longitude, lat: latitude };
    const results = resolveMgrs(searchInput.trim(), center);
    setSearchResults(results.slice(0, 5));
  }, [searchInput, longitude, latitude]);

  const handleSearchSelect = useCallback((result) => {
    const mgrs = result.mgrsFormatted || toMGRS(result.lat, result.lon);
    setTarget({ lng: result.lon, lat: result.lat, mgrs });
    setSearchResults([]);
    setSearchInput('');
    // Fly to selected location
    const map = useMapStore.getState().mapRef;
    if (map) {
      map.flyTo({ center: [result.lon, result.lat], zoom: Math.max(map.getZoom(), 13), duration: 1500 });
    }
  }, [setTarget]);

  const handleFire = useCallback(() => {
    setPhase('form');
  }, [setPhase]);

  const handleRepick = useCallback(() => {
    setTarget(null);
    setPhase('select');
  }, [setTarget, setPhase]);

  const getGeometryLabel = (val) => {
    const key = `fireReport.${val}`;
    return t(key, lang);
  };

  const formatReport = () => {
    const geoVal = fieldF === 'custom' ? fieldFCustom : getGeometryLabel(fieldF);
    return [
      lang === 'no' ? 'ILDRAPPORT (F1)' : 'FIRE REPORT (F1)',
      `A: ${fieldA}`,
      `B: ${fieldB}`,
      `C: ${fieldC}`,
      `D: ${fieldD}`,
      `E: ${fieldE}`,
      `F: ${geoVal}`,
      `G: ${fieldG}`,
      `H: ${fieldH}`,
    ].join('\n');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatReport());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleSaveToProject = () => {
    if (!activeProjectId || !target) return;
    socket.emit('client:marker:add', {
      projectId: activeProjectId,
      sidc: 'SHGPUCFT--*****', // hostile ground target
      lat: target.lat,
      lon: target.lng,
      designation: `ART STRIKE ORDERED, ${fieldC}`,
      higherFormation: '',
      additionalInfo: formatReport(),
      layerId: activeLayerId || null,
      source: 'user',
      createdBy: socket.id,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-red-900/50 border-b border-slate-700 shrink-0">
        <h2 className="font-bold text-sm text-red-300">{t('fireReport.title', lang)}</h2>
        <button onClick={toggleTool} className="text-slate-400 hover:text-white transition-colors" title="Close">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {phase === 'select' && (
          <SelectPhase
            lang={lang}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            handleSearch={handleSearch}
            searchResults={searchResults}
            handleSearchSelect={handleSearchSelect}
            target={target}
            handleFire={handleFire}
          />
        )}

        {phase === 'form' && (
          <FormPhase
            lang={lang}
            fieldA={fieldA} setFieldA={setFieldA} saveA={saveA} setSaveA={setSaveA}
            fieldB={fieldB} setFieldB={setFieldB} saveB={saveB} setSaveB={setSaveB}
            fieldC={fieldC} setFieldC={setFieldC} saveC={saveC} setSaveC={setSaveC}
            fieldD={fieldD} setFieldD={setFieldD}
            fieldE={fieldE} setFieldE={setFieldE} saveE={saveE} setSaveE={setSaveE}
            fieldF={fieldF} setFieldF={setFieldF} saveF={saveF} setSaveF={setSaveF}
            fieldFCustom={fieldFCustom} setFieldFCustom={setFieldFCustom}
            fieldG={fieldG} setFieldG={setFieldG} saveG={saveG} setSaveG={setSaveG}
            fieldH={fieldH} setFieldH={setFieldH} saveH={saveH} setSaveH={setSaveH}
            copied={copied}
            handleCopy={handleCopy}
            handleRepick={handleRepick}
            handleSaveToProject={handleSaveToProject}
            activeProjectId={activeProjectId}
            getGeometryLabel={getGeometryLabel}
          />
        )}
      </div>
    </div>
  );
}

function SelectPhase({ lang, searchInput, setSearchInput, handleSearch, searchResults, handleSearchSelect, target, handleFire }) {
  return (
    <>
      <p className="text-xs text-slate-400">
        {t('fireReport.selectTarget', lang)}
      </p>

      {/* MGRS/UTM search */}
      <div className="flex gap-1">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('fireReport.searchPlaceholder', lang)}
          className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <button onClick={handleSearch} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="space-y-1">
          {searchResults.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSearchSelect(r)}
              className="w-full text-left px-2 py-1.5 bg-slate-700/50 hover:bg-slate-600 rounded text-xs font-mono transition-colors"
            >
              {r.mgrsFormatted} <span className="text-slate-500 ml-1">({r.distance?.toFixed(0)} km)</span>
            </button>
          ))}
        </div>
      )}

      {/* Target selected */}
      {target && (
        <div className="bg-slate-700/50 rounded p-3 text-center space-y-2">
          <div className="font-mono text-emerald-400 text-sm">{target.mgrs}</div>
          <button
            onClick={handleFire}
            className="px-6 py-2 bg-red-700 hover:bg-red-600 text-white font-bold rounded text-lg transition-colors"
          >
            {t('fireReport.fire', lang)}
          </button>
        </div>
      )}
    </>
  );
}

function FormPhase({
  lang,
  fieldA, setFieldA, saveA, setSaveA,
  fieldB, setFieldB, saveB, setSaveB,
  fieldC, setFieldC, saveC, setSaveC,
  fieldD, setFieldD,
  fieldE, setFieldE, saveE, setSaveE,
  fieldF, setFieldF, saveF, setSaveF,
  fieldFCustom, setFieldFCustom,
  fieldG, setFieldG, saveG, setSaveG,
  fieldH, setFieldH, saveH, setSaveH,
  copied, handleCopy, handleRepick, handleSaveToProject,
  activeProjectId, getGeometryLabel,
}) {
  const inputClass = "w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500";
  const selectClass = "w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500";

  return (
    <div className="space-y-2">
      {/* A - Reporting Unit */}
      <FieldRow letter="A" label={t('fireReport.fieldA', lang)} save={saveA} setSave={setSaveA}>
        <input type="text" value={fieldA} onChange={(e) => setFieldA(e.target.value)}
          placeholder={t('fireReport.placeholderA', lang)} className={inputClass} />
      </FieldRow>

      {/* B - Fire Support Type */}
      <FieldRow letter="B" label={t('fireReport.fieldB', lang)} save={saveB} setSave={setSaveB}>
        <select value={fieldB} onChange={(e) => setFieldB(e.target.value)} className={selectClass}>
          <option value="">—</option>
          {FIRE_SUPPORT_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </FieldRow>

      {/* C - Target Description */}
      <FieldRow letter="C" label={t('fireReport.fieldC', lang)} save={saveC} setSave={setSaveC}>
        <input type="text" value={fieldC} onChange={(e) => setFieldC(e.target.value)}
          placeholder={t('fireReport.placeholderC', lang)} className={inputClass} />
      </FieldRow>

      {/* D - Target Location */}
      <FieldRow letter="D" label={t('fireReport.fieldD', lang)}>
        <input type="text" value={fieldD} onChange={(e) => setFieldD(e.target.value)}
          className={`${inputClass} font-mono text-emerald-400`} />
      </FieldRow>

      {/* E - Effort */}
      <FieldRow letter="E" label={t('fireReport.fieldE', lang)} save={saveE} setSave={setSaveE}>
        <input type="text" value={fieldE} onChange={(e) => setFieldE(e.target.value)}
          placeholder={t('fireReport.placeholderE', lang)} className={inputClass} />
      </FieldRow>

      {/* F - Target Geometry */}
      <FieldRow letter="F" label={t('fireReport.fieldF', lang)} save={saveF} setSave={setSaveF}>
        <select value={fieldF} onChange={(e) => setFieldF(e.target.value)} className={selectClass}>
          {GEOMETRY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{getGeometryLabel(opt)}</option>
          ))}
        </select>
        {fieldF === 'custom' && (
          <input type="text" value={fieldFCustom} onChange={(e) => setFieldFCustom(e.target.value)}
            placeholder={t('fireReport.placeholderFCustom', lang)}
            className={`${inputClass} mt-1`} />
        )}
      </FieldRow>

      {/* G - Time */}
      <FieldRow letter="G" label={t('fireReport.fieldG', lang)} save={saveG} setSave={setSaveG}>
        <input type="text" value={fieldG} onChange={(e) => setFieldG(e.target.value)}
          placeholder="ASAP" className={inputClass} />
      </FieldRow>

      {/* H - Desired Effect */}
      <FieldRow letter="H" label={t('fireReport.fieldH', lang)} save={saveH} setSave={setSaveH}>
        <input type="text" value={fieldH} onChange={(e) => setFieldH(e.target.value)}
          placeholder={t('fireReport.placeholderH', lang)} className={inputClass} />
      </FieldRow>

      {/* Buttons */}
      <div className="space-y-2 pt-2">
        <button onClick={handleCopy}
          className={`w-full py-2 rounded font-bold text-sm transition-colors ${
            copied ? 'bg-emerald-700 text-white' : 'bg-red-700 hover:bg-red-600 text-white'
          }`}>
          {copied ? t('fireReport.copied', lang) : t('fireReport.copy', lang)}
        </button>

        {activeProjectId && (
          <button onClick={handleSaveToProject}
            className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-sm font-medium transition-colors">
            {t('fireReport.saveToProject', lang)}
          </button>
        )}

        <button onClick={handleRepick}
          className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors">
          {t('fireReport.repick', lang)}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ letter, label, save, setSave, children }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400">
          <span className="font-bold text-red-400 mr-1">{letter}</span>
          {label}
        </label>
        {setSave && (
          <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer" title={save ? 'Saved' : 'Not saved'}>
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)}
              className="w-3 h-3 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0" />
          </label>
        )}
      </div>
      {children}
    </div>
  );
}
