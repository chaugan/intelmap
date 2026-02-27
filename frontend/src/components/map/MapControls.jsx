import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { BASE_LAYERS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function MapControls() {
  const lang = useMapStore((s) => s.lang);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const setBaseLayer = useMapStore((s) => s.setBaseLayer);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);
  const toggleChatDrawer = useMapStore((s) => s.toggleChatDrawer);
  const drawingToolsVisible = useMapStore((s) => s.drawingToolsVisible);
  const toggleDrawingTools = useMapStore((s) => s.toggleDrawingTools);
  const measuringToolVisible = useMapStore((s) => s.measuringToolVisible);
  const toggleMeasuringTool = useMapStore((s) => s.toggleMeasuringTool);
  const activePanel = useMapStore((s) => s.activePanel);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const projectDrawerOpen = useMapStore((s) => s.projectDrawerOpen);
  const toggleProjectDrawer = useMapStore((s) => s.toggleProjectDrawer);
  const dataLayersDrawerOpen = useMapStore((s) => s.dataLayersDrawerOpen);
  const toggleDataLayersDrawer = useMapStore((s) => s.toggleDataLayersDrawer);
  const user = useAuthStore((s) => s.user);
  const timelapseDrawerOpen = useTimelapseStore((s) => s.drawerOpen);
  const toggleTimelapseDrawer = useTimelapseStore((s) => s.toggleDrawer);
  const canTimelapse = user?.timelapseEnabled || user?.role === 'admin';

  const flyTo = useMapStore((s) => s.flyTo);
  const takeScreenshot = useMapStore((s) => s.takeScreenshot);
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const [locating, setLocating] = useState(false);
  const dropdownRef = useRef(null);

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

      {/* Data layers drawer toggle */}
      <button
        onClick={toggleDataLayersDrawer}
        className={`relative px-3 py-1 rounded transition-colors flex items-center gap-1 ${dataLayersDrawerOpen ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
        title={`${t('dataLayers.title', lang)} (L)`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        {t('dataLayers.title', lang)}
        <ActiveLayerBadge />
      </button>

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

      <ToggleButton active={drawingToolsVisible} onClick={toggleDrawingTools} label={t('layer.draw', lang)} shortcut="D" />
      <ToggleButton active={measuringToolVisible} onClick={toggleMeasuringTool} label={t('layer.measure', lang)} shortcut="M" />

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

      {canTimelapse && (
        <>
          <div className="w-px h-5 bg-slate-600 mx-1" />

          {/* Timelapse toggle */}
          <button
            onClick={toggleTimelapseDrawer}
            className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${timelapseDrawerOpen ? 'bg-cyan-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={`${t('timelapse.title', lang)} (Y)`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('timelapse.title', lang)}
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

const VISIBILITY_KEYS = [
  'sunlightVisible', 'windVisible', 'webcamsVisible', 'avalancheVisible',
  'avalancheWarningsVisible', 'snowDepthVisible', 'aircraftVisible', 'vesselsVisible',
  'hillshadeVisible', 'terrainVisible',
];

function ActiveLayerBadge() {
  const count = useMapStore((s) => VISIBILITY_KEYS.reduce((n, k) => n + (s[k] ? 1 : 0), 0));
  if (count === 0) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
      {count}
    </span>
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
