import { useMapStore } from '../../stores/useMapStore.js';
import LayerManager from './LayerManager.jsx';
import SymbolPicker from './SymbolPicker.jsx';
import WeatherPanel from './WeatherPanel.jsx';
import SearchPanel from './SearchPanel.jsx';

export default function SidePanel() {
  const activePanel = useMapStore((s) => s.activePanel);

  switch (activePanel) {
    case 'layers': return <LayerManager />;
    case 'symbols': return <SymbolPicker />;
    case 'weather': return <WeatherPanel />;
    case 'search': return <SearchPanel />;
    default: return null;
  }
}
