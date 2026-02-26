import { useEffect } from 'react';
import { useMapStore } from '../stores/useMapStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';

export function useKeyboardShortcuts() {
  const toggleWind = useMapStore((s) => s.toggleWind);
  const toggleWebcams = useMapStore((s) => s.toggleWebcams);
  const toggleAvalanche = useMapStore((s) => s.toggleAvalanche);
  const toggleAvalancheWarnings = useMapStore((s) => s.toggleAvalancheWarnings);
  const toggleSnowDepth = useMapStore((s) => s.toggleSnowDepth);
  const toggleAircraft = useMapStore((s) => s.toggleAircraft);
  const toggleVessels = useMapStore((s) => s.toggleVessels);
  const toggleDrawingTools = useMapStore((s) => s.toggleDrawingTools);
  const toggleSunlight = useMapStore((s) => s.toggleSunlight);
  const toggleHillshade = useMapStore((s) => s.toggleHillshade);
  const toggleTerrain = useMapStore((s) => s.toggleTerrain);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);
  const toggleChatDrawer = useMapStore((s) => s.toggleChatDrawer);
  const toggleProjectDrawer = useMapStore((s) => s.toggleProjectDrawer);
  const toggleDataLayersDrawer = useMapStore((s) => s.toggleDataLayersDrawer);

  useEffect(() => {
    function handleKeyDown(e) {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        // Still allow Escape in inputs to close dialogs
        if (e.key === 'Escape') {
          const auth = useAuthStore.getState();
          if (auth.loginOpen) { auth.setLoginOpen(false); return; }
          if (auth.passwordChangeOpen) {
            if (auth.user?.mustChangePassword) auth.dismissPasswordChange();
            else auth.setPasswordChangeOpen(false);
            return;
          }
          if (auth.adminPanelOpen) { auth.setAdminPanelOpen(false); return; }
        }
        return;
      }

      // Escape: close auth dialogs first, then placement mode
      if (e.key === 'Escape') {
        const auth = useAuthStore.getState();
        if (auth.loginOpen) { auth.setLoginOpen(false); return; }
        if (auth.passwordChangeOpen) {
          if (auth.user?.mustChangePassword) auth.dismissPasswordChange();
          else auth.setPasswordChangeOpen(false);
          return;
        }
        if (auth.adminPanelOpen) { auth.setAdminPanelOpen(false); return; }
        if (auth.projectManagerOpen) { auth.setProjectManagerOpen(false); return; }
        setPlacementMode(null);
        return;
      }

      switch (e.key) {
        // Layer toggles
        case 'w': toggleWind(); break;
        case 'c': toggleWebcams(); break;
        case 'a': toggleAvalanche(); break;
        case 'v': toggleAvalancheWarnings(); break;
        case 's': toggleSnowDepth(); break;
        case 'f': toggleAircraft(); break;
        case 'b': toggleVessels(); break;
        case 'd': toggleDrawingTools(); break;
        case 'h': toggleSunlight(); break;
        case 'g': toggleHillshade(); break;
        case 't': toggleTerrain(); break;

        // Panel toggles
        case '1': setActivePanel('layers'); break;
        case '2': setActivePanel('symbols'); break;
        case '3': setActivePanel('weather'); break;
        case '4': setActivePanel('search'); break;

        // Project drawer
        case 'p': {
          const user = useAuthStore.getState().user;
          if (user) toggleProjectDrawer();
          break;
        }

        // Data layers drawer
        case 'l': toggleDataLayersDrawer(); break;

        // AI Chat drawer (only if enabled)
        case 'i': {
          const user = useAuthStore.getState().user;
          if (user?.aiChatEnabled) toggleChatDrawer();
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleWind, toggleWebcams, toggleAvalanche, toggleAvalancheWarnings, toggleSnowDepth, toggleAircraft, toggleVessels, toggleDrawingTools, toggleSunlight, toggleHillshade, toggleTerrain, setActivePanel, setPlacementMode, toggleChatDrawer, toggleProjectDrawer, toggleDataLayersDrawer]);
}
