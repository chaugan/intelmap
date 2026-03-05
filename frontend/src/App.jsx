import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
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
import SuperAdminPanel from './components/super-admin/SuperAdminPanel.jsx';
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
  const deniedThemeIdRef = useRef(null); // Store theme ID that was denied access
  const prevUserRef = useRef(undefined); // Track previous user state for login detection
  const applyTheme = useMapStore((s) => s.applyTheme);
  const mapRef = useMapStore((s) => s.mapRef);

  const handleChatPointerDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingChat(true);
    draggingChatRef.current = true;

    const onPointerMove = (e) => {
      if (!draggingChatRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(384, Math.min(newWidth, window.innerWidth * 0.5));
      setChatDrawerWidth(clamped);
    };

    const onPointerUp = () => {
      draggingChatRef.current = false;
      setIsDraggingChat(false);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [setChatDrawerWidth]);

  const handleTimelapsePointerDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingTimelapse(true);
    draggingTimelapseRef.current = true;

    const onPointerMove = (e) => {
      if (!draggingTimelapseRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(400, Math.min(newWidth, window.innerWidth * 0.7));
      setTimelapseDrawerWidth(clamped);
    };

    const onPointerUp = () => {
      draggingTimelapseRef.current = false;
      setIsDraggingTimelapse(false);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [setTimelapseDrawerWidth]);

  const user = useAuthStore((s) => s.user);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Handle share token deep linking via URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (!shareToken) return;

    fetch(`/api/share/${shareToken}`)
      .then((res) => res.json())
      .then((data) => {
        // Clear URL parameter
        window.history.replaceState({}, '', window.location.pathname);

        if (data.valid && data.resourceType === 'theme' && data.theme) {
          pendingThemeRef.current = data.theme.state;
          if (useMapStore.getState().mapRef) {
            applyTheme(data.theme.state);
            pendingThemeRef.current = null;
          }
        } else if (!data.valid) {
          setThemeError(data.error === 'expired' ? 'expired' : 'notFound');
        }
      })
      .catch(() => {
        window.history.replaceState({}, '', window.location.pathname);
        setThemeError('notFound');
      });
  }, [applyTheme]);

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
          deniedThemeIdRef.current = null; // Clear any denied theme
          // Clear URL parameter
          window.history.replaceState({}, '', window.location.pathname);
          // If map is already ready, apply immediately
          if (useMapStore.getState().mapRef) {
            applyTheme(data.theme.state);
            pendingThemeRef.current = null;
          }
        } else {
          // Store the denied theme ID for retry after login
          if (data.error !== 'notFound') {
            deniedThemeIdRef.current = themeId;
          }
          // Clear URL parameter
          window.history.replaceState({}, '', window.location.pathname);
          setThemeError(data.error === 'notFound' ? 'notFound' : 'permissionDenied');
        }
      })
      .catch(() => setThemeError('notFound'));
  }, [applyTheme]);

  // Re-check theme access after user logs in
  useEffect(() => {
    // Detect login: user changed from null/undefined to a valid user
    const wasLoggedOut = prevUserRef.current === null;
    const isNowLoggedIn = user !== null;
    prevUserRef.current = user;

    if (wasLoggedOut && isNowLoggedIn && deniedThemeIdRef.current) {
      const themeId = deniedThemeIdRef.current;
      fetch(`/api/themes/${themeId}/access`, { credentials: 'include' })
        .then((res) => res.json())
        .then((data) => {
          if (data.canAccess && data.theme) {
            // Success! Apply the theme
            deniedThemeIdRef.current = null;
            pendingThemeRef.current = data.theme.state;
            if (useMapStore.getState().mapRef) {
              applyTheme(data.theme.state);
              pendingThemeRef.current = null;
            }
          } else {
            // Still denied after login
            deniedThemeIdRef.current = null; // Clear so we don't retry again
            setThemeError('permissionDenied');
          }
        })
        .catch(() => {
          deniedThemeIdRef.current = null;
        });
    }
  }, [user, applyTheme]);

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

  // Super-admins see the management dashboard, not the map
  if (user?.role === 'super_admin') {
    return (
      <>
        <SuperAdminPanel />
        <PasswordChangeDialog />
      </>
    );
  }

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
          <LanguageSelector lang={lang} setLang={setLang} />
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
                onPointerDown={handleChatPointerDown}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors"
                style={{ touchAction: 'none' }}
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
                onPointerDown={handleTimelapsePointerDown}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-cyan-500/30 active:bg-cyan-500/50 transition-colors"
                style={{ touchAction: 'none' }}
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

const LANG_OPTIONS = [
  { code: 'no', flag: '\u{1F1F3}\u{1F1F4}', label: 'Norsk' },
  { code: 'en', flag: '\u{1F1EC}\u{1F1E7}', label: 'English' },
];

function LanguageSelector({ lang, setLang }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, []);

  const current = LANG_OPTIONS.find((o) => o.code === lang) || LANG_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors flex items-center gap-1"
      >
        <span className="text-base leading-none">{current.flag}</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-slate-700 rounded shadow-xl border border-slate-600 z-50 min-w-[140px]">
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              onClick={() => { setLang(opt.code); setOpen(false); }}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-slate-600 transition-colors flex items-center gap-2 ${lang === opt.code ? 'text-emerald-400' : ''}`}
            >
              <span className="text-base leading-none">{opt.flag}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
