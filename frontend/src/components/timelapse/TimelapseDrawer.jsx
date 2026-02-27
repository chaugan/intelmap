import { useEffect, useRef, useState, useCallback } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import CameraPicker from './CameraPicker.jsx';
import TimelapsePlayer from './TimelapsePlayer.jsx';
import ExportPanel from './ExportPanel.jsx';

export default function TimelapseDrawer() {
  const drawerOpen = useTimelapseStore((s) => s.drawerOpen);
  const closeDrawer = useTimelapseStore((s) => s.closeDrawer);
  const activeTab = useTimelapseStore((s) => s.activeTab);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const fetchCameras = useTimelapseStore((s) => s.fetchCameras);
  const fetchExports = useTimelapseStore((s) => s.fetchExports);
  const error = useTimelapseStore((s) => s.error);
  const clearError = useTimelapseStore((s) => s.clearError);
  const lang = useMapStore((s) => s.lang);

  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = localStorage.getItem('timelapseDrawerWidth');
    return saved ? parseInt(saved, 10) : Math.floor(window.innerWidth * 0.5);
  });
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  // Fetch cameras on open
  useEffect(() => {
    if (drawerOpen) {
      fetchCameras();
      fetchExports();
    }
  }, [drawerOpen, fetchCameras, fetchExports]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // Handle resize drag
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    draggingRef.current = true;

    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(400, Math.min(newWidth, window.innerWidth * 0.8));
      setDrawerWidth(clamped);
      localStorage.setItem('timelapseDrawerWidth', String(clamped));
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  if (!drawerOpen) return null;

  const tabs = [
    { id: 'cameras', label: t('timelapse.cameras', lang) },
    { id: 'player', label: t('timelapse.player', lang) },
    { id: 'exports', label: t('timelapse.exports', lang) },
  ];

  return (
    <div
      className={`fixed top-0 right-0 h-full bg-slate-800 border-l border-slate-700 flex flex-col z-40 ${
        isDragging ? '' : 'transition-all duration-300'
      }`}
      style={{ width: drawerWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors"
      />

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
