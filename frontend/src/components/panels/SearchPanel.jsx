import { useState, useEffect, useRef } from 'react';
import { useSearch } from '../../hooks/useSearch.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function SearchPanel() {
  const lang = useMapStore((s) => s.lang);
  const flyTo = useMapStore((s) => s.flyTo);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const [query, setQuery] = useState('');
  const { results, loading, search, setResults } = useSearch();
  const inputRef = useRef(null);

  // Delayed focus to avoid keyup inserting the trigger character
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleChange = (e) => {
    setQuery(e.target.value);
    search(e.target.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (query.length > 0) {
        setQuery('');
        setResults([]);
        e.stopPropagation();
      } else {
        setActivePanel(null);
      }
      return;
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[0]);
    }
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
        {loading && <p className="text-sm text-slate-400">{t('general.loading', lang)}</p>}
        {!loading && results.length === 0 && query.length >= 2 && (
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
