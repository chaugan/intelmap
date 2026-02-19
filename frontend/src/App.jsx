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
import ProjectDrawer from './components/projects/ProjectDrawer.jsx';
import { useMapStore } from './stores/useMapStore.js';
import { useAuthStore } from './stores/useAuthStore.js';
import { t } from './lib/i18n.js';

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

  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    draggingRef.current = true;

    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(384, Math.min(newWidth, window.innerWidth * 0.5));
      setChatDrawerWidth(clamped);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setChatDrawerWidth]);
  const user = useAuthStore((s) => s.user);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const showChat = chatDrawerOpen && user?.aiChatEnabled;

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-100">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 z-20 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-emerald-400 tracking-wide">
            {t('app.title', lang)}
          </h1>
          <MapControls />
        </div>
        <div className="flex items-center gap-2">
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
        {/* Project Drawer (left) */}
        <div
          className={`bg-slate-800 border-r border-slate-700 flex flex-col shrink-0 transition-all duration-300 overflow-hidden ${
            projectDrawerOpen && user ? 'w-72' : 'w-0'
          }`}
        >
          {projectDrawerOpen && user && <ProjectDrawer />}
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
                onMouseDown={handleMouseDown}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors"
              />
              <AiChatPanel />
            </>
          )}
        </div>
      </div>

      {/* Auth modals */}
      <LoginDialog />
      <PasswordChangeDialog />
      <AdminPanel />
    </div>
  );
}
