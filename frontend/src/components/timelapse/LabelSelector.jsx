import { useState, useRef, useEffect } from 'react';
import { YOLO_LABELS } from '../../stores/useMonitoringStore.js';

export default function LabelSelector({ selected = [], onChange, lang }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter available labels (not selected)
  const availableLabels = YOLO_LABELS
    .filter(label => !selected.includes(label))
    .filter(label => label.toLowerCase().includes(filter.toLowerCase()))
    .sort();

  function toggleLabel(label) {
    if (selected.includes(label)) {
      onChange(selected.filter(l => l !== label));
    } else {
      onChange([...selected, label]);
    }
  }

  function removeLabel(label) {
    onChange(selected.filter(l => l !== label));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected labels as chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map(label => (
            <span
              key={label}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-900/50 border border-cyan-700 rounded text-xs text-cyan-400"
            >
              {label}
              <button
                onClick={() => removeLabel(label)}
                className="text-cyan-500 hover:text-cyan-300"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && availableLabels.length > 0) {
              e.preventDefault();
              toggleLabel(availableLabels[0]);
              setFilter('');
            }
          }}
          placeholder={lang === 'no' ? 'Søk etiketter...' : 'Search labels...'}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
        />
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
        >
          <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 rounded shadow-lg max-h-48 overflow-y-auto">
          {availableLabels.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">
              {filter
                ? (lang === 'no' ? 'Ingen treff' : 'No matches')
                : (lang === 'no' ? 'Alle etiketter valgt' : 'All labels selected')}
            </div>
          ) : (
            availableLabels.map(label => (
              <button
                key={label}
                onClick={() => {
                  toggleLabel(label);
                  setFilter('');
                  inputRef.current?.focus();
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-white hover:bg-slate-700 transition-colors"
              >
                {label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
