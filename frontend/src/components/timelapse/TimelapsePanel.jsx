import { useEffect } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import CameraPicker from './CameraPicker.jsx';
import TimelapsePlayer from './TimelapsePlayer.jsx';
import ExportPanel from './ExportPanel.jsx';

export default function TimelapsePanel() {
  const closeDrawer = useTimelapseStore((s) => s.closeDrawer);
  const activeTab = useTimelapseStore((s) => s.activeTab);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const fetchCameras = useTimelapseStore((s) => s.fetchCameras);
  const fetchExports = useTimelapseStore((s) => s.fetchExports);
  const error = useTimelapseStore((s) => s.error);
  const clearError = useTimelapseStore((s) => s.clearError);
  const lang = useMapStore((s) => s.lang);

  // Fetch cameras on mount and periodically refresh (every 60s for live updates)
  useEffect(() => {
    fetchCameras();
    fetchExports();

    // Refresh camera data every 60 seconds to get updated availableTo timestamps
    const interval = setInterval(() => {
      fetchCameras();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchCameras, fetchExports]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const tabs = [
    { id: 'cameras', label: t('timelapse.cameras', lang) },
    { id: 'player', label: t('timelapse.player', lang) },
    { id: 'exports', label: t('timelapse.exports', lang) },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
        <h2 className="text-lg font-bold text-cyan-400">{t('timelapse.title', lang)}</h2>
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
      </div>
    </div>
  );
}
