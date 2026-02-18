import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import Map from 'react-map-gl/maplibre';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useWebcamStore } from '../../stores/useWebcamStore.js';
import { buildMapStyle } from '../../lib/map-styles.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../lib/constants.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';
import NatoMarkerLayer from './NatoMarkerLayer.jsx';
import WebcamLayer from './WebcamLayer.jsx';
import WindOverlay from './WindOverlay.jsx';
import ContextMenu from './ContextMenu.jsx';
import DraggablePopup from './DraggablePopup.jsx';
import DataFreshness from './DataFreshness.jsx';

let nextMenuId = 1;

export default function TacticalMap() {
  const mapRef = useRef(null);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const windVisible = useMapStore((s) => s.windVisible);
  const avalancheVisible = useMapStore((s) => s.avalancheVisible);
  const lang = useMapStore((s) => s.lang);
  const setMapRef = useMapStore((s) => s.setMapRef);
  const setBounds = useMapStore((s) => s.setBounds);
  const setViewport = useMapStore((s) => s.setViewport);
  const placementMode = useMapStore((s) => s.placementMode);
  const setPlacementMode = useMapStore((s) => s.setPlacementMode);
  const layers = useTacticalStore((s) => s.layers);
  const drawings = useTacticalStore((s) => s.drawings);

  const [contextMenus, setContextMenus] = useState([]);
  const [saveFlash, setSaveFlash] = useState(false);

  // Restore saved layout on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('coremap_layout'));
      if (saved?.contextMenus?.length) {
        const restored = saved.contextMenus.map(m => ({
          ...m,
          id: nextMenuId++,
          pinned: true,
        }));
        setContextMenus(restored);
      }
      if (saved?.openCameraIds?.length) {
        // Webcam restore happens after cameras are fetched — store the IDs
        window.__coremap_restore_cameras = saved.openCameraIds;
      }
    } catch {}
  }, []);

  const saveLayout = useCallback(() => {
    const pinnedMenus = contextMenus.filter(m => m.pinned).map(m => ({
      lng: m.lng,
      lat: m.lat,
      x: m.x,
      y: m.y,
    }));
    const openCameraIds = useWebcamStore.getState().openCameras.map(c => c.properties.id);
    localStorage.setItem('coremap_layout', JSON.stringify({
      contextMenus: pinnedMenus,
      openCameraIds,
      savedAt: new Date().toISOString(),
    }));
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  }, [contextMenus]);

  const mapStyle = useMemo(
    () => buildMapStyle(baseLayer, { avalancheVisible }),
    [baseLayer, avalancheVisible]
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
      // Set initial bounds for wind data etc.
      updateBounds();

      // Disable default right-click (context menu) on canvas
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
    // Close unpinned context menus on left click
    setContextMenus((prev) => prev.filter((m) => m.pinned));

    if (placementMode) {
      const { lng, lat } = evt.lngLat;
      socket.emit('client:marker:add', {
        sidc: placementMode.sidc,
        lat,
        lon: lng,
        designation: placementMode.designation || '',
        higherFormation: '',
        additionalInfo: '',
        layerId: placementMode.layerId || null,
        source: 'user',
        createdBy: socket.id,
      });
      setPlacementMode(null);
    }
  }, [placementMode, setPlacementMode]);

  // Right-click context menu
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleContextMenu = (e) => {
      e.preventDefault();
      const { lng, lat } = e.lngLat;
      const { x, y } = e.point;
      const id = nextMenuId++;
      setContextMenus((prev) => [...prev, { id, lng, lat, x, y, pinned: false }]);
    };

    map.on('contextmenu', handleContextMenu);
    return () => map.off('contextmenu', handleContextMenu);
  }, [useMapStore.getState().mapRef]);

  const closeMenu = useCallback((menuId) => {
    setContextMenus((prev) => prev.filter((m) => m.id !== menuId));
  }, []);

  const pinMenu = useCallback((menuId, pinned) => {
    setContextMenus((prev) => prev.map((m) => m.id === menuId ? { ...m, pinned } : m));
  }, []);

  // Force re-render on map move so SVG drawing overlay stays in sync
  const [, drawingTick] = useState(0);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onMove = () => drawingTick((n) => n + 1);
    map.on('move', onMove);
    return () => map.off('move', onMove);
  }, [useMapStore.getState().mapRef]);

  // Compute visible drawings and project to screen coordinates for SVG rendering
  const map = mapRef.current?.getMap();
  const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
  const visibleDrawings = drawings.filter(d => !d.layerId || visibleLayerIds.has(d.layerId));

  function projectCoord(coord) {
    if (!map) return null;
    try { const p = map.project(coord); return { x: p.x, y: p.y }; }
    catch { return null; }
  }

  function projectCoords(coords) {
    return coords.map(c => projectCoord(c)).filter(Boolean);
  }

  return (
    <div className="absolute inset-0">
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

      {/* SVG overlay for committed drawings */}
      {map && visibleDrawings.length > 0 && (
        <svg className="absolute inset-0 pointer-events-none z-[4]" style={{ width: '100%', height: '100%' }}>
          {visibleDrawings.map(d => {
            const color = d.properties?.color || '#3b82f6';
            const key = d.id;

            if (d.geometry.type === 'LineString') {
              const pts = projectCoords(d.geometry.coordinates);
              if (pts.length < 2) return null;
              return (
                <g key={key}>
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
                <g key={key}>
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
                <text key={key} x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central"
                  fill="#ffffff" fontSize="18" fontWeight="700"
                  stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties?.text || ''}</text>
              );
            }

            return null;
          })}
        </svg>
      )}

      {windVisible && <WindOverlay />}
      <DataFreshness />
      {contextMenus.map((menu) => (
        <DraggablePopup
          key={menu.id}
          originLng={menu.lng}
          originLat={menu.lat}
          originX={menu.x}
          originY={menu.y}
          onPin={() => pinMenu(menu.id, true)}
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
      {placementMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-4 py-2 rounded shadow-lg z-10 flex items-center gap-3">
          <span>{t('symbols.clickMap', lang)}</span>
          <button
            onClick={() => setPlacementMode(null)}
            className="bg-emerald-800 hover:bg-emerald-700 px-2 py-1 rounded text-sm"
          >
            {t('symbols.cancel', lang)}
          </button>
        </div>
      )}
      {/* Save layout button */}
      <button
        onClick={saveLayout}
        className={`absolute bottom-4 right-4 z-10 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold transition-all ${
          saveFlash
            ? 'bg-emerald-600 text-white scale-105'
            : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
        }`}
        title={lang === 'no' ? 'Lagre oppsett (ballonger og kameraer)' : 'Save layout (balloons and cameras)'}
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          {saveFlash
            ? (lang === 'no' ? 'Lagret!' : 'Saved!')
            : (lang === 'no' ? 'Lagre oppsett' : 'Save layout')
          }
        </div>
      </button>
    </div>
  );
}
