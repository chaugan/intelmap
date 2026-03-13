import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { BASE_LAYERS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';
import { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas-pro';
import ExportMenu from '../common/ExportMenu.jsx';
import OverflowToolbar from '../common/OverflowToolbar.jsx';

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
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const signalLinked = useAuthStore((s) => s.signalLinked);
  const prepareSignalUpload = useAuthStore((s) => s.prepareSignalUpload);
  const timelapseDrawerOpen = useTimelapseStore((s) => s.drawerOpen);
  const toggleTimelapseDrawer = useTimelapseStore((s) => s.toggleDrawer);
  const canTimelapse = user?.timelapseEnabled || user?.role === 'admin';

  const flyTo = useMapStore((s) => s.flyTo);
  const takeScreenshot = useMapStore((s) => s.takeScreenshot);
  const mapRef = useMapStore((s) => s.mapRef);
  const longitude = useMapStore((s) => s.longitude);
  const latitude = useMapStore((s) => s.latitude);
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const [locating, setLocating] = useState(false);
  const dropdownRef = useRef(null);

  const setUserLocation = useMapStore((s) => s.setUserLocation);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        if (!isFinite(lng) || !isFinite(lat)) { setLocating(false); return; }
        flyTo(lng, lat, 14);
        setUserLocation({ longitude: lng, latitude: lat });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [flyTo, setUserLocation]);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowBaseDropdown(false);
      }
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, []);

  const baseLabels = {
    topo: t('base.topo', lang),
    grayscale: t('base.grayscale', lang),
    topo_night: t('base.topo_night', lang),
    toporaster: t('base.toporaster', lang),
    toporaster_gray: t('base.toporaster_gray', lang),
    toporaster_night: t('base.toporaster_night', lang),
    osm: t('base.osm', lang),
    osm_gray: t('base.osm_gray', lang),
    osm_night: t('base.osm_night', lang),
    satellite: t('base.satellite', lang),
    satellite_gray: t('base.satellite_gray', lang),
    satellite_night: t('base.satellite_night', lang),
  };

  const panelShortcuts = { layers: '1', symbols: '2', weather: '3', search: '4' };

  // Capture screenshot for upload dialogs
  const captureScreenshot = useCallback(async () => {
    if (!mapRef) return null;

    mapRef.triggerRepaint();
    await new Promise(resolve => requestAnimationFrame(resolve));

    let canvas = null;
    const mapContainer = document.querySelector('[data-map-container]');
    if (mapContainer) {
      try {
        canvas = await html2canvas(mapContainer, {
          useCORS: true,
          backgroundColor: null,
          scale: 1,
        });
      } catch (e) {
        console.warn('html2canvas failed:', e);
      }
    }

    if (!canvas) {
      const mapCanvas = mapRef.getCanvas();
      canvas = document.createElement('canvas');
      canvas.width = mapCanvas.width;
      canvas.height = mapCanvas.height;
      canvas.getContext('2d').drawImage(mapCanvas, 0, 0);
    }

    const imageData = canvas.toDataURL('image/png');
    const now = new Date();
    const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
    const filename = `intelmap-${localTime}.png`;
    return { imageData, filename };
  }, [mapRef]);

  const handleWasosScreenshot = useCallback(async () => {
    try {
      const result = await captureScreenshot();
      if (result) prepareWasosUpload(result.imageData, [longitude, latitude], result.filename);
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    }
  }, [captureScreenshot, longitude, latitude, prepareWasosUpload]);

  const handleSignalScreenshot = useCallback(async () => {
    try {
      const result = await captureScreenshot();
      if (result) prepareSignalUpload(result.imageData, [longitude, latitude], result.filename);
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    }
  }, [captureScreenshot, longitude, latitude, prepareSignalUpload]);

  return (
    <OverflowToolbar lang={lang} className="text-sm flex-1 min-w-0">
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
      <div className="relative" ref={dropdownRef} data-has-submenu="true">
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
            {Object.entries(BASE_LAYERS).map(([id, layer]) => {
              const isVariant = layer.grayscale || layer.variant || layer.nightMode;
              return (
                <button
                  key={id}
                  onClick={() => { setBaseLayer(id); setShowBaseDropdown(false); }}
                  className={`block w-full text-left py-2 hover:bg-slate-600 transition-colors ${isVariant ? 'pl-6 pr-3 text-slate-300' : 'px-3'} ${layer.nightMode ? 'text-red-400/70' : ''} ${baseLayer === id ? '!text-emerald-400' : ''}`}
                >
                  {baseLabels[id]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ToggleButton active={drawingToolsVisible} onClick={toggleDrawingTools} label={t('layer.draw', lang)} shortcut="D" />
      <ToggleButton active={measuringToolVisible} onClick={toggleMeasuringTool} label={t('layer.measure', lang)} shortcut="M" />
      {user && <GridButton lang={lang} />}
      {user && <ViewshedButton lang={lang} />}
      {user && <RFCoverageButton lang={lang} />}
      {user?.firingRangeEnabled && <FiringRangeButton lang={lang} />}

      <div className="w-px h-5 bg-slate-600 mx-1" data-divider="true" />

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
          <div className="w-px h-5 bg-slate-600 mx-1" data-divider="true" />

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

      {user?.fireReportEnabled && (
        <>
          <div className="w-px h-5 bg-slate-600 mx-1" data-divider="true" />
          <FireReportButton lang={lang} />
        </>
      )}

      {canTimelapse && (
        <>
          <div className="w-px h-5 bg-slate-600 mx-1" data-divider="true" />

          {/* Monitoring toggle */}
          <button
            onClick={toggleTimelapseDrawer}
            className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${timelapseDrawerOpen ? 'bg-cyan-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={`${t('monitoring.title', lang)} (Y)`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('monitoring.title', lang)}
          </button>
        </>
      )}

      <div className="w-px h-5 bg-slate-600 mx-1" data-divider="true" />

      {/* Screenshot / Export */}
      {(user?.wasosEnabled || user?.signalEnabled) ? (
        <div data-has-submenu="true">
          <ExportMenu
            onSaveToDisk={takeScreenshot}
            onTransferToWasos={user?.wasosEnabled ? handleWasosScreenshot : undefined}
            wasosLoggedIn={wasosLoggedIn}
            onSendToSignal={user?.signalEnabled ? handleSignalScreenshot : undefined}
            signalLinked={signalLinked}
            buttonIcon={
              <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            }
            buttonLabel={t('toolbar.export', lang)}
          />
        </div>
      ) : (
        <button
          onClick={takeScreenshot}
          className="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 flex items-center gap-1"
          title={lang === 'no' ? 'Skjermbilde' : 'Screenshot'}
        >
          <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-sm text-slate-300">{t('toolbar.export', lang)}</span>
        </button>
      )}

      {/* GPS / My location */}
      <button
        onClick={handleGeolocate}
        disabled={locating}
        className="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1"
        title={t('toolbar.myLocation', lang)}
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
        <span className="text-sm text-slate-300">{t('toolbar.myLocation', lang)}</span>
      </button>
    </OverflowToolbar>
  );
}

// Data overlays counted in badge (excludes terrain: hillshade, 3D)
const VISIBILITY_KEYS = [
  'auroraVisible', 'sunlightVisible', 'windVisible', 'webcamsVisible',
  'avalancheVisible', 'avalancheWarningsVisible', 'snowDepthVisible',
  'aircraftVisible', 'vesselsVisible', 'trafficFlowVisible', 'trafficInfoVisible', 'infraVisible',
  'roadRestrictionsVisible',
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

function GridButton({ lang }) {
  const active = useMapStore((s) => s.gridToolVisible);
  const toggle = useMapStore((s) => s.toggleGridTool);
  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${active ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${t('layer.grid', lang)} (E)`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h18v18H3V3zM3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
      {t('layer.grid', lang)}
    </button>
  );
}

function ViewshedButton({ lang }) {
  const active = useMapStore((s) => s.viewshedToolVisible);
  const toggle = useMapStore((s) => s.toggleViewshedTool);
  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${active ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${t('viewshed.title', lang)} (J)`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      {t('viewshed.title', lang)}
    </button>
  );
}

function RFCoverageButton({ lang }) {
  const active = useMapStore((s) => s.rfCoverageToolVisible);
  const toggle = useMapStore((s) => s.toggleRFCoverageTool);
  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${active ? 'bg-purple-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${t('rfcoverage.title', lang)} (U)`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 14a6 6 0 00-12 0" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 00-18 0" />
        <circle cx="12" cy="10" r="1" fill="currentColor" />
      </svg>
      {t('rfcoverage.title', lang)}
    </button>
  );
}

function FiringRangeButton({ lang }) {
  const active = useMapStore((s) => s.firingRangeToolVisible);
  const toggle = useMapStore((s) => s.toggleFiringRangeTool);
  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${active ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${t('firingRange.title', lang)} (Shift+K)`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
      {t('firingRange.title', lang)}
    </button>
  );
}

function FireReportButton({ lang }) {
  const active = useMapStore((s) => s.fireReportToolVisible);
  const toggle = useMapStore((s) => s.toggleFireReportTool);
  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${active ? 'bg-red-700 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
      title={`${t('fireReport.title', lang)} (F)`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
      {t('fireReport.title', lang)}
    </button>
  );
}
