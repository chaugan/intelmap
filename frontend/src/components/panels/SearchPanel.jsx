import { useState } from 'react';
import { useSearch } from '../../hooks/useSearch.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function SearchPanel() {
  const lang = useMapStore((s) => s.lang);
  const flyTo = useMapStore((s) => s.flyTo);
  const [query, setQuery] = useState('');
  const { results, loading, search } = useSearch();

  const handleChange = (e) => {
    setQuery(e.target.value);
    search(e.target.value);
  };

  const handleSelect = (result) => {
    flyTo(result.lon, result.lat, 13);
  };

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('search.title', lang)}
      </h2>

      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={t('search.placeholder', lang)}
        className="bg-slate-700 text-sm px-3 py-2 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none mb-3"
        autoFocus
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
              {r.type} {r.municipality && `· ${r.municipality}`} {r.county && `· ${r.county}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
