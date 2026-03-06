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
  aircraftVisible: false,
  aircraftOpacity: 0.9,
  aircraftFetchedAt: null,
  focusedAircraftHex: null,
  vesselsVisible: false,
  vesselsOpacity: 0.9,
  vesselsFetchedAt: null,
  focusedVesselMmsi: null,
  hiddenVesselCategories: [],
  vesselDeepAnalysis: null, // { mmsi, vessel, traceData } or null
  vesselTimeTravel: null, // { mmsi, selectedIndex, trackPoints } for historical view
  vesselActivityBox: null, // { bounds: {west,east,north,south}, widthKm, heightKm }
  vesselActivityDrawing: false, // true when drawing mode is active
  vesselActivityAnalysis: null, // { entered: [], exited: [], inside: [], anomalies: {} }
  vesselActivityLoading: false,
  focusedVesselMmsis: [], // Array for multi-vessel focus
  roadRestrictionsVisible: false,
  roadRestrictionsOpacity: 0.85,
  roadRestrictionsFetchedAt: null,
  roadRestrictionsCount: null,
  showWeightLimits: true,
  showHeightLimits: true,
  weightFilterMax: 100, // tons
  heightFilterMax: 10,  // meters
  weightPulsating: false,
  heightPulsating: false,
  trafficFlowVisible: false,
  trafficFlowOpacity: 0.9,
  trafficInfoVisible: false,
  trafficInfoOpacity: 0.9,
  trafficInfoFetchedAt: null,
  hiddenTrafficCategories: [],
  drawingToolsVisible: false,
  sunlightVisible: false,
  sunlightOpacity: 0.5,
  buildingOpacity: 0.7,
  hillshadeVisible: false,
  hillshadeOpacity: 0.25,
  terrainVisible: false,
  terrainExaggeration: 1.5,
  sunlightDate: new Date().toISOString().slice(0, 10),
  sunlightTime: 720,
  sunlightAnimating: false,
  sunlightAnimationSpeed: 10,

  // Aurora overlay
  auroraVisible: false,
  auroraOpacity: 0.8,
  auroraTimeOffset: 0, // 0=now, 1=+1h, 2=+3h, 3=tomorrow, 4=day after
  auroraFetchedAt: null,
  auroraGrid: null,

  // Infrastructure
  infraVisible: false,
  infraOpacity: 1.0,
  infraLayers: {},
  infraSearchFilter: null, // null = show all, { layerId: [name1, name2, ...] } = show only matching features

  // Geonorge WMS overlays (kartdata)
  wmsTransportVisible: false,
  wmsTransportOpacity: 0.8,
  wmsPlacenamesVisible: false,
  wmsPlacenamesOpacity: 0.9,
  wmsContoursVisible: false,
  wmsContoursOpacity: 0.7,
  wmsBordersVisible: false,
  wmsBordersOpacity: 0.8,

  // Weather overlay z-order (bottom to top). Wind is a separate canvas overlay
  // so it's always rendered on top of MapLibre raster layers, but the order of
  // avalanche and snowDepth within the map is controlled here.
  overlayOrder: ['aurora', 'sunlight', 'avalancheWarnings', 'avalanche', 'snowDepth', 'trafficFlow', 'wmsTransport', 'wmsPlacenames', 'wmsContours', 'wmsBorders', 'infra', 'aircraft', 'vessels', 'wind'],

  // Chat drawer
  chatDrawerOpen: JSON.parse(localStorage.getItem('chatDrawerOpen') || 'false'),
  chatDrawerWidth: parseInt(localStorage.getItem('chatDrawerWidth') || '384', 10),

  // Project drawer
  projectDrawerOpen: false,
  projectDrawerWidth: parseInt(localStorage.getItem('projectDrawerWidth') || '320', 10),

  // Data layers drawer
  dataLayersDrawerOpen: false,

  // Language
  lang: 'no',

  // Map ref (for programmatic control)
  mapRef: null,

  // Active panel
  activePanel: null,

  // Placement mode
  placementMode: null, // null or { sidc, designation }

  // Measuring tool
  measuringToolVisible: false,

  // User geolocation
  userLocation: null, // { longitude, latitude }

  // Fly-around rotation
  flyAroundActive: false,

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
  toggleAircraft: () => set((s) => ({
    aircraftVisible: !s.aircraftVisible,
    ...(s.aircraftVisible ? { focusedAircraftHex: null } : {}),
  })),
  setAircraftOpacity: (aircraftOpacity) => set({ aircraftOpacity }),
  setAircraftFetchedAt: (aircraftFetchedAt) => set({ aircraftFetchedAt }),
  setFocusedAircraft: (hex) => set({ focusedAircraftHex: hex }),
  toggleVessels: () => set((s) => ({
    vesselsVisible: !s.vesselsVisible,
    ...(s.vesselsVisible ? { focusedVesselMmsi: null, hiddenVesselCategories: [] } : {}),
  })),
  setVesselsOpacity: (vesselsOpacity) => set({ vesselsOpacity }),
  setVesselsFetchedAt: (vesselsFetchedAt) => set({ vesselsFetchedAt }),
  setFocusedVessel: (mmsi) => set({ focusedVesselMmsi: mmsi }),
  toggleVesselCategory: (cat) => set((s) => ({
    hiddenVesselCategories: s.hiddenVesselCategories.includes(cat)
      ? s.hiddenVesselCategories.filter((c) => c !== cat)
      : [...s.hiddenVesselCategories, cat],
  })),
  setVesselDeepAnalysis: (data) => set({ vesselDeepAnalysis: data }),
  clearVesselDeepAnalysis: () => set({ vesselDeepAnalysis: null }),
  setVesselTimeTravel: (data) => set({ vesselTimeTravel: data }),
  clearVesselTimeTravel: () => set({ vesselTimeTravel: null }),
  setVesselActivityBox: (box) => set({ vesselActivityBox: box }),
  clearVesselActivityBox: () => set({ vesselActivityBox: null, vesselActivityAnalysis: null }),
  setVesselActivityDrawing: (drawing) => set({ vesselActivityDrawing: drawing }),
  setVesselActivityAnalysis: (analysis) => set({ vesselActivityAnalysis: analysis }),
  setVesselActivityLoading: (loading) => set({ vesselActivityLoading: loading }),
  setFocusedVessels: (mmsis) => set({ focusedVesselMmsis: mmsis }),
  clearFocusedVessels: () => set({ focusedVesselMmsis: [] }),
  toggleInfra: () => set((s) => {
    const newVisible = !s.infraVisible;
    return { infraVisible: newVisible, ...(!newVisible && { infraLayers: {}, infraSearchFilter: null }) };
  }),
  setInfraOpacity: (infraOpacity) => set({ infraOpacity }),
  toggleInfraLayer: (name) => set((s) => ({
    infraLayers: { ...s.infraLayers, [name]: !s.infraLayers[name] },
    infraSearchFilter: null, // clear search filter when manually toggling
  })),
  setInfraSearchFilter: (filter) => set({ infraSearchFilter: filter }),
  toggleRoadRestrictions: () => set((s) => ({
    roadRestrictionsVisible: !s.roadRestrictionsVisible,
    // Reset filters when toggling on
    ...(!s.roadRestrictionsVisible && { showWeightLimits: true, showHeightLimits: true }),
  })),
  hideAllDataLayers: () => set({
    windVisible: false,
    webcamsVisible: false,
    avalancheVisible: false,
    avalancheWarningsVisible: false,
    snowDepthVisible: false,
    aircraftVisible: false,
    vesselsVisible: false,
    roadRestrictionsVisible: false,
    trafficFlowVisible: false,
    trafficInfoVisible: false,
    wmsTransportVisible: false,
    wmsPlacenamesVisible: false,
    wmsContoursVisible: false,
    wmsBordersVisible: false,
    sunlightVisible: false,
    auroraVisible: false,
    infraVisible: false,
    infraLayers: {},
    infraSearchFilter: null,
    focusedAircraftHex: null,
    focusedVesselMmsi: null,
    hiddenVesselCategories: [],
    hiddenTrafficCategories: [],
  }),
  setRoadRestrictionsOpacity: (roadRestrictionsOpacity) => set({ roadRestrictionsOpacity }),
  setRoadRestrictionsFetchedAt: (roadRestrictionsFetchedAt) => set({ roadRestrictionsFetchedAt }),
  setRoadRestrictionsCount: (roadRestrictionsCount) => set({ roadRestrictionsCount }),
  toggleWeightLimits: () => set((s) => ({ showWeightLimits: !s.showWeightLimits })),
  toggleHeightLimits: () => set((s) => ({ showHeightLimits: !s.showHeightLimits })),
  setWeightFilterMax: (weightFilterMax) => set({ weightFilterMax }),
  setHeightFilterMax: (heightFilterMax) => set({ heightFilterMax }),
  setWeightPulsating: (weightPulsating) => set({ weightPulsating }),
  setHeightPulsating: (heightPulsating) => set({ heightPulsating }),
  toggleTrafficFlow: () => set((s) => ({ trafficFlowVisible: !s.trafficFlowVisible })),
  setTrafficFlowOpacity: (trafficFlowOpacity) => set({ trafficFlowOpacity }),
  toggleWmsTransport: () => set((s) => ({ wmsTransportVisible: !s.wmsTransportVisible })),
  setWmsTransportOpacity: (wmsTransportOpacity) => set({ wmsTransportOpacity }),
  toggleWmsPlacenames: () => set((s) => ({ wmsPlacenamesVisible: !s.wmsPlacenamesVisible })),
  setWmsPlacenamesOpacity: (wmsPlacenamesOpacity) => set({ wmsPlacenamesOpacity }),
  toggleWmsContours: () => set((s) => ({ wmsContoursVisible: !s.wmsContoursVisible })),
  setWmsContoursOpacity: (wmsContoursOpacity) => set({ wmsContoursOpacity }),
  toggleWmsBorders: () => set((s) => ({ wmsBordersVisible: !s.wmsBordersVisible })),
  setWmsBordersOpacity: (wmsBordersOpacity) => set({ wmsBordersOpacity }),
  toggleTrafficInfo: () => set((s) => ({
    trafficInfoVisible: !s.trafficInfoVisible,
    ...(s.trafficInfoVisible ? { hiddenTrafficCategories: [] } : {}),
  })),
  setTrafficInfoOpacity: (trafficInfoOpacity) => set({ trafficInfoOpacity }),
  setTrafficInfoFetchedAt: (trafficInfoFetchedAt) => set({ trafficInfoFetchedAt }),
  toggleTrafficCategory: (cat) => set((s) => ({
    hiddenTrafficCategories: s.hiddenTrafficCategories.includes(cat)
      ? s.hiddenTrafficCategories.filter((c) => c !== cat)
      : [...s.hiddenTrafficCategories, cat],
  })),
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
  toggleAurora: () => set((s) => ({
    auroraVisible: !s.auroraVisible,
    ...(s.auroraVisible && s.activePanel === 'aurora' ? { activePanel: null } : {}),
  })),
  setAuroraOpacity: (auroraOpacity) => set({ auroraOpacity }),
  setAuroraTimeOffset: (auroraTimeOffset) => set({ auroraTimeOffset }),
  setAuroraFetchedAt: (auroraFetchedAt) => set({ auroraFetchedAt }),
  setAuroraGrid: (auroraGrid) => set({ auroraGrid }),
  toggleSunlight: () => set((s) => ({ sunlightVisible: !s.sunlightVisible, ...(s.sunlightVisible ? { sunlightAnimating: false } : {}) })),
  setSunlightOpacity: (sunlightOpacity) => set({ sunlightOpacity }),
  setBuildingOpacity: (buildingOpacity) => set({ buildingOpacity }),
  toggleHillshade: () => set((s) => ({ hillshadeVisible: !s.hillshadeVisible })),
  setHillshadeOpacity: (hillshadeOpacity) => set({ hillshadeOpacity }),
  toggleTerrain: () => set((s) => ({ terrainVisible: !s.terrainVisible })),
  setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),
  setSunlightDate: (sunlightDate) => set({ sunlightDate }),
  setSunlightTime: (sunlightTime) => set({ sunlightTime }),
  toggleSunlightAnimation: () => set((s) => ({ sunlightAnimating: !s.sunlightAnimating })),
  setSunlightAnimationSpeed: (sunlightAnimationSpeed) => set({ sunlightAnimationSpeed }),
  toggleDrawingTools: () => set((s) => ({ drawingToolsVisible: !s.drawingToolsVisible })),
  setLang: (lang) => set({ lang }),
  setMapRef: (mapRef) => set({ mapRef }),
  setActivePanel: (panel) => set((s) => ({
    activePanel: s.activePanel === panel ? null : panel,
  })),
  setPlacementMode: (placementMode) => set({ placementMode }),
  toggleMeasuringTool: () => set((s) => ({ measuringToolVisible: !s.measuringToolVisible })),
  setUserLocation: (userLocation) => set({ userLocation }),
  clearUserLocation: () => set({ userLocation: null }),
  setFlyAroundActive: (flyAroundActive) => set({ flyAroundActive }),
  toggleProjectDrawer: () => set((s) => ({
    projectDrawerOpen: !s.projectDrawerOpen,
    ...(!s.projectDrawerOpen ? { dataLayersDrawerOpen: false } : {}),
  })),
  toggleDataLayersDrawer: () => set((s) => ({
    dataLayersDrawerOpen: !s.dataLayersDrawerOpen,
    ...(!s.dataLayersDrawerOpen ? { projectDrawerOpen: false } : {}),
  })),
  applyTheme: (themeState) => {
    const parsed = typeof themeState === 'string' ? JSON.parse(themeState) : themeState;
    const map = useMapStore.getState().mapRef;

    // Fly to position if saved
    if (parsed.position && map) {
      map.flyTo({
        center: [parsed.position.longitude, parsed.position.latitude],
        zoom: parsed.position.zoom,
        pitch: parsed.position.pitch || 0,
        bearing: parsed.position.bearing || 0,
        duration: 2000,
      });
    }

    return set({
      ...(parsed.baseLayer !== undefined && { baseLayer: parsed.baseLayer }),
      ...(parsed.windVisible !== undefined && { windVisible: parsed.windVisible }),
      ...(parsed.windOpacity !== undefined && { windOpacity: parsed.windOpacity }),
      ...(parsed.webcamsVisible !== undefined && { webcamsVisible: parsed.webcamsVisible }),
      ...(parsed.avalancheVisible !== undefined && { avalancheVisible: parsed.avalancheVisible }),
      ...(parsed.avalancheWarningsVisible !== undefined && { avalancheWarningsVisible: parsed.avalancheWarningsVisible }),
      ...(parsed.avalancheWarningsOpacity !== undefined && { avalancheWarningsOpacity: parsed.avalancheWarningsOpacity }),
      ...(parsed.avalancheWarningsDay !== undefined && { avalancheWarningsDay: parsed.avalancheWarningsDay }),
      ...(parsed.snowDepthVisible !== undefined && { snowDepthVisible: parsed.snowDepthVisible }),
      ...(parsed.snowDepthOpacity !== undefined && { snowDepthOpacity: parsed.snowDepthOpacity }),
      ...(parsed.aircraftVisible !== undefined && { aircraftVisible: parsed.aircraftVisible }),
      ...(parsed.aircraftOpacity !== undefined && { aircraftOpacity: parsed.aircraftOpacity }),
      ...(parsed.vesselsVisible !== undefined && { vesselsVisible: parsed.vesselsVisible }),
      ...(parsed.vesselsOpacity !== undefined && { vesselsOpacity: parsed.vesselsOpacity }),
      ...(parsed.trafficFlowVisible !== undefined && { trafficFlowVisible: parsed.trafficFlowVisible }),
      ...(parsed.trafficFlowOpacity !== undefined && { trafficFlowOpacity: parsed.trafficFlowOpacity }),
      ...(parsed.trafficInfoVisible !== undefined && { trafficInfoVisible: parsed.trafficInfoVisible }),
      ...(parsed.trafficInfoOpacity !== undefined && { trafficInfoOpacity: parsed.trafficInfoOpacity }),
      ...(parsed.wmsTransportVisible !== undefined && { wmsTransportVisible: parsed.wmsTransportVisible }),
      ...(parsed.wmsTransportOpacity !== undefined && { wmsTransportOpacity: parsed.wmsTransportOpacity }),
      ...(parsed.wmsPlacenamesVisible !== undefined && { wmsPlacenamesVisible: parsed.wmsPlacenamesVisible }),
      ...(parsed.wmsPlacenamesOpacity !== undefined && { wmsPlacenamesOpacity: parsed.wmsPlacenamesOpacity }),
      ...(parsed.wmsContoursVisible !== undefined && { wmsContoursVisible: parsed.wmsContoursVisible }),
      ...(parsed.wmsContoursOpacity !== undefined && { wmsContoursOpacity: parsed.wmsContoursOpacity }),
      ...(parsed.wmsBordersVisible !== undefined && { wmsBordersVisible: parsed.wmsBordersVisible }),
      ...(parsed.wmsBordersOpacity !== undefined && { wmsBordersOpacity: parsed.wmsBordersOpacity }),
      ...(parsed.sunlightVisible !== undefined && { sunlightVisible: parsed.sunlightVisible }),
      ...(parsed.sunlightOpacity !== undefined && { sunlightOpacity: parsed.sunlightOpacity }),
      ...(parsed.sunlightDate !== undefined && { sunlightDate: parsed.sunlightDate }),
      ...(parsed.sunlightTime !== undefined && { sunlightTime: parsed.sunlightTime }),
      ...(parsed.hillshadeVisible !== undefined && { hillshadeVisible: parsed.hillshadeVisible }),
      ...(parsed.hillshadeOpacity !== undefined && { hillshadeOpacity: parsed.hillshadeOpacity }),
      ...(parsed.terrainVisible !== undefined && { terrainVisible: parsed.terrainVisible }),
      ...(parsed.terrainExaggeration !== undefined && { terrainExaggeration: parsed.terrainExaggeration }),
      ...(parsed.overlayOrder !== undefined && { overlayOrder: parsed.overlayOrder }),
      ...(parsed.auroraVisible !== undefined && { auroraVisible: parsed.auroraVisible }),
      ...(parsed.auroraOpacity !== undefined && { auroraOpacity: parsed.auroraOpacity }),
      ...(parsed.auroraTimeOffset !== undefined && { auroraTimeOffset: parsed.auroraTimeOffset }),
    });
  },
  setChatDrawerWidth: (width) => {
    localStorage.setItem('chatDrawerWidth', String(width));
    return set({ chatDrawerWidth: width });
  },
  setProjectDrawerWidth: (width) => {
    localStorage.setItem('projectDrawerWidth', String(width));
    return set({ projectDrawerWidth: width });
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

export function getThemeState(includePosition = false) {
  const s = useMapStore.getState();
  const state = {
    baseLayer: s.baseLayer,
    windVisible: s.windVisible,
    windOpacity: s.windOpacity,
    webcamsVisible: s.webcamsVisible,
    avalancheVisible: s.avalancheVisible,
    avalancheWarningsVisible: s.avalancheWarningsVisible,
    avalancheWarningsOpacity: s.avalancheWarningsOpacity,
    avalancheWarningsDay: s.avalancheWarningsDay,
    snowDepthVisible: s.snowDepthVisible,
    snowDepthOpacity: s.snowDepthOpacity,
    aircraftVisible: s.aircraftVisible,
    aircraftOpacity: s.aircraftOpacity,
    vesselsVisible: s.vesselsVisible,
    vesselsOpacity: s.vesselsOpacity,
    trafficFlowVisible: s.trafficFlowVisible,
    trafficFlowOpacity: s.trafficFlowOpacity,
    trafficInfoVisible: s.trafficInfoVisible,
    trafficInfoOpacity: s.trafficInfoOpacity,
    wmsTransportVisible: s.wmsTransportVisible,
    wmsTransportOpacity: s.wmsTransportOpacity,
    wmsPlacenamesVisible: s.wmsPlacenamesVisible,
    wmsPlacenamesOpacity: s.wmsPlacenamesOpacity,
    wmsContoursVisible: s.wmsContoursVisible,
    wmsContoursOpacity: s.wmsContoursOpacity,
    wmsBordersVisible: s.wmsBordersVisible,
    wmsBordersOpacity: s.wmsBordersOpacity,
    sunlightVisible: s.sunlightVisible,
    sunlightOpacity: s.sunlightOpacity,
    sunlightDate: s.sunlightDate,
    sunlightTime: s.sunlightTime,
    hillshadeVisible: s.hillshadeVisible,
    hillshadeOpacity: s.hillshadeOpacity,
    terrainVisible: s.terrainVisible,
    terrainExaggeration: s.terrainExaggeration,
    overlayOrder: s.overlayOrder,
    auroraVisible: s.auroraVisible,
    auroraOpacity: s.auroraOpacity,
    auroraTimeOffset: s.auroraTimeOffset,
  };
  if (includePosition) {
    const map = s.mapRef;
    state.position = {
      longitude: s.longitude,
      latitude: s.latitude,
      zoom: s.zoom,
      pitch: map?.getPitch() || 0,
      bearing: map?.getBearing() || 0,
    };
  }
  return state;
}
