import { create } from 'zustand';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../lib/constants.js';

export const useMapStore = create((set) => ({
  // Viewport
  longitude: DEFAULT_CENTER.longitude,
  latitude: DEFAULT_CENTER.latitude,
  zoom: DEFAULT_ZOOM,
  bounds: null,

  // Base layer
  baseLayer: 'topo',

  // Overlays
  windVisible: false,
  windOpacity: 0.75,
  webcamsVisible: false,
  avalancheVisible: false,

  // Chat drawer
  chatDrawerOpen: JSON.parse(localStorage.getItem('chatDrawerOpen') || 'false'),

  // Language
  lang: 'no',

  // Map ref (for programmatic control)
  mapRef: null,

  // Active panel
  activePanel: null,

  // Placement mode
  placementMode: null, // null or { sidc, designation }

  setViewport: (viewport) => set(viewport),
  setBounds: (bounds) => set({ bounds }),
  setBaseLayer: (baseLayer) => set({ baseLayer }),
  toggleWind: () => set((s) => ({ windVisible: !s.windVisible })),
  setWindOpacity: (windOpacity) => set({ windOpacity }),
  toggleWebcams: () => set((s) => ({ webcamsVisible: !s.webcamsVisible })),
  toggleAvalanche: () => set((s) => ({ avalancheVisible: !s.avalancheVisible })),
  setLang: (lang) => set({ lang }),
  setMapRef: (mapRef) => set({ mapRef }),
  setActivePanel: (panel) => set((s) => ({
    activePanel: s.activePanel === panel ? null : panel,
  })),
  setPlacementMode: (placementMode) => set({ placementMode }),
  toggleChatDrawer: () => set((s) => {
    const next = !s.chatDrawerOpen;
    localStorage.setItem('chatDrawerOpen', JSON.stringify(next));
    return { chatDrawerOpen: next };
  }),
  flyTo: (lon, lat, zoom) => set((s) => {
    const map = s.mapRef;
    if (map) {
      map.flyTo({ center: [lon, lat], zoom: zoom || 13, duration: 2000 });
    }
    return {};
  }),
}));
