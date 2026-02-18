import { useSocket } from './hooks/useSocket.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import TacticalMap from './components/map/TacticalMap.jsx';
import MapControls from './components/map/MapControls.jsx';
import DrawingLayer from './components/map/DrawingLayer.jsx';
import SidePanel from './components/panels/SidePanel.jsx';
import AiChatPanel from './components/chat/AiChatPanel.jsx';
import { useMapStore } from './stores/useMapStore.js';
import { t } from './lib/i18n.js';

export default function App() {
  useSocket();
  useKeyboardShortcuts();
  const lang = useMapStore((s) => s.lang);
  const setLang = useMapStore((s) => s.setLang);
  const activePanel = useMapStore((s) => s.activePanel);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);

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
        <button
          onClick={() => setLang(lang === 'no' ? 'en' : 'no')}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          {t('lang.switch', lang)}
        </button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Map */}
        <div className="flex-1 relative">
          <TacticalMap />
          <DrawingLayer />
        </div>

        {/* Right panels */}
        {activePanel && (
          <div className="w-80 bg-slate-800 border-l border-slate-700 flex flex-col overflow-hidden shrink-0">
            <SidePanel />
          </div>
        )}

        {/* AI Chat Drawer */}
        <div
          className={`bg-slate-800 border-l border-slate-700 flex flex-col shrink-0 transition-all duration-300 overflow-hidden ${
            chatDrawerOpen ? 'w-96' : 'w-0'
          }`}
        >
          {chatDrawerOpen && <AiChatPanel />}
        </div>
      </div>
    </div>
  );
}
