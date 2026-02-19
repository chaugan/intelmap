import { create } from 'zustand';
import html2canvas from 'html2canvas-pro';
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
  avalancheWarningsVisible: false,
  avalancheWarningsOpacity: 0.5,
  avalancheWarningsDay: 0,
  avalancheWarningsFetchedAt: null,
  avalancheWarningRegionId: null,
  avalancheWarningRegionName: null,
  snowDepthVisible: false,
  snowDepthOpacity: 0.7,
  drawingToolsVisible: false,

  // Weather overlay z-order (bottom to top). Wind is a separate canvas overlay
  // so it's always rendered on top of MapLibre raster layers, but the order of
  // avalanche and snowDepth within the map is controlled here.
  overlayOrder: ['avalancheWarnings', 'avalanche', 'snowDepth', 'wind'],

  // Chat drawer
  chatDrawerOpen: JSON.parse(localStorage.getItem('chatDrawerOpen') || 'false'),
  chatDrawerWidth: parseInt(localStorage.getItem('chatDrawerWidth') || '384', 10),

  // Project drawer
  projectDrawerOpen: false,

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
  toggleAvalancheWarnings: () => set((s) => ({
    avalancheWarningsVisible: !s.avalancheWarningsVisible,
    ...(s.avalancheWarningsVisible && s.activePanel === 'avalancheWarning' ? { activePanel: null } : {}),
  })),
  setAvalancheWarningsOpacity: (avalancheWarningsOpacity) => set({ avalancheWarningsOpacity }),
  setAvalancheWarningsDay: (avalancheWarningsDay) => set({ avalancheWarningsDay }),
  setAvalancheWarningsFetchedAt: (avalancheWarningsFetchedAt) => set({ avalancheWarningsFetchedAt }),
  setAvalancheWarningRegion: (id, name) => set({ avalancheWarningRegionId: id, avalancheWarningRegionName: name }),
  toggleSnowDepth: () => set((s) => ({ snowDepthVisible: !s.snowDepthVisible })),
  setSnowDepthOpacity: (snowDepthOpacity) => set({ snowDepthOpacity }),
  moveOverlayUp: (id) => set((s) => {
    const order = [...s.overlayOrder];
    const idx = order.indexOf(id);
    if (idx < order.length - 1) {
      [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
    }
    return { overlayOrder: order };
  }),
  moveOverlayDown: (id) => set((s) => {
    const order = [...s.overlayOrder];
    const idx = order.indexOf(id);
    if (idx > 0) {
      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
    }
    return { overlayOrder: order };
  }),
  toggleDrawingTools: () => set((s) => ({ drawingToolsVisible: !s.drawingToolsVisible })),
  setLang: (lang) => set({ lang }),
  setMapRef: (mapRef) => set({ mapRef }),
  setActivePanel: (panel) => set((s) => ({
    activePanel: s.activePanel === panel ? null : panel,
  })),
  setPlacementMode: (placementMode) => set({ placementMode }),
  toggleProjectDrawer: () => set((s) => ({ projectDrawerOpen: !s.projectDrawerOpen })),
  setChatDrawerWidth: (width) => {
    localStorage.setItem('chatDrawerWidth', String(width));
    return set({ chatDrawerWidth: width });
  },
  toggleChatDrawer: () => set((s) => {
    const next = !s.chatDrawerOpen;
    localStorage.setItem('chatDrawerOpen', JSON.stringify(next));
    return { chatDrawerOpen: next };
  }),
  takeScreenshot: () => {
    const map = useMapStore.getState().mapRef;
    if (!map) return;

    map.triggerRepaint();
    requestAnimationFrame(() => {
      (async () => {
        try {
          let canvas = null;

          // Try html2canvas for full DOM capture (popups, markers, legends)
          const mapContainer = document.querySelector('[data-map-container]');
          if (mapContainer) {
            try {
              canvas = await html2canvas(mapContainer, {
                useCORS: true,
                backgroundColor: null,
                scale: 1,
              });
            } catch (e) {
              console.warn('html2canvas failed, falling back to canvas capture:', e);
            }
          }

          // Fallback: direct canvas capture
          if (!canvas) {
            const mapCanvas = map.getCanvas();
            canvas = document.createElement('canvas');
            canvas.width = mapCanvas.width;
            canvas.height = mapCanvas.height;
            canvas.getContext('2d').drawImage(mapCanvas, 0, 0);
          }

          canvas.toBlob((blob) => {
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `intelmap-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
          }, 'image/png');
        } catch (e) {
          console.error('Screenshot failed:', e);
        }
      })();
    });
  },
  flyTo: (lon, lat, zoom) => set((s) => {
    const map = s.mapRef;
    if (map) {
      map.flyTo({ center: [lon, lat], zoom: zoom || 13, duration: 2000 });
    }
    return {};
  }),
}));
