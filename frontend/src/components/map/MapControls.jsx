import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { BASE_LAYERS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';
import { useState, useRef, useEffect, useCallback } from 'react';

const OVERLAY_IDS = ['wind', 'snowDepth', 'avalanche'];
const OVERLAY_LABELS = {
  wind: { no: 'Vind', en: 'Wind' },
  snowDepth: { no: 'Snødybde', en: 'Snow Depth' },
  avalanche: { no: 'Skred', en: 'Avalanche' },
};

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
  const snowDepthVisible = useMapStore((s) => s.snowDepthVisible);
  const toggleSnowDepth = useMapStore((s) => s.toggleSnowDepth);
  const snowDepthOpacity = useMapStore((s) => s.snowDepthOpacity);
  const setSnowDepthOpacity = useMapStore((s) => s.setSnowDepthOpacity);
  const drawingToolsVisible = useMapStore((s) => s.drawingToolsVisible);
  const toggleDrawingTools = useMapStore((s) => s.toggleDrawingTools);
  const activePanel = useMapStore((s) => s.activePanel);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const projectDrawerOpen = useMapStore((s) => s.projectDrawerOpen);
  const toggleProjectDrawer = useMapStore((s) => s.toggleProjectDrawer);
  const overlayOrder = useMapStore((s) => s.overlayOrder);
  const moveOverlayUp = useMapStore((s) => s.moveOverlayUp);
  const moveOverlayDown = useMapStore((s) => s.moveOverlayDown);
  const user = useAuthStore((s) => s.user);

  const flyTo = useMapStore((s) => s.flyTo);
  const takeScreenshot = useMapStore((s) => s.takeScreenshot);
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const [showZOrder, setShowZOrder] = useState(false);
  const [locating, setLocating] = useState(false);
  const dropdownRef = useRef(null);
  const zOrderRef = useRef(null);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyTo(pos.coords.longitude, pos.coords.latitude, 14);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [flyTo]);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowBaseDropdown(false);
      }
      if (zOrderRef.current && !zOrderRef.current.contains(e.target)) {
        setShowZOrder(false);
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

  // Count active weather overlays for z-order button
  const visibilityMap = { wind: windVisible, snowDepth: snowDepthVisible, avalanche: avalancheVisible };
  const activeOverlays = OVERLAY_IDS.filter((id) => visibilityMap[id]);
  const activeCount = activeOverlays.length;

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Project drawer toggle */}
      {user && (
        <button
          onClick={toggleProjectDrawer}
          className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${projectDrawerOpen ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
          title={`${t('drawer.title', lang)} (P)`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {t('drawer.title', lang)}
        </button>
      )}

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
      <ToggleButton active={snowDepthVisible} onClick={toggleSnowDepth} label={t('layer.snowDepth', lang)} shortcut="S" />
      {snowDepthVisible && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={snowDepthOpacity}
          onChange={(e) => setSnowDepthOpacity(parseFloat(e.target.value))}
          className="w-16 h-1 accent-blue-500"
          title={lang === 'no' ? 'Snødybde gjennomsiktighet' : 'Snow depth opacity'}
        />
      )}

      {/* Z-order control — appears when 2+ weather overlays are active */}
      {activeCount >= 2 && (
        <div className="relative" ref={zOrderRef}>
          <button
            onClick={() => setShowZOrder(!showZOrder)}
            className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${showZOrder ? 'bg-amber-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={lang === 'no' ? 'Lag-rekkefølge' : 'Layer order'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <span className="text-[10px]">Z</span>
          </button>
          {showZOrder && (
            <div className="absolute top-full mt-1 right-0 bg-slate-700 rounded shadow-xl border border-slate-600 z-50 min-w-[180px] p-2">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5 font-semibold">
                {lang === 'no' ? 'Lag-rekkefølge (øverst → nederst)' : 'Layer order (top → bottom)'}
              </div>
              {[...overlayOrder].reverse()
                .filter((id) => visibilityMap[id])
                .map((id, i, arr) => (
                <div key={id} className="flex items-center justify-between py-1">
                  <span className="text-xs text-slate-200">{OVERLAY_LABELS[id]?.[lang] || id}</span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveOverlayUp(id)}
                      disabled={i === 0}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt opp' : 'Move up'}
                    >▲</button>
                    <button
                      onClick={() => moveOverlayDown(id)}
                      disabled={i === arr.length - 1}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt ned' : 'Move down'}
                    >▼</button>
                  </div>
                </div>
              ))}
              {windVisible && (
                <div className="text-[9px] text-slate-500 mt-1 border-t border-slate-600 pt-1">
                  {lang === 'no' ? 'Vind vises alltid over kartlag' : 'Wind always renders above map layers'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ToggleButton active={drawingToolsVisible} onClick={toggleDrawingTools} label={t('layer.draw', lang)} shortcut="D" />

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

      {user?.aiChatEnabled && (
        <>
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
        </>
      )}

      <div className="w-px h-5 bg-slate-600 mx-1" />

      {/* Screenshot */}
      <button
        onClick={takeScreenshot}
        className="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600"
        title={lang === 'no' ? 'Skjermbilde' : 'Screenshot'}
      >
        <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>

      {/* GPS / My location */}
      <button
        onClick={handleGeolocate}
        disabled={locating}
        className="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
        title={lang === 'no' ? 'Min posisjon' : 'My location'}
      >
        {locating ? (
          <svg className="w-4 h-4 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
          </svg>
        )}
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
