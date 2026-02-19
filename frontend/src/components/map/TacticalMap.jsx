import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import Map from 'react-map-gl/maplibre';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore, getAllVisibleDrawings, getAllVisiblePins } from '../../stores/useTacticalStore.js';
import { buildMapStyle } from '../../lib/map-styles.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../lib/constants.js';
import { socket } from '../../lib/socket.js';
import { useWeatherStore } from '../../stores/useWeatherStore.js';
import { t } from '../../lib/i18n.js';
import NatoMarkerLayer from './NatoMarkerLayer.jsx';
import WebcamLayer from './WebcamLayer.jsx';
import WindOverlay, { WindLegend } from './WindOverlay.jsx';
import DrawingLayer from './DrawingLayer.jsx';
import ContextMenu from './ContextMenu.jsx';
import DraggablePopup from './DraggablePopup.jsx';
import DataFreshness from './DataFreshness.jsx';
import SnowDepthLegend from './SnowDepthLegend.jsx';
import ItemInfoPopup from './ItemInfoPopup.jsx';

let nextMenuId = 1;

export default function TacticalMap() {
  const mapRef = useRef(null);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const windVisible = useMapStore((s) => s.windVisible);
  const avalancheVisible = useMapStore((s) => s.avalancheVisible);
  const snowDepthVisible = useMapStore((s) => s.snowDepthVisible);
  const snowDepthOpacity = useMapStore((s) => s.snowDepthOpacity);
  const overlayOrder = useMapStore((s) => s.overlayOrder);
  const lang = useMapStore((s) => s.lang);
  const setMapRef = useMapStore((s) => s.setMapRef);
  const setBounds = useMapStore((s) => s.setBounds);
  const setViewport = useMapStore((s) => s.setViewport);
  const windLoading = useWeatherStore((s) => s.windLoading);
  const placementMode = useMapStore((s) => s.placementMode);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);

  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const tacticalState = useTacticalStore();
  const visibleDrawings = getAllVisibleDrawings(tacticalState);
  const visiblePins = getAllVisiblePins(tacticalState);
  const contextPins = visiblePins.filter(p => p.pinType === 'context');

  const [contextMenus, setContextMenus] = useState([]);
  const [bearing, setBearing] = useState(0);
  const [drawingInfoPopup, setDrawingInfoPopup] = useState(null);
  const [snowDepthLoading, setSnowDepthLoading] = useState(false);
  const suppressMapContextMenu = useRef(false);

  const mapStyle = useMemo(
    () => buildMapStyle(baseLayer, { avalancheVisible, snowDepthVisible, snowDepthOpacity, overlayOrder }),
    [baseLayer, avalancheVisible, snowDepthVisible, snowDepthOpacity, overlayOrder]
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
    const { longitude, latitude, zoom } = evt.viewState;
    setViewport({ longitude, latitude, zoom });
  }, [setViewport]);

  const onMoveEnd = useCallback(() => {
    updateBounds();
  }, [updateBounds]);

  const onClick = useCallback((evt) => {
    setContextMenus((prev) => prev.filter((m) => m.pinned));

    if (placementMode && activeProjectId) {
      const { lng, lat } = evt.lngLat;
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
      setPlacementMode(null);
    }
  }, [placementMode, setPlacementMode, activeProjectId, activeLayerId]);

  // Right-click context menu
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

    map.on('contextmenu', handleContextMenu);
    return () => map.off('contextmenu', handleContextMenu);
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
        initialViewState={{
          longitude: DEFAULT_CENTER.longitude,
          latitude: DEFAULT_CENTER.latitude,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        onLoad={onMapLoad}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onClick={onClick}
        cursor={placementMode ? 'crosshair' : 'grab'}
        preserveDrawingBuffer={true}
        attributionControl={false}
      >
        <NatoMarkerLayer />
        {webcamsVisible && <WebcamLayer />}
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
          <text x="16" y="9" textAnchor="middle" fill="#ffffff" fontSize="7" fontWeight="bold">N</text>
        </svg>
      </button>

      <DrawingLayer />

      {/* SVG overlay for committed drawings */}
      {map && visibleDrawings.length > 0 && (
        <svg className="absolute inset-0 z-[4]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {visibleDrawings.map(d => {
            const color = d.properties?.color || '#3b82f6';
            const key = d.id;
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

            if (d.geometry.type === 'LineString') {
              const pts = projectCoords(d.geometry.coordinates);
              if (pts.length < 2) return null;
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onContextMenu={handleContextMenu}>
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
                    strokeWidth="3"
                    strokeDasharray={d.properties?.lineType === 'dashed' ? '8 4' : 'none'}
                  />
                  {d.properties?.label && (() => {
                    const mid = pts[Math.floor(pts.length / 2)];
                    return (
                      <>
                        <text x={mid.x} y={mid.y - 10} textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="700"
                          stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                      </>
                    );
                  })()}
                </g>
              );
            }

            if (d.geometry.type === 'Polygon') {
              const ring = d.geometry.coordinates[0];
              const pts = projectCoords(ring);
              if (pts.length < 3) return null;
              const centroid = {
                x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
                y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
              };
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onContextMenu={handleContextMenu}>
                  <polygon
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={color}
                    fillOpacity={d.properties?.fillOpacity ?? 0.15}
                    stroke={color}
                    strokeWidth="2"
                  />
                  {d.properties?.label && (
                    <text x={centroid.x} y={centroid.y} textAnchor="middle" dominantBaseline="central"
                      fill="#ffffff" fontSize="16" fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (d.geometry.type === 'Point' && d.drawingType === 'text') {
              const pt = projectCoord(d.geometry.coordinates);
              if (!pt) return null;
              return (
                <g key={key} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onContextMenu={handleContextMenu}>
                  <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central"
                    fill="#ffffff" fontSize="18" fontWeight="700"
                    stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties?.text || ''}</text>
                </g>
              );
            }

            return null;
          })}
        </svg>
      )}

      {windVisible && <WindOverlay />}
      <DataFreshness />

      {/* Legends + loading indicators — stacked bottom-right */}
      {(windVisible || snowDepthVisible) && (
        <div className="absolute bottom-4 right-4 z-[6] flex flex-col gap-1.5">
          {(windLoading || snowDepthLoading) && (
            <div className="flex flex-col items-end gap-1">
              {windLoading && (
                <div className="text-xs text-cyan-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter vinddata...' : 'Loading wind data...'}
                </div>
              )}
              {snowDepthLoading && (
                <div className="text-xs text-blue-400 bg-slate-800/80 px-2 py-1 rounded">
                  {lang === 'no' ? 'Henter snødybdedata...' : 'Loading snow depth data...'}
                </div>
              )}
            </div>
          )}
          {windVisible && <WindLegend lang={lang} />}
          {snowDepthVisible && <SnowDepthLegend />}
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
      {placementMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-4 py-2 rounded shadow-lg z-10 flex items-center gap-3">
          <span>{activeProjectId ? t('symbols.clickMap', lang) : (lang === 'no' ? 'Velg et aktivt prosjekt først' : 'Select an active project first')}</span>
          <button
            onClick={() => setPlacementMode(null)}
            className="bg-emerald-800 hover:bg-emerald-700 px-2 py-1 rounded text-sm"
          >
            {t('symbols.cancel', lang)}
          </button>
        </div>
      )}
      {drawingInfoPopup && (
        <ItemInfoPopup
          projectId={drawingInfoPopup.projectId}
          layerId={drawingInfoPopup.layerId}
          x={drawingInfoPopup.x}
          y={drawingInfoPopup.y}
          onClose={() => setDrawingInfoPopup(null)}
        />
      )}
    </div>
  );
}
