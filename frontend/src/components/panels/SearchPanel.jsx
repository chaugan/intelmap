import { useState, useEffect, useRef } from 'react';
import { useSearch } from '../../hooks/useSearch.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import { resolveMgrs } from '../../lib/mgrs-utils.js';

export default function SearchPanel() {
  const lang = useMapStore((s) => s.lang);
  const flyTo = useMapStore((s) => s.flyTo);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const mapRef = useMapStore((s) => s.mapRef);
  const addMgrsMarker = useMapStore((s) => s.addMgrsMarker);
  const clearUnpinnedMgrsMarkers = useMapStore((s) => s.clearUnpinnedMgrsMarkers);
  const [query, setQuery] = useState('');
  const [mgrsResults, setMgrsResults] = useState([]);
  const { results, loading, search, setResults } = useSearch();
  const inputRef = useRef(null);

  // Delayed focus to avoid keyup inserting the trigger character
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Clear unpinned MGRS markers when panel unmounts
  useEffect(() => {
    return () => clearUnpinnedMgrsMarkers();
  }, [clearUnpinnedMgrsMarkers]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    // Check if input matches MGRS patterns: "32V NN 78787 76938", "32V 78787 76938", "78787 76938", "537327 6613704"
    if (/^\s*(\d{1,2}\s*[A-Za-z]\s+([A-Za-z]{2}\s+)?)?\d{2,}\s+\d{2,}\s*$/.test(val)) {
      const center = mapRef?.getCenter();
      if (center) {
        const candidates = resolveMgrs(val, center);
        setMgrsResults(candidates);
        if (candidates.length > 0) {
          setResults([]);
          return;
        }
      }
    }

    setMgrsResults([]);
    search(val);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (query.length > 0) {
        setQuery('');
        setResults([]);
        setMgrsResults([]);
        e.stopPropagation();
      } else {
        setActivePanel(null);
      }
      return;
    }
    if (e.key === 'Enter') {
      if (mgrsResults.length > 0) {
        e.preventDefault();
        handleMgrsSelect(mgrsResults[0]);
      } else if (results.length > 0) {
        e.preventDefault();
        handleSelect(results[0]);
      }
    }
  };

  const handleMgrsSelect = (candidate) => {
    flyTo(candidate.lon, candidate.lat, 15);
    addMgrsMarker({ lng: candidate.lon, lat: candidate.lat, mgrs: candidate.mgrsFormatted });
  };

  const handleSelect = (result) => {
    let zoom = 15; // default for Adresse
    if (result.type && result.type !== 'Adresse') {
      const t = result.type;
      if (t === 'By' || t === 'Tettsted') zoom = 12;
      else if (['Fjord', 'Dal', 'Vidde', 'Innsjø', 'Bre'].includes(t)) zoom = 11;
      else if (['Fjell', 'Øy', 'Halvøy'].includes(t)) zoom = 12;
      else if (['Bygd', 'Grend'].includes(t)) zoom = 13;
      else zoom = 13;
    }
    flyTo(result.lon, result.lat, zoom);
  };

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('search.title', lang)}
      </h2>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t('search.placeholder', lang)}
        className="bg-slate-700 text-sm px-3 py-2 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none mb-3"
      />

      <div className="flex-1 overflow-y-auto space-y-1">
        {/* MGRS candidates */}
        {mgrsResults.length > 0 && (
          <>
            {mgrsResults.map((c, i) => (
              <button
                key={i}
                onClick={() => handleMgrsSelect(c)}
                className="w-full text-left bg-slate-700/50 hover:bg-slate-600 rounded px-3 py-2 transition-colors"
              >
                <div className="text-sm font-mono font-medium text-emerald-300">{c.mgrsFormatted}</div>
                <div className="text-[10px] text-slate-400">
                  {c.lat.toFixed(5)}, {c.lon.toFixed(5)}
                  {i === 0 && <span className="ml-2 text-emerald-400">({t('search.mgrsNearest', lang)})</span>}
                  {i > 0 && <span className="ml-2">{Math.round(c.distance)} km</span>}
                </div>
              </button>
            ))}
          </>
        )}

        {/* Address/place results */}
        {loading && <p className="text-sm text-slate-400">{t('general.loading', lang)}</p>}
        {!loading && results.length === 0 && mgrsResults.length === 0 && query.length >= 2 && (
          <p className="text-sm text-slate-500">{t('search.noResults', lang)}</p>
        )}
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => handleSelect(r)}
            className="w-full text-left bg-slate-700/50 hover:bg-slate-600 rounded px-3 py-2 transition-colors"
          >
            <div className="text-sm">{r.name}</div>
            <div className="text-[10px] text-slate-400">
              {r.postcode && r.city ? `${r.postcode} ${r.city}` : r.type}
              {r.municipality && ` · ${r.municipality}`}
              {!r.postcode && r.county && ` · ${r.county}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
