import { useMapStore } from '../../stores/useMapStore.js';
import LayerManager from './LayerManager.jsx';
import SymbolPicker from './SymbolPicker.jsx';
import WeatherPanel from './WeatherPanel.jsx';
import SearchPanel from './SearchPanel.jsx';
import AvalancheWarningPanel from './AvalancheWarningPanel.jsx';

export default function SidePanel() {
  const activePanel = useMapStore((s) => s.activePanel);
  const setActivePanel = useMapStore((s) => s.setActivePanel);

  let content;
  switch (activePanel) {
    case 'layers': content = <LayerManager />; break;
    case 'symbols': content = <SymbolPicker />; break;
    case 'weather': content = <WeatherPanel />; break;
    case 'search': content = <SearchPanel />; break;
    case 'avalancheWarning': content = <AvalancheWarningPanel />; break;
    default: return null;
  }

  return (
    <div className="relative flex flex-col h-full">
      <button
        onClick={() => setActivePanel(null)}
        className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded hover:bg-slate-600 text-slate-400 hover:text-white transition-colors"
        title="Close"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {content}
    </div>
  );
}
