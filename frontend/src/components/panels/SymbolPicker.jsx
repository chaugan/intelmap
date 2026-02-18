import { useState, useMemo } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { SYMBOL_CATEGORIES } from '../../lib/constants.js';
import { generateSymbolSvg, getAffiliation } from '../../lib/milsymbol-utils.js';
import { t } from '../../lib/i18n.js';

const affiliationLabels = {
  friendly: { en: 'Friendly', no: 'Vennlig' },
  hostile: { en: 'Hostile', no: 'Fiendtlig' },
  neutral: { en: 'Neutral', no: 'Nøytral' },
  unknown: { en: 'Unknown', no: 'Ukjent' },
};

const categoryKeys = Object.keys(SYMBOL_CATEGORIES);

// Simple fuzzy match: checks if all characters of query appear in order in target
function fuzzyMatch(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// Score: lower is better. Prefers prefix matches and shorter targets.
function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const tLower = target.toLowerCase();
  if (tLower.startsWith(q)) return 0;
  if (tLower.includes(q)) return 1;
  return 2;
}

export default function SymbolPicker() {
  const lang = useMapStore((s) => s.lang);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);
  const layers = useTacticalStore((s) => s.layers);
  const [category, setCategory] = useState(categoryKeys[0]);
  const [tab, setTab] = useState('friendly');
  const [designation, setDesignation] = useState('');
  const [selectedLayer, setSelectedLayer] = useState('');
  const [search, setSearch] = useState('');

  const tabs = [
    { id: 'friendly', label: t('symbols.friendly', lang), color: 'text-blue-400' },
    { id: 'hostile', label: t('symbols.hostile', lang), color: 'text-red-400' },
    { id: 'neutral', label: t('symbols.neutral', lang), color: 'text-green-400' },
  ];

  // When searching, search across ALL categories and affiliations; otherwise use selected category/tab
  const symbols = useMemo(() => {
    if (!search.trim()) {
      const cat = SYMBOL_CATEGORIES[category];
      return cat?.[tab] || [];
    }

    // Gather all symbols from all categories and affiliations
    const all = [];
    for (const catKey of categoryKeys) {
      const cat = SYMBOL_CATEGORIES[catKey];
      for (const affiliation of ['friendly', 'hostile', 'neutral']) {
        for (const sym of (cat[affiliation] || [])) {
          const nameEn = sym.name.en || '';
          const nameNo = sym.name.no || '';
          if (fuzzyMatch(search, nameEn) || fuzzyMatch(search, nameNo) || fuzzyMatch(search, sym.sidc)) {
            all.push({ ...sym, _catKey: catKey, _affiliation: affiliation });
          }
        }
      }
    }

    // Sort by relevance
    all.sort((a, b) => {
      const aName = a.name[lang] || a.name.en;
      const bName = b.name[lang] || b.name.en;
      return fuzzyScore(search, aName) - fuzzyScore(search, bName);
    });

    return all;
  }, [search, category, tab, lang]);

  const handleSelect = (sidc) => {
    setPlacementMode({
      sidc,
      designation,
      layerId: selectedLayer || null,
    });
  };

  const isSearching = search.trim().length > 0;

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('symbols.title', lang)}
      </h2>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={lang === 'no' ? 'Sok symbol...' : 'Search symbol...'}
        className="bg-slate-700 text-sm px-2 py-1.5 rounded border border-slate-600 focus:border-cyan-500 focus:outline-none mb-2"
      />

      {/* Category selector (hidden when searching) */}
      {!isSearching && (
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-slate-700 text-sm px-2 py-1.5 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none mb-2"
        >
          {categoryKeys.map((key) => (
            <option key={key} value={key}>
              {SYMBOL_CATEGORIES[key].name[lang] || SYMBOL_CATEGORIES[key].name.en}
            </option>
          ))}
        </select>
      )}

      {/* Designation input */}
      <input
        type="text"
        value={designation}
        onChange={(e) => setDesignation(e.target.value)}
        placeholder={t('symbols.designation', lang)}
        className="bg-slate-700 text-sm px-2 py-1.5 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none mb-2"
      />

      {/* Layer selector */}
      <select
        value={selectedLayer}
        onChange={(e) => setSelectedLayer(e.target.value)}
        className="bg-slate-700 text-sm px-2 py-1.5 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none mb-3"
      >
        <option value="">{lang === 'no' ? '(Intet lag)' : '(No layer)'}</option>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>

      {/* Affiliation tabs (hidden when searching) */}
      {!isSearching && (
        <div className="flex gap-1 mb-3">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex-1 text-xs py-1 rounded transition-colors ${
                tab === tb.id ? 'bg-slate-600 ' + tb.color : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}

      {/* Symbol grid */}
      <div className="flex-1 overflow-y-auto">
        {symbols.length === 0 && isSearching && (
          <div className="text-slate-500 text-xs text-center py-4">
            {lang === 'no' ? 'Ingen treff' : 'No matches'}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {symbols.map((sym) => {
            const rendered = generateSymbolSvg(sym.sidc, { size: 30 });
            return (
              <button
                key={sym.sidc + (sym._affiliation || '')}
                onClick={() => handleSelect(sym.sidc)}
                className="flex flex-col items-center gap-1 bg-slate-700/50 hover:bg-slate-600 rounded p-2 transition-colors"
                title={`${sym.name[lang] || sym.name.en} (${affiliationLabels[sym._affiliation || getAffiliation(sym.sidc)]?.[lang] || ''}) — ${sym.sidc}`}
              >
                <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
                <span className="text-[10px] text-slate-300 text-center leading-tight">
                  {sym.name[lang] || sym.name.en}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-2">{t('symbols.clickMap', lang)}</p>
    </div>
  );
}
