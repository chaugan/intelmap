import { useEffect } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMonitoringStore } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import CameraPicker from './CameraPicker.jsx';
import TimelapsePlayer from './TimelapsePlayer.jsx';
import ExportPanel from './ExportPanel.jsx';
import MonitoringTab from './MonitoringTab.jsx';

export default function TimelapsePanel() {
  const closeDrawer = useTimelapseStore((s) => s.closeDrawer);
  const activeTab = useTimelapseStore((s) => s.activeTab);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const fetchCameras = useTimelapseStore((s) => s.fetchCameras);
  const fetchExports = useTimelapseStore((s) => s.fetchExports);
  const error = useTimelapseStore((s) => s.error);
  const clearError = useTimelapseStore((s) => s.clearError);
  const showOnlyMine = useTimelapseStore((s) => s.showOnlyMine);
  const setShowOnlyMine = useTimelapseStore((s) => s.setShowOnlyMine);
  const lang = useMapStore((s) => s.lang);

  const monitoringEnabled = useMonitoringStore((s) => s.enabled);
  const monitoringConfigLoaded = useMonitoringStore((s) => s.configLoaded);
  const fetchMonitoringConfig = useMonitoringStore((s) => s.fetchConfig);

  // Fetch cameras on mount and periodically refresh (every 60s for live updates)
  useEffect(() => {
    fetchCameras();
    fetchExports();
    fetchMonitoringConfig();

    // Refresh camera data every 60 seconds to get updated availableTo timestamps
    const interval = setInterval(() => {
      fetchCameras();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchCameras, fetchExports, fetchMonitoringConfig]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const tabs = [
    { id: 'cameras', label: t('timelapse.cameras', lang) },
    ...(monitoringConfigLoaded && monitoringEnabled
      ? [{ id: 'monitoring', label: t('monitoring.title', lang) }]
      : []),
    { id: 'player', label: t('timelapse.player', lang) },
    { id: 'exports', label: t('timelapse.exports', lang) },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
        <h2 className="text-lg font-bold text-cyan-400">{t('monitoring.title', lang)}</h2>
        <button
          onClick={closeDrawer}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-700 text-slate-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-700/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Map marker filter toggle - only show on cameras tab */}
      {activeTab === 'cameras' && (
        <div className="px-4 py-2 border-b border-slate-700 shrink-0 flex items-center justify-between bg-slate-800/50">
          <span className="text-xs text-slate-400">
            {lang === 'no' ? 'Vis på kart:' : 'Show on map:'}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowOnlyMine(true)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showOnlyMine
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {lang === 'no' ? 'Kun mine' : 'Only mine'}
            </button>
            <button
              onClick={() => setShowOnlyMine(false)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                !showOnlyMine
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {lang === 'no' ? 'Alle opptak' : 'All recording'}
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'cameras' && <CameraPicker />}
        {activeTab === 'player' && <TimelapsePlayer />}
        {activeTab === 'exports' && <ExportPanel />}
        {activeTab === 'monitoring' && <MonitoringTab />}
      </div>
    </div>
  );
}
