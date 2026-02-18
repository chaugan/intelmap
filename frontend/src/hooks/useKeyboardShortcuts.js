import { useEffect } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

export function useKeyboardShortcuts() {
  const toggleWind = useMapStore((s) => s.toggleWind);
  const toggleWebcams = useMapStore((s) => s.toggleWebcams);
  const toggleAvalanche = useMapStore((s) => s.toggleAvalanche);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);
  const toggleChatDrawer = useMapStore((s) => s.toggleChatDrawer);

  useEffect(() => {
    function handleKeyDown(e) {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      switch (e.key) {
        // Layer toggles
        case 'w': toggleWind(); break;
        case 'c': toggleWebcams(); break;
        case 'a': toggleAvalanche(); break;

        // Panel toggles
        case '1': setActivePanel('layers'); break;
        case '2': setActivePanel('symbols'); break;
        case '3': setActivePanel('weather'); break;
        case '4': setActivePanel('search'); break;

        // AI Chat drawer
        case 'i': toggleChatDrawer(); break;

        // Cancel placement
        case 'Escape': setPlacementMode(null); break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleWind, toggleWebcams, toggleAvalanche, setActivePanel, setPlacementMode, toggleChatDrawer]);
}
