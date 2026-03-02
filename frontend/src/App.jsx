import { useEffect, useRef, useCallback, useState } from 'react';
import { useSocket } from './hooks/useSocket.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import TacticalMap from './components/map/TacticalMap.jsx';
import MapControls from './components/map/MapControls.jsx';
import SidePanel from './components/panels/SidePanel.jsx';
import AiChatPanel from './components/chat/AiChatPanel.jsx';
import UserMenu from './components/auth/UserMenu.jsx';
import LoginDialog from './components/auth/LoginDialog.jsx';
import PasswordChangeDialog from './components/auth/PasswordChangeDialog.jsx';
import AdminPanel from './components/auth/AdminPanel.jsx';
import WasosLoginDialog from './components/auth/WasosLoginDialog.jsx';
import WasosUploadDialog from './components/auth/WasosUploadDialog.jsx';
import ProjectDrawer from './components/projects/ProjectDrawer.jsx';
import DataLayersDrawer from './components/map/DataLayersDrawer.jsx';
import TimelapsePanel from './components/timelapse/TimelapsePanel.jsx';
import ThemeErrorDialog from './components/common/ThemeErrorDialog.jsx';
import { useMapStore } from './stores/useMapStore.js';
import { useAuthStore } from './stores/useAuthStore.js';
import { useTimelapseStore } from './stores/useTimelapseStore.js';
import { t } from './lib/i18n.js';
import { VERSION } from './version.js';

export default function App() {
  useSocket();
  useKeyboardShortcuts();
  const lang = useMapStore((s) => s.lang);
  const setLang = useMapStore((s) => s.setLang);
  const activePanel = useMapStore((s) => s.activePanel);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);
  const chatDrawerWidth = useMapStore((s) => s.chatDrawerWidth);
  const setChatDrawerWidth = useMapStore((s) => s.setChatDrawerWidth);
  const projectDrawerOpen = useMapStore((s) => s.projectDrawerOpen);
  const dataLayersDrawerOpen = useMapStore((s) => s.dataLayersDrawerOpen);

  // Timelapse drawer state
  const timelapseDrawerOpen = useTimelapseStore((s) => s.drawerOpen);
  const timelapseDrawerWidth = useTimelapseStore((s) => s.drawerWidth);
  const setTimelapseDrawerWidth = useTimelapseStore((s) => s.setDrawerWidth);

  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const [isDraggingTimelapse, setIsDraggingTimelapse] = useState(false);
  const [themeError, setThemeError] = useState(null); // 'notFound' | 'permissionDenied' | null
  const draggingChatRef = useRef(false);
  const draggingTimelapseRef = useRef(false);
  const pendingThemeRef = useRef(null); // Store pending theme until map is ready
  const applyTheme = useMapStore((s) => s.applyTheme);
  const mapRef = useMapStore((s) => s.mapRef);

  const handleChatMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingChat(true);
    draggingChatRef.current = true;

    const onMouseMove = (e) => {
      if (!draggingChatRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(384, Math.min(newWidth, window.innerWidth * 0.5));
      setChatDrawerWidth(clamped);
    };

    const onMouseUp = () => {
      draggingChatRef.current = false;
      setIsDraggingChat(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setChatDrawerWidth]);

  const handleTimelapseMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingTimelapse(true);
    draggingTimelapseRef.current = true;

    const onMouseMove = (e) => {
      if (!draggingTimelapseRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(400, Math.min(newWidth, window.innerWidth * 0.7));
      setTimelapseDrawerWidth(clamped);
    };

    const onMouseUp = () => {
      draggingTimelapseRef.current = false;
      setIsDraggingTimelapse(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setTimelapseDrawerWidth]);

  const user = useAuthStore((s) => s.user);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Handle theme deep linking via URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const themeId = params.get('theme');
    if (!themeId) return;

    fetch(`/api/themes/${themeId}/access`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.canAccess && data.theme) {
          // Store theme to apply when map is ready
          pendingThemeRef.current = data.theme.state;
          // Clear URL parameter
          window.history.replaceState({}, '', window.location.pathname);
          // If map is already ready, apply immediately
          if (useMapStore.getState().mapRef) {
            applyTheme(data.theme.state);
            pendingThemeRef.current = null;
          }
        } else {
          setThemeError(data.error === 'notFound' ? 'notFound' : 'permissionDenied');
        }
      })
      .catch(() => setThemeError('notFound'));
  }, [applyTheme]);

  // Apply pending theme when map becomes ready
  useEffect(() => {
    if (mapRef && pendingThemeRef.current) {
      applyTheme(pendingThemeRef.current);
      pendingThemeRef.current = null;
    }
  }, [mapRef, applyTheme]);

  const showChat = chatDrawerOpen && user?.aiChatEnabled;
  const showTimelapse = timelapseDrawerOpen && (user?.timelapseEnabled || user?.role === 'admin');
  const isDragging = isDraggingChat || isDraggingTimelapse;

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-100">
      {/* Top Bar */}
      <header className="flex items-center gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700 z-20 shrink-0">
        <h1 className="text-lg font-bold text-emerald-400 tracking-wide shrink-0">
          {t('app.title', lang)}
          <span className="ml-2 text-xs font-normal text-slate-500">v{VERSION}</span>
        </h1>
        <MapControls />
        <div className="flex items-center gap-2 shrink-0">
          <UserMenu />
          <button
            onClick={() => setLang(lang === 'no' ? 'en' : 'no')}
            className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            {t('lang.switch', lang)}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left Drawer (Project or Data Layers — mutually exclusive) */}
        <div
          className={`bg-slate-800 border-r border-slate-700 flex flex-col shrink-0 transition-all duration-300 overflow-hidden ${
            (projectDrawerOpen && user) || dataLayersDrawerOpen ? 'w-80' : 'w-0'
          }`}
        >
          {projectDrawerOpen && user && <ProjectDrawer />}
          {dataLayersDrawerOpen && !projectDrawerOpen && <DataLayersDrawer />}
        </div>

        {/* Map */}
        <div className="flex-1 relative overflow-hidden">
          <TacticalMap />
        </div>

        {/* Right panels */}
        {activePanel && (
          <div className="w-80 bg-slate-800 border-l border-slate-700 flex flex-col overflow-hidden shrink-0">
            <SidePanel />
          </div>
        )}

        {/* AI Chat Drawer */}
        <div
          className={`bg-slate-800 border-l border-slate-700 flex flex-col shrink-0 overflow-hidden relative ${
            isDragging ? '' : 'transition-all duration-300'
          }`}
          style={{ width: showChat ? chatDrawerWidth : 0 }}
        >
          {showChat && (
            <>
              <div
                onMouseDown={handleChatMouseDown}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors"
              />
              <AiChatPanel />
            </>
          )}
        </div>

        {/* Timelapse Drawer */}
        <div
          className={`bg-slate-800 border-l border-slate-700 flex flex-col shrink-0 overflow-hidden relative ${
            isDragging ? '' : 'transition-all duration-300'
          }`}
          style={{ width: showTimelapse ? timelapseDrawerWidth : 0 }}
        >
          {showTimelapse && (
            <>
              <div
                onMouseDown={handleTimelapseMouseDown}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-cyan-500/30 active:bg-cyan-500/50 transition-colors"
              />
              <TimelapsePanel />
            </>
          )}
        </div>
      </div>

      {/* Auth modals */}
      <LoginDialog />
      <PasswordChangeDialog />
      <AdminPanel />
      <WasosLoginDialog />
      <WasosUploadDialog />

      {/* Theme error dialog */}
      {themeError && (
        <ThemeErrorDialog
          error={themeError}
          onClose={() => {
            setThemeError(null);
            window.history.replaceState({}, '', window.location.pathname);
          }}
        />
      )}
    </div>
  );
}
