import { useMapStore } from '../../stores/useMapStore.js';
import { BASE_LAYERS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';
import { useState, useRef, useEffect } from 'react';

export default function MapControls() {
  const lang = useMapStore((s) => s.lang);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const setBaseLayer = useMapStore((s) => s.setBaseLayer);
  const windVisible = useMapStore((s) => s.windVisible);
  const toggleWind = useMapStore((s) => s.toggleWind);
  const windOpacity = useMapStore((s) => s.windOpacity);
  const setWindOpacity = useMapStore((s) => s.setWindOpacity);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);
  const toggleChatDrawer = useMapStore((s) => s.toggleChatDrawer);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const toggleWebcams = useMapStore((s) => s.toggleWebcams);
  const avalancheVisible = useMapStore((s) => s.avalancheVisible);
  const toggleAvalanche = useMapStore((s) => s.toggleAvalanche);
  const activePanel = useMapStore((s) => s.activePanel);
  const setActivePanel = useMapStore((s) => s.setActivePanel);

  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowBaseDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const baseLabels = {
    topo: t('base.topo', lang),
    grayscale: t('base.grayscale', lang),
    toporaster: t('base.toporaster', lang),
    osm: t('base.osm', lang),
  };

  const panelShortcuts = { layers: '1', symbols: '2', weather: '3', search: '4' };

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Base layer selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowBaseDropdown(!showBaseDropdown)}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded transition-colors flex items-center gap-1"
        >
          {baseLabels[baseLayer] || 'Topo'}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBaseDropdown && (
          <div className="absolute top-full mt-1 left-0 bg-slate-700 rounded shadow-xl border border-slate-600 z-50 min-w-[160px]">
            {Object.entries(BASE_LAYERS).map(([id]) => (
              <button
                key={id}
                onClick={() => { setBaseLayer(id); setShowBaseDropdown(false); }}
                className={`block w-full text-left px-3 py-2 hover:bg-slate-600 transition-colors ${baseLayer === id ? 'text-emerald-400' : ''}`}
              >
                {baseLabels[id]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overlay toggles */}
      <ToggleButton active={windVisible} onClick={toggleWind} label={t('layer.wind', lang)} shortcut="W" />
      {windVisible && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={windOpacity}
          onChange={(e) => setWindOpacity(parseFloat(e.target.value))}
          className="w-16 h-1 accent-emerald-500"
          title={lang === 'no' ? 'Vindgjennomsiktighet' : 'Wind opacity'}
        />
      )}
      <ToggleButton active={webcamsVisible} onClick={toggleWebcams} label={t('layer.webcams', lang)} shortcut="C" />
      <ToggleButton active={avalancheVisible} onClick={toggleAvalanche} label={t('layer.avalanche', lang)} shortcut="A" />

      <div className="w-px h-5 bg-slate-600 mx-1" />

      {/* Panel buttons */}
      {['layers', 'symbols', 'weather', 'search'].map((panel) => (
        <button
          key={panel}
          onClick={() => setActivePanel(panel)}
          className={`px-3 py-1 rounded transition-colors ${activePanel === panel ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
          title={`${t(`panel.${panel}`, lang)} (${panelShortcuts[panel]})`}
        >
          {t(`panel.${panel}`, lang)}
        </button>
      ))}

      <div className="w-px h-5 bg-slate-600 mx-1" />

      {/* AI Chat toggle */}
      <button
        onClick={toggleChatDrawer}
        className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${chatDrawerOpen ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
        title={`${t('panel.chat', lang)} (I)`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {t('panel.chat', lang)}
      </button>
    </div>
  );
}

function ToggleButton({ active, onClick, label, shortcut }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded transition-colors ${active ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${label} (${shortcut})`}
    >
      {label}
    </button>
  );
}
