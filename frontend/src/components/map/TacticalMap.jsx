import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import Map, { Marker } from 'react-map-gl/maplibre';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore, getAllVisibleDrawings, getAllVisiblePins } from '../../stores/useTacticalStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { buildMapStyle } from '../../lib/map-styles.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../lib/constants.js';
import { socket } from '../../lib/socket.js';
import { useWeatherStore } from '../../stores/useWeatherStore.js';
import { t } from '../../lib/i18n.js';
import NatoMarkerLayer from './NatoMarkerLayer.jsx';
import WebcamLayer from './WebcamLayer.jsx';
import WindOverlay, { WindLegend } from './WindOverlay.jsx';
import SunlightOverlay, { SunlightLegend } from './SunlightOverlay.jsx';
import DrawingLayer from './DrawingLayer.jsx';
import BuildingsLayer from './BuildingsLayer.jsx';
import TerrainLayer from './TerrainLayer.jsx';
import ContextMenu from './ContextMenu.jsx';
import DraggablePopup from './DraggablePopup.jsx';
import DataFreshness from './DataFreshness.jsx';
import SnowDepthLegend from './SnowDepthLegend.jsx';
import AvalancheWarningsLegend from './AvalancheWarningsLegend.jsx';
import AircraftLayer, { AircraftLegend } from './AircraftLayer.jsx';
import VesselLayer, { VesselLegend } from './VesselLayer.jsx';
import VesselDeepAnalysis from './VesselDeepAnalysis.jsx';
import VesselActivityBox from './VesselActivityBox.jsx';
import VesselActivityPanel from '../panels/VesselActivityPanel.jsx';
import { useAvalancheWarnings } from '../../hooks/useAvalancheWarnings.js';
import { useAircraft } from '../../hooks/useAircraft.js';
import { useVessels } from '../../hooks/useVessels.js';
import { useTraffic } from '../../hooks/useTraffic.js';
import { useAuroraForecast } from '../../hooks/useAuroraForecast.js';
import { useRoadRestrictions } from '../../hooks/useRoadRestrictions.js';
import AuroraLegend from './AuroraLegend.jsx';
import AuroraOverlay from './AuroraOverlay.jsx';
import TrafficLayer, { TrafficLegend, TrafficFlowLegend } from './TrafficLayer.jsx';
import RoadRestrictionsLayer, { RoadRestrictionsLegend } from './RoadRestrictionsLayer.jsx';
import InfrastructureLayer from './InfrastructureLayer.jsx';
import ItemInfoPopup from './ItemInfoPopup.jsx';
import MeasuringTool from './MeasuringTool.jsx';
import ViewshedTool from './ViewshedTool.jsx';
import SatelliteInfo from './SatelliteInfo.jsx';
import WmsOverlayToggles from './WmsOverlayToggles.jsx';

let nextMenuId = 1;

export default function TacticalMap() {
  const mapRef = useRef(null);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const userLocation = useMapStore((s) => s.userLocation);
  const windVisible = useMapStore((s) => s.windVisible);
  const sunlightVisible = useMapStore((s) => s.sunlightVisible);
  const avalancheVisible = useMapStore((s) => s.avalancheVisible);
  const avalancheWarningsVisible = useMapStore((s) => s.avalancheWarningsVisible);
  const avalancheWarningsOpacity = useMapStore((s) => s.avalancheWarningsOpacity);
  const avalancheWarningsDay = useMapStore((s) => s.avalancheWarningsDay);
  const setAvalancheWarningsFetchedAt = useMapStore((s) => s.setAvalancheWarningsFetchedAt);
  const snowDepthVisible = useMapStore((s) => s.snowDepthVisible);
  const snowDepthOpacity = useMapStore((s) => s.snowDepthOpacity);
  const aircraftVisible = useMapStore((s) => s.aircraftVisible);
  const setAircraftFetchedAt = useMapStore((s) => s.setAircraftFetchedAt);
  const vesselsVisible = useMapStore((s) => s.vesselsVisible);
  const setVesselsFetchedAt = useMapStore((s) => s.setVesselsFetchedAt);
  const trafficFlowVisible = useMapStore((s) => s.trafficFlowVisible);
  const trafficInfoVisible = useMapStore((s) => s.trafficInfoVisible);
  const setTrafficInfoFetchedAt = useMapStore((s) => s.setTrafficInfoFetchedAt);
  const auroraVisible = useMapStore((s) => s.auroraVisible);
  const auroraOpacity = useMapStore((s) => s.auroraOpacity);
  const setAuroraFetchedAt = useMapStore((s) => s.setAuroraFetchedAt);
  const roadRestrictionsVisible = useMapStore((s) => s.roadRestrictionsVisible);
  const setRoadRestrictionsFetchedAt = useMapStore((s) => s.setRoadRestrictionsFetchedAt);
  const overlayOrder = useMapStore((s) => s.overlayOrder);
  const lang = useMapStore((s) => s.lang);
  const mgrsMarker = useMapStore((s) => s.mgrsMarker);
  const setMgrsMarker = useMapStore((s) => s.setMgrsMarker);
  const selectedDrawingId = useMapStore((s) => s.selectedDrawingId);
  const dragPreview = useMapStore((s) => s.dragPreview);
  const drawingToolsVisible = useMapStore((s) => s.drawingToolsVisible);
  const setMapRef = useMapStore((s) => s.setMapRef);
  const setBounds = useMapStore((s) => s.setBounds);
  const setViewport = useMapStore((s) => s.setViewport);
  const windLoading = useWeatherStore((s) => s.windLoading);
  const placementMode = useMapStore((s) => s.placementMode);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);
  const activePanel = useMapStore((s) => s.activePanel);
  const setAvalancheWarningRegion = useMapStore((s) => s.setAvalancheWarningRegion);
  const vesselDeepAnalysis = useMapStore((s) => s.vesselDeepAnalysis);
  const clearVesselDeepAnalysis = useMapStore((s) => s.clearVesselDeepAnalysis);

  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const myProjects = useProjectStore((s) => s.myProjects);
  const tacticalProjects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const tacticalState = useTacticalStore();
  const visibleDrawings = getAllVisibleDrawings(tacticalState);
  const visiblePins = getAllVisiblePins(tacticalState);
  const contextPins = visiblePins.filter(p => p.pinType === 'context');

  // Auth state for local-only markers (non-logged-in users)
  const user = useAuthStore((s) => s.user);
  const [localMarkers, setLocalMarkers] = useState([]);

  const { data: avalancheWarningsData, loading: avalancheWarningsLoading, fetchedAt: avalancheWarningsFetchedAt } = useAvalancheWarnings(avalancheWarningsVisible, avalancheWarningsDay);
  const { data: aircraftData, loading: aircraftLoading, fetchedAt: aircraftFetchedAt } = useAircraft(aircraftVisible);
  const { data: vesselsData, loading: vesselsLoading, fetchedAt: vesselsFetchedAt } = useVessels(vesselsVisible);
  const { data: trafficInfoData, loading: trafficInfoLoading, fetchedAt: trafficInfoFetchedAt } = useTraffic(trafficInfoVisible);
  const { data: auroraData, kpData: auroraKpData, loading: auroraLoading, fetchedAt: auroraFetchedAt } = useAuroraForecast(auroraVisible);
  const { data: roadRestrictionsData, loading: roadRestrictionsLoading, fetchedAt: roadRestrictionsFetchedAt } = useRoadRestrictions(roadRestrictionsVisible);

  // Sync fetchedAt to store for DataFreshness
  useEffect(() => {
    setAvalancheWarningsFetchedAt(avalancheWarningsFetchedAt);
  }, [avalancheWarningsFetchedAt, setAvalancheWarningsFetchedAt]);

  useEffect(() => {
    setAircraftFetchedAt(aircraftFetchedAt);
  }, [aircraftFetchedAt, setAircraftFetchedAt]);

  useEffect(() => {
    setVesselsFetchedAt(vesselsFetchedAt);
  }, [vesselsFetchedAt, setVesselsFetchedAt]);

  useEffect(() => {
    setTrafficInfoFetchedAt(trafficInfoFetchedAt);
  }, [trafficInfoFetchedAt, setTrafficInfoFetchedAt]);

  useEffect(() => {
    setAuroraFetchedAt(auroraFetchedAt);
  }, [auroraFetchedAt, setAuroraFetchedAt]);

  useEffect(() => {
    setRoadRestrictionsFetchedAt(roadRestrictionsFetchedAt);
  }, [roadRestrictionsFetchedAt, setRoadRestrictionsFetchedAt]);

  const [contextMenus, setContextMenus] = useState([]);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const rotating = useMapStore((s) => s.flyAroundActive);
  const setRotating = useMapStore((s) => s.setFlyAroundActive);
  const [rotationSpeed, setRotationSpeed] = useState(8); // degrees per second
  const rotationFrameRef = useRef(null);
  const [drawingInfoPopup, setDrawingInfoPopup] = useState(null);
  const [snowDepthLoading, setSnowDepthLoading] = useState(false);
  const suppressMapContextMenu = useRef(false);

  const trafficFlowOpacity = useMapStore((s) => s.trafficFlowOpacity);
  const wmsTransportVisible = useMapStore((s) => s.wmsTransportVisible);
  const wmsTransportOpacity = useMapStore((s) => s.wmsTransportOpacity);
  const wmsPlacenamesVisible = useMapStore((s) => s.wmsPlacenamesVisible);
  const wmsPlacenamesOpacity = useMapStore((s) => s.wmsPlacenamesOpacity);
  const wmsContoursVisible = useMapStore((s) => s.wmsContoursVisible);
  const wmsContoursOpacity = useMapStore((s) => s.wmsContoursOpacity);
  const wmsBordersVisible = useMapStore((s) => s.wmsBordersVisible);
  const wmsBordersOpacity = useMapStore((s) => s.wmsBordersOpacity);
  const mapStyle = useMemo(
    () => buildMapStyle(baseLayer, {
      avalancheVisible,
      avalancheWarningsVisible,
      avalancheWarningsOpacity,
      avalancheWarningsData,
      snowDepthVisible,
      snowDepthOpacity,
      trafficFlowVisible,
      trafficFlowOpacity,
      wmsTransportVisible,
      wmsTransportOpacity,
      wmsPlacenamesVisible,
      wmsPlacenamesOpacity,
      wmsContoursVisible,
      wmsContoursOpacity,
      wmsBordersVisible,
      wmsBordersOpacity,
      auroraVisible,
      overlayOrder,
    }),
    [baseLayer, avalancheVisible, avalancheWarningsVisible, avalancheWarningsOpacity, avalancheWarningsData, snowDepthVisible, snowDepthOpacity, trafficFlowVisible, trafficFlowOpacity, wmsTransportVisible, wmsTransportOpacity, wmsPlacenamesVisible, wmsPlacenamesOpacity, wmsContoursVisible, wmsContoursOpacity, wmsBordersVisible, wmsBordersOpacity, auroraVisible, overlayOrder]
  );

  const updateBounds = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) {
      const b = map.getBounds();
      setBounds({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    }
  }, [setBounds]);

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) {
      setMapRef(map);
      updateBounds();
      map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }, [setMapRef, updateBounds]);


  const onMove = useCallback((evt) => {
    const { longitude, latitude, zoom, bearing, pitch } = evt.viewState;
    setViewport({ longitude, latitude, zoom });
    try {
      sessionStorage.setItem('mapViewState', JSON.stringify({ longitude, latitude, zoom, bearing, pitch }));
    } catch {}
  }, [setViewport]);

  const onMoveEnd = useCallback(() => {
    updateBounds();
  }, [updateBounds]);

  const onClick = useCallback((evt) => {
    setContextMenus((prev) => prev.filter((m) => m.pinned));

    if (placementMode) {
      const { lng, lat } = evt.lngLat;

      if (activeProjectId) {
        // Logged in with active project - save to server
        socket.emit('client:marker:add', {
          projectId: activeProjectId,
          sidc: placementMode.sidc,
          lat,
          lon: lng,
          designation: placementMode.designation || '',
          higherFormation: '',
          additionalInfo: '',
          layerId: placementMode.layerId || activeLayerId || null,
          source: 'user',
          createdBy: socket.id,
        });
      } else if (!user) {
        // Not logged in - add to local markers (not saved)
        setLocalMarkers((prev) => [...prev, {
          id: `local-${Date.now()}`,
          sidc: placementMode.sidc,
          lat,
          lon: lng,
          designation: placementMode.designation || '',
          higherFormation: '',
          additionalInfo: '',
          _local: true,
        }]);
      }
      // If logged in but no active project, placement is ignored (user should select a project)

      setPlacementMode(null);
      return;
    }

    // When avalanche detail panel is open, click switches to clicked region
    if (activePanel === 'avalancheWarning') {
      const { lng, lat } = evt.lngLat;
      fetch(`/api/avalanche-warnings/at?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&day=0`)
        .then(r => r.json())
        .then(d => {
          if (d.regionId) {
            setAvalancheWarningRegion(d.regionId, d.regionName);
          }
        })
        .catch(() => {});
    }
  }, [placementMode, setPlacementMode, activeProjectId, activeLayerId, activePanel, setAvalancheWarningRegion]);

  // Right-click context menu + long-press for touch devices
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleContextMenu = (e) => {
      e.preventDefault();
      if (suppressMapContextMenu.current) {
        suppressMapContextMenu.current = false;
        return;
      }
      const { lng, lat } = e.lngLat;
      const { x, y } = e.point;
      const id = nextMenuId++;
      setContextMenus((prev) => [...prev, { id, lng, lat, x, y, pinned: false }]);
    };

    // Touch long-press support
    let longPressTimer = null;
    let touchStartPoint = null;
    let touchStartLngLat = null;

    const onTouchStart = (e) => {
      if (e.originalEvent.touches.length !== 1) {
        clearTimeout(longPressTimer);
        return;
      }
      touchStartPoint = e.point;
      touchStartLngLat = e.lngLat;
      longPressTimer = setTimeout(() => {
        e.originalEvent.preventDefault();
        const { lng, lat } = touchStartLngLat;
        const { x, y } = touchStartPoint;
        if (suppressMapContextMenu.current) {
          suppressMapContextMenu.current = false;
          return;
        }
        const id = nextMenuId++;
        setContextMenus((prev) => [...prev, { id, lng, lat, x, y, pinned: false }]);
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
    };

    const onTouchMove = (e) => {
      if (!touchStartPoint || !longPressTimer) return;
      const dx = e.point.x - touchStartPoint.x;
      const dy = e.point.y - touchStartPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onTouchEnd = () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    map.on('contextmenu', handleContextMenu);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', onTouchEnd);
    return () => {
      map.off('contextmenu', handleContextMenu);
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      map.off('touchend', onTouchEnd);
    };
  }, [useMapStore.getState().mapRef]);

  const closeMenu = useCallback((menuId) => {
    setContextMenus((prev) => {
      const menu = prev.find(m => m.id === menuId);
      if (menu?.savedToProject) {
        // Also delete the saved pin from the project to prevent ghost popup
        const project = useTacticalStore.getState().projects[menu.savedToProject];
        const pins = project?.pins || [];
        const match = pins.find(p =>
          Math.abs(p.lat - menu.lat) < 0.00001 && Math.abs(p.lon - menu.lng) < 0.00001
        );
        if (match) {
          socket.emit('client:pin:delete', { projectId: menu.savedToProject, id: match.id });
        }
      }
      return prev.filter((m) => m.id !== menuId);
    });
  }, []);

  // Pin menu: saves to active project if available, keeps in contextMenus
  const pinMenu = useCallback((menuId, pinned, displayPos) => {
    setContextMenus((prev) => {
      const menu = prev.find(m => m.id === menuId);
      if (menu && pinned && !menu.savedToProject) {
        const { activeProjectId, activeLayerId } = useTacticalStore.getState();
        if (activeProjectId) {
          const props = {};
          if (displayPos) {
            props.displayLng = displayPos.lng;
            props.displayLat = displayPos.lat;
          }
          socket.emit('client:pin:add', {
            projectId: activeProjectId,
            layerId: activeLayerId || null,
            pinType: 'context',
            lat: menu.lat,
            lon: menu.lng,
            properties: props,
            source: 'user',
            createdBy: socket.id,
          });
          return prev.map((m) => m.id === menuId ? { ...m, pinned: true, savedToProject: activeProjectId } : m);
        }
      }
      return prev.map((m) => m.id === menuId ? { ...m, pinned } : m);
    });
  }, []);

  // Clean up temp menus when their project is hidden
  useEffect(() => {
    setContextMenus((prev) => {
      const next = prev.filter(m => !m.savedToProject || visibleProjectIds.includes(m.savedToProject));
      return next.length !== prev.length ? next : prev;
    });
  }, [visibleProjectIds]);

  // Snow depth loading indicator — track tile loading via map source events
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !snowDepthVisible) { setSnowDepthLoading(false); return; }
    setSnowDepthLoading(true);
    const onIdle = () => setSnowDepthLoading(false);
    const onSourceData = (e) => {
      if (e.sourceId === 'snowdepth-img' && e.isSourceLoaded) setSnowDepthLoading(false);
    };
    map.on('idle', onIdle);
    map.on('sourcedata', onSourceData);
    return () => { map.off('idle', onIdle); map.off('sourcedata', onSourceData); };
  }, [snowDepthVisible, useMapStore.getState().mapRef]);

  // Force re-render on map move so SVG drawing overlay stays in sync
  const [, drawingTick] = useState(0);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onMove = () => drawingTick((n) => n + 1);
    map.on('move', onMove);
    return () => map.off('move', onMove);
  }, [useMapStore.getState().mapRef]);

  // Track map bearing for compass rose
  const mapInstance = useMapStore((s) => s.mapRef);
  useEffect(() => {
    if (!mapInstance) return;
    const onRotate = () => setBearing(mapInstance.getBearing());
    mapInstance.on('rotate', onRotate);
    return () => mapInstance.off('rotate', onRotate);
  }, [mapInstance]);

  // Track map pitch for fly-around button visibility
  useEffect(() => {
    if (!mapInstance) return;
    const onPitch = () => setPitch(mapInstance.getPitch());
    mapInstance.on('pitch', onPitch);
    setPitch(mapInstance.getPitch()); // Initial value
    return () => mapInstance.off('pitch', onPitch);
  }, [mapInstance]);

  // Fly-around rotation animation
  useEffect(() => {
    if (!rotating || !mapInstance) return;

    let lastTime = performance.now();

    function tick(now) {
      const deltaMs = now - lastTime;
      lastTime = now;
      const deltaDeg = (deltaMs / 1000) * rotationSpeed;
      const currentBearing = mapInstance.getBearing();
      mapInstance.setBearing(currentBearing - deltaDeg); // Subtract for counter-clockwise
      rotationFrameRef.current = requestAnimationFrame(tick);
    }

    rotationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
    };
  }, [rotating, mapInstance, rotationSpeed]);

  // Stop rotation on Escape key
  useEffect(() => {
    if (!rotating) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setRotating(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rotating]);

  // Stop rotation on user map interaction (pan, tilt)
  // Note: rotatestart is not used because setBearing() triggers it programmatically
  useEffect(() => {
    if (!rotating || !mapInstance) return;
    const stopRotation = () => setRotating(false);
    mapInstance.on('dragstart', stopRotation);
    mapInstance.on('pitchstart', stopRotation);
    return () => {
      mapInstance.off('dragstart', stopRotation);
      mapInstance.off('pitchstart', stopRotation);
    };
  }, [rotating, mapInstance]);

  // Avalanche region hover cursor when detail panel is open
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const showCursor = activePanel === 'avalancheWarning' && avalancheWarningsVisible;
    if (!showCursor) return;
    const layerId = 'avalanche-warnings-fill';
    if (!map.getLayer(layerId)) return;
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('mouseenter', layerId, onEnter);
    map.on('mouseleave', layerId, onLeave);
    return () => {
      map.off('mouseenter', layerId, onEnter);
      map.off('mouseleave', layerId, onLeave);
      map.getCanvas().style.cursor = '';
    };
  }, [activePanel, avalancheWarningsVisible, mapInstance]);

  // Project to screen coordinates for SVG rendering
  const map = mapRef.current?.getMap();

  function projectCoord(coord) {
    if (!map) return null;
    try { const p = map.project(coord); return { x: p.x, y: p.y }; }
    catch { return null; }
  }

  function projectCoords(coords) {
    return coords.map(c => projectCoord(c)).filter(Boolean);
  }

  return (
    <div className="absolute inset-0" data-map-container>
      <Map
        ref={mapRef}
        initialViewState={(() => {
          try {
            const saved = JSON.parse(sessionStorage.getItem('mapViewState'));
            if (saved?.longitude && saved?.latitude && saved?.zoom) return saved;
          } catch {}
          return { longitude: DEFAULT_CENTER.longitude, latitude: DEFAULT_CENTER.latitude, zoom: DEFAULT_ZOOM };
        })()}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        maxPitch={85}
        maxTileCacheSize={300}
        onLoad={onMapLoad}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onClick={onClick}
        cursor={placementMode ? 'crosshair' : 'grab'}
        preserveDrawingBuffer={true}
        attributionControl={false}
      >
        <NatoMarkerLayer localMarkers={localMarkers} setLocalMarkers={setLocalMarkers} />
        {webcamsVisible && <WebcamLayer />}
        {userLocation && (
          <Marker longitude={userLocation.longitude} latitude={userLocation.latitude} anchor="center">
            <div className="user-location-marker" title={lang === 'no' ? 'Du er her' : 'You are here'}>
              <div className="user-location-pulse" />
              <div className="user-location-dot" />
            </div>
          </Marker>
        )}
      </Map>

      {/* Compass rose */}
      <button
        onClick={() => {
          const map = mapRef.current?.getMap();
          if (map) map.easeTo({ bearing: 0, duration: 300 });
        }}
        className="absolute top-4 left-4 z-10 w-12 h-12 rounded-full bg-slate-800/80 hover:bg-slate-700/90 flex items-center justify-center shadow-lg transition-colors"
        title={lang === 'no' ? 'Tilbakestill til nord' : 'Reset to North'}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: `rotate(${-bearing}deg)` }}>
          <polygon points="16,2 12,16 16,13 20,16" fill="#ef4444" />
          <polygon points="16,30 12,16 16,19 20,16" fill="#94a3b8" />
          <text x="16" y="10" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">N</text>
        </svg>
      </button>

      {/* Fly-around rotation button and speed controls - visible when pitched */}
      {pitch > 5 && (
        <div className="absolute top-4 left-[4.5rem] z-10 flex items-center gap-3">
          <button
            onClick={() => setRotating(!rotating)}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors ${
              rotating
                ? 'bg-red-600/90 hover:bg-red-500/90'
                : 'bg-slate-800/80 hover:bg-slate-700/90'
            }`}
            title={lang === 'no'
              ? (rotating ? 'Stopp rotasjon (Esc)' : 'Start flyover-rotasjon')
              : (rotating ? 'Stop rotation (Esc)' : 'Start fly-around rotation')
            }
          >
            {rotating ? (
              // Stop icon
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              // Rotation arrow with play button inside
              <svg width="32" height="32" viewBox="0 0 305.836 305.836" fill="white">
                <path d="M152.924,300.748c84.319,0,152.912-68.6,152.912-152.918c0-39.476-15.312-77.231-42.346-105.564
                  c0,0,3.938-8.857,8.814-19.783c4.864-10.926-2.138-18.636-15.648-17.228l-79.125,8.289c-13.511,1.411-17.999,11.467-10.021,22.461
                  l46.741,64.393c7.986,10.992,17.834,12.31,22.008,2.937l7.56-16.964c12.172,18.012,18.976,39.329,18.976,61.459
                  c0,60.594-49.288,109.875-109.87,109.875c-60.591,0-109.882-49.287-109.882-109.875c0-19.086,4.96-37.878,14.357-54.337
                  c5.891-10.325,2.3-23.467-8.025-29.357c-10.328-5.896-23.464-2.3-29.36,8.031C6.923,95.107,0,121.27,0,147.829
                  C0,232.148,68.602,300.748,152.924,300.748z"/>
                {/* Green play triangle in center */}
                <polygon points="115,100 115,210 195,155" fill="#22c55e" />
              </svg>
            )}
          </button>

          {/* Speed controls - only visible when rotating */}
          {rotating && (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => setRotationSpeed(Math.min(32, rotationSpeed + 4))}
                className="w-5 h-5 rounded bg-slate-800/80 hover:bg-slate-700 active:bg-cyan-500 flex items-center justify-center shadow-lg transition-colors text-white text-xs font-bold"
                title={lang === 'no' ? 'Raskere' : 'Faster'}
              >
                +
              </button>
              <button
                onClick={() => setRotationSpeed(Math.max(2, rotationSpeed - 4))}
                className="w-5 h-5 rounded bg-slate-800/80 hover:bg-slate-700 active:bg-cyan-500 flex items-center justify-center shadow-lg transition-colors text-white text-xs font-bold"
                title={lang === 'no' ? 'Saktere' : 'Slower'}
              >
                −
              </button>
            </div>
          )}
        </div>
      )}

      <DrawingLayer />

      {/* SVG overlay for committed drawings */}
      {map && visibleDrawings.length > 0 && (() => (
        <svg className="absolute inset-0 z-[4]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {visibleDrawings.map(d => {
            // Use drag preview geometry if this drawing is being dragged
            const geom = (dragPreview && dragPreview.drawingId === d.id) ? dragPreview.geometry : d.geometry;
            const color = d.properties?.color || '#3b82f6';
            const sw = d.properties?.strokeWidth || 3;
            const key = d.id;
            const isSelected = selectedDrawingId === d.id;
            const handleContextMenu = (e) => {
              e.preventDefault();
              e.stopPropagation();
              suppressMapContextMenu.current = true;
              setDrawingInfoPopup({
                projectId: d._projectId,
                layerId: d.layerId,
                x: e.clientX,
                y: e.clientY,
              });
            };

            const handleClick = (e) => {
              // Only select if drawing tools are visible
              const { drawingToolsVisible, drawingActiveMode, setSelectedDrawingId } = useMapStore.getState();
              if (!drawingToolsVisible || drawingActiveMode) return;
              e.stopPropagation();
              setSelectedDrawingId(isSelected ? null : d.id);
            };

            const handleDblClick = (e) => {
              const { drawingToolsVisible, drawingActiveMode } = useMapStore.getState();
              if (!drawingToolsVisible || drawingActiveMode) return;
              e.stopPropagation();
              e.preventDefault();
              if (d.drawingType === 'text') {
                const newText = prompt(lang === 'no' ? 'Rediger tekst:' : 'Edit text:', d.properties?.text || '');
                if (newText === null) return;
                socket.emit('client:drawing:update', {
                  projectId: d._projectId,
                  id: d.id,
                  properties: { ...d.properties, text: newText },
                });
              } else {
                const newLabel = prompt(lang === 'no' ? 'Rediger etikett:' : 'Edit label:', d.properties?.label || '');
                if (newLabel === null) return;
                socket.emit('client:drawing:update', {
                  projectId: d._projectId,
                  id: d.id,
                  properties: { ...d.properties, label: newLabel || undefined },
                });
              }
            };

            // Helper: compute bounding box with padding from screen points
            const getBBox = (pts, pad = 8) => {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
              return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
            };

            // Render selection bounding box with marching ants + corner handles
            const renderSelectionBBox = (pts, pad = 12) => {
              const bb = getBBox(pts, pad);
              const cs = 6; // corner handle size
              const corners = [
                [bb.x, bb.y], [bb.x + bb.w, bb.y],
                [bb.x, bb.y + bb.h], [bb.x + bb.w, bb.y + bb.h],
              ];
              return (
                <>
                  {/* Outer glow */}
                  <rect x={bb.x - 2} y={bb.y - 2} width={bb.w + 4} height={bb.h + 4} fill="none" stroke="#06b6d4" strokeWidth="4" opacity="0.15" rx="6" />
                  {/* Tinted fill */}
                  <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h} fill="#06b6d4" fillOpacity="0.05" stroke="none" rx="4" />
                  {/* Marching ants border */}
                  <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h} fill="none" stroke="#06b6d4" strokeWidth="2" strokeDasharray="9 9" rx="4" className="selection-bbox" />
                  {/* Corner handles */}
                  {corners.map(([cx, cy], i) => (
                    <rect key={i} x={cx - cs/2} y={cy - cs/2} width={cs} height={cs} fill="white" stroke="#06b6d4" strokeWidth="2" rx="1" />
                  ))}
                </>
              );
            };

            if (geom.type === 'LineString') {
              const pts = projectCoords(geom.coordinates);
              if (pts.length < 2) return null;
              const isArrow = d.properties?.lineType === 'arrow' || d.drawingType === 'arrow';
              return (
                <g key={key} style={{ pointerEvents: isSelected ? 'none' : 'auto', cursor: isSelected ? 'move' : 'pointer' }} onClick={handleClick} onDoubleClick={handleDblClick} onContextMenu={handleContextMenu}>
                  {/* Selection bounding box + glow */}
                  {isSelected && (
                    <>
                      {renderSelectionBBox(pts)}
                      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#06b6d4" strokeWidth={sw + 8} opacity="0.25" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                  {/* Invisible wider stroke for easier clicking */}
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="12"
                  />
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeDasharray={d.properties?.lineType === 'dashed' ? '8 4' : 'none'}
                  />
                  {isArrow && (() => {
                    const p1 = pts[pts.length - 2];
                    const p2 = pts[pts.length - 1];
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const scale = Math.max(1, sw / 3);
                    const size = 18 * scale;
                    const halfW = 10 * scale;
                    const tip = p2;
                    const leftX = tip.x - size * Math.cos(angle) + halfW * Math.sin(angle);
                    const leftY = tip.y - size * Math.sin(angle) - halfW * Math.cos(angle);
                    const rightX = tip.x - size * Math.cos(angle) - halfW * Math.sin(angle);
                    const rightY = tip.y - size * Math.sin(angle) + halfW * Math.cos(angle);
                    return (
                      <polygon
                        points={`${tip.x},${tip.y} ${leftX},${leftY} ${rightX},${rightY}`}
                        fill={color}
                        stroke={color}
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    );
                  })()}
                  {d.properties?.label && (() => {
                    const mid = pts[Math.floor(pts.length / 2)];
                    return (
                      <text x={mid.x} y={mid.y - 10} textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="700"
                        stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                    );
                  })()}
                </g>
              );
            }

            if (geom.type === 'Polygon') {
              const ring = geom.coordinates[0];
              const pts = projectCoords(ring);
              if (pts.length < 3) return null;
              const centroid = {
                x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
                y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
              };
              return (
                <g key={key} style={{ pointerEvents: isSelected ? 'none' : 'auto', cursor: isSelected ? 'move' : 'pointer' }} onClick={handleClick} onDoubleClick={handleDblClick} onContextMenu={handleContextMenu}>
                  {/* Selection bounding box + glow */}
                  {isSelected && (
                    <>
                      {renderSelectionBBox(pts, 10)}
                      <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#06b6d4" strokeWidth={sw + 6} opacity="0.3" strokeLinejoin="round" />
                    </>
                  )}
                  <polygon
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={color}
                    fillOpacity={d.properties?.fillOpacity ?? 0.15}
                    stroke={color}
                    strokeWidth={sw}
                  />
                  {d.properties?.label && (
                    <text x={centroid.x} y={centroid.y} textAnchor="middle" dominantBaseline="central"
                      fill="#ffffff" fontSize="16" fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (geom.type === 'Point' && d.drawingType === 'text') {
              const pt = projectCoord(geom.coordinates);
              if (!pt) return null;
              return (
                <g key={key} style={{ pointerEvents: isSelected ? 'none' : 'auto', cursor: isSelected ? 'move' : 'pointer' }} onClick={handleClick} onDoubleClick={handleDblClick} onContextMenu={handleContextMenu}>
                  {isSelected && renderSelectionBBox([{ x: pt.x - 30, y: pt.y - 12 }, { x: pt.x + 30, y: pt.y + 12 }], 8)}
                  <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central"
                    fill="#ffffff" fontSize="18" fontWeight="700"
                    stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties?.text || ''}</text>
                </g>
              );
            }

            return null;
          })}
        </svg>
      ))()}

      <BuildingsLayer />
      <TerrainLayer />
      {sunlightVisible && <SunlightOverlay />}
      {aircraftVisible && <AircraftLayer data={aircraftData} mapRef={mapInstance} />}
      {vesselsVisible && <VesselLayer data={vesselsData} mapRef={mapInstance} />}
      {trafficInfoVisible && <TrafficLayer data={trafficInfoData} mapRef={mapInstance} />}
      {roadRestrictionsVisible && <RoadRestrictionsLayer data={roadRestrictionsData} mapRef={mapInstance} />}
      <InfrastructureLayer mapRef={mapInstance} />
      {auroraVisible && <AuroraOverlay />}
      {windVisible && <WindOverlay />}
      {/* Bottom-left: satellite info + WMS toggles + data sources */}
      <div className="absolute bottom-4 left-4 z-[6] flex flex-col gap-1.5 items-start max-w-[calc(100%-2rem)]">
        <SatelliteInfo map={mapInstance} />
        <WmsOverlayToggles />
        <DataFreshness />
      </div>

      {/* Legends + loading indicators — stacked bottom-right */}
      {(windVisible || snowDepthVisible || avalancheWarningsVisible || aircraftVisible || vesselsVisible || trafficFlowVisible || trafficInfoVisible || sunlightVisible || auroraVisible || roadRestrictionsVisible) && (
        <div className="absolute bottom-4 right-4 z-[6] flex flex-col gap-1.5">
          {(windLoading || snowDepthLoading || avalancheWarningsLoading || aircraftLoading || vesselsLoading || trafficInfoLoading || auroraLoading || roadRestrictionsLoading || (aircraftVisible && !aircraftData) || (vesselsVisible && !vesselsData) || (trafficInfoVisible && !trafficInfoData) || (auroraVisible && !auroraData) || (roadRestrictionsVisible && !roadRestrictionsData)) && (
            <div className="flex flex-col items-end gap-1">
              {windVisible && windLoading && (
                <div className="text-xs text-cyan-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter vinddata...' : 'Loading wind data...'}
                </div>
              )}
              {snowDepthVisible && snowDepthLoading && (
                <div className="text-xs text-blue-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter sn\u00f8dybdedata...' : 'Loading snow depth data...'}
                </div>
              )}
              {avalancheWarningsVisible && avalancheWarningsLoading && (
                <div className="text-xs text-orange-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter skredvarsel...' : 'Loading avalanche warnings...'}
                </div>
              )}
              {(aircraftLoading || (aircraftVisible && !aircraftData)) && (
                <div className="text-xs text-amber-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter luftfartdata...' : 'Loading aircraft data...'}
                </div>
              )}
              {(vesselsLoading || (vesselsVisible && !vesselsData)) && (
                <div className="text-xs text-cyan-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter fart\u00f8ydata...' : 'Loading vessel data...'}
                </div>
              )}
              {(trafficInfoLoading || (trafficInfoVisible && !trafficInfoData)) && (
                <div className="text-xs text-orange-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter trafikkmeldinger...' : 'Loading traffic info...'}
                </div>
              )}
              {(auroraLoading || (auroraVisible && !auroraData)) && (
                <div className="text-xs text-green-400 bg-slate-800/80 px-2 py-1 rounded">
                  {t('aurora.loading', lang)}
                </div>
              )}
              {(roadRestrictionsLoading || (roadRestrictionsVisible && !roadRestrictionsData)) && (
                <div className="text-xs text-orange-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter vegrestriksjoner...' : 'Loading road restrictions...'}
                </div>
              )}
            </div>
          )}
          {sunlightVisible && <SunlightLegend lang={lang} />}
          {windVisible && <WindLegend lang={lang} />}
          {snowDepthVisible && <SnowDepthLegend />}
          {avalancheWarningsVisible && <AvalancheWarningsLegend />}
          {aircraftVisible && <AircraftLegend count={aircraftData?.meta?.total} />}
          {vesselsVisible && <VesselLegend count={vesselsData?.meta?.total} />}
          {trafficFlowVisible && <TrafficFlowLegend />}
          {trafficInfoVisible && <TrafficLegend count={trafficInfoData?.meta?.total} />}
          {auroraVisible && <AuroraLegend kpData={auroraKpData} />}
          {roadRestrictionsVisible && <RoadRestrictionsLegend count={roadRestrictionsData?.meta?.total} mapRef={mapInstance} />}
        </div>
      )}
      {contextMenus.map((menu) => (
        <DraggablePopup
          key={menu.id}
          originLng={menu.lng}
          originLat={menu.lat}
          originX={menu.x}
          originY={menu.y}
          onPin={(pos) => pinMenu(menu.id, true, pos)}
        >
          <ContextMenu
            lng={menu.lng}
            lat={menu.lat}
            x={0}
            y={0}
            pinned={menu.pinned}
            onClose={() => closeMenu(menu.id)}
            onPin={(p) => pinMenu(menu.id, p)}
          />
        </DraggablePopup>
      ))}
      {/* Saved context pins from project data (skip if temp menu still active) */}
      {contextPins
        .filter((pin) => !contextMenus.some((m) =>
          m.savedToProject && Math.abs(pin.lat - m.lat) < 0.00001 && Math.abs(pin.lon - m.lng) < 0.00001
        ))
        .map((pin) => (
        <DraggablePopup
          key={`pin-${pin.id}`}
          originLng={pin.lon}
          originLat={pin.lat}
          initialDisplayLng={pin.properties?.displayLng}
          initialDisplayLat={pin.properties?.displayLat}
          showConnectionLine={true}
          onDragEnd={({ lng, lat }) => {
            socket.emit('client:pin:update', {
              projectId: pin._projectId,
              id: pin.id,
              properties: { ...pin.properties, displayLng: lng, displayLat: lat },
            });
          }}
        >
          <div onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrawingInfoPopup({
              projectId: pin._projectId,
              layerId: pin.layerId,
              x: e.clientX,
              y: e.clientY,
            });
          }}>
            <ContextMenu
              lng={pin.lon}
              lat={pin.lat}
              x={0}
              y={0}
              pinned={true}
              onClose={() => {
                socket.emit('client:pin:delete', { projectId: pin._projectId, id: pin.id });
              }}
              onPin={(p) => {
                if (!p) {
                  socket.emit('client:pin:delete', { projectId: pin._projectId, id: pin.id });
                }
              }}
            />
          </div>
        </DraggablePopup>
      ))}
      {/* MGRS search marker */}
      {mgrsMarker && (
        <DraggablePopup
          originLng={mgrsMarker.lng}
          originLat={mgrsMarker.lat}
          initialOffset={{ dx: 200, dy: -200 }}
          showConnectionLine={true}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden min-w-[180px]">
            <div className="draggable-header bg-emerald-700 px-3 py-1.5 flex items-center justify-between cursor-grab">
              <span className="text-xs font-semibold text-white">MGRS</span>
              <button
                onClick={() => setMgrsMarker(null)}
                className="text-white/70 hover:text-white text-sm leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-3 py-2 space-y-1">
              <div className="font-mono text-sm text-emerald-300 font-medium">{mgrsMarker.mgrs}</div>
              <div className="text-[10px] text-slate-400">
                {mgrsMarker.lat.toFixed(5)}, {mgrsMarker.lng.toFixed(5)}
              </div>
            </div>
          </div>
        </DraggablePopup>
      )}
      {/* Centered project/layer context banner — visible when a project-saving tool is active */}
      {activeProjectId && !placementMode && (drawingToolsVisible || activePanel === 'symbols' || activePanel === 'layers') && (() => {
        const projName = myProjects.find(p => p.id === activeProjectId)?.name;
        const layerName = activeLayerId
          ? tacticalProjects[activeProjectId]?.layers?.find(l => l.id === activeLayerId)?.name
          : null;
        return (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 bg-slate-800/95 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-slate-200 leading-snug border border-slate-500/60 shadow-xl flex items-center gap-3 pointer-events-none">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="font-semibold text-emerald-300">{projName || '...'}</span>
            </div>
            <span className="text-slate-500">|</span>
            {layerName ? (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 flex-shrink-0" />
                <span className="font-medium text-cyan-300">{layerName}</span>
              </div>
            ) : (
              <span className="text-slate-500 italic">{lang === 'no' ? '(Intet lag)' : '(No layer)'}</span>
            )}
          </div>
        );
      })()}
      {placementMode && (() => {
        const projName = activeProjectId ? myProjects.find(p => p.id === activeProjectId)?.name : null;
        const layerName = activeProjectId && (placementMode.layerId || activeLayerId)
          ? tacticalProjects[activeProjectId]?.layers?.find(l => l.id === (placementMode.layerId || activeLayerId))?.name
          : null;
        const isWarning = user && !activeProjectId;
        const isLocal = !user && !activeProjectId;
        return (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 text-white px-4 py-2 rounded shadow-lg z-10 flex items-center gap-3 ${
            isLocal ? 'bg-amber-600' : isWarning ? 'bg-amber-600' : 'bg-emerald-600/95'
          }`}>
            <div className="flex flex-col">
              <span className="text-sm">
                {activeProjectId
                  ? t('symbols.clickMap', lang)
                  : isLocal
                    ? (lang === 'no' ? 'Klikk for å plassere (ikke lagret)' : 'Click to place (not saved)')
                    : (lang === 'no' ? 'Velg et aktivt prosjekt først' : 'Select an active project first')}
              </span>
              {projName && (
                <span className="text-[11px] opacity-80 mt-0.5">
                  {projName}{layerName ? ` · ${layerName}` : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => setPlacementMode(null)}
              className={`px-2 py-1 rounded text-sm ${isLocal || isWarning ? 'bg-amber-800 hover:bg-amber-700' : 'bg-emerald-800 hover:bg-emerald-700'}`}
            >
              {t('symbols.cancel', lang)}
            </button>
          </div>
        );
      })()}
      {drawingInfoPopup && (
        <ItemInfoPopup
          projectId={drawingInfoPopup.projectId}
          layerId={drawingInfoPopup.layerId}
          x={drawingInfoPopup.x}
          y={drawingInfoPopup.y}
          onClose={() => setDrawingInfoPopup(null)}
        />
      )}
      <MeasuringTool />
      <ViewshedTool />
      {/* Vessel Activity Box Drawing */}
      {vesselsVisible && <VesselActivityBox mapRef={mapInstance} />}
      {/* Vessel Activity Panel */}
      {vesselsVisible && <VesselActivityPanel />}
      {/* Vessel Deep Analysis Panel */}
      {vesselDeepAnalysis && (
        <VesselDeepAnalysis
          vessel={vesselDeepAnalysis.vessel}
          traceData={vesselDeepAnalysis.traceData}
          onClose={() => clearVesselDeepAnalysis()}
        />
      )}
    </div>
  );
}
