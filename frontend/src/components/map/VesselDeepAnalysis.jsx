import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import html2canvas from 'html2canvas-pro';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';
import ExportMenu from '../common/ExportMenu.jsx';

// Detect stops: periods of ~0 speed for 1+ hour after moving for 1+ hour
function detectStops(trackPoints) {
  const MIN_STOP_DURATION = 60;
  const MIN_MOVE_DURATION = 60;
  const STOP_SPEED_THRESHOLD = 0.5;
  const MOVE_SPEED_THRESHOLD = 1.0;

  const stops = [];
  let currentStop = null;
  let movingMinutes = 0;

  for (let i = 0; i < trackPoints.length; i++) {
    const pt = trackPoints[i];
    const prevPt = trackPoints[i - 1];
    const timeDelta = prevPt
      ? (new Date(pt.timestamp) - new Date(prevPt.timestamp)) / 60000
      : 0;

    if (pt.speed != null && pt.speed <= STOP_SPEED_THRESHOLD) {
      if (!currentStop && movingMinutes >= MIN_MOVE_DURATION) {
        currentStop = { startIndex: i, startTime: pt.timestamp, coordinates: pt.coordinates };
      }
      movingMinutes = 0;
    } else if (pt.speed != null && pt.speed > MOVE_SPEED_THRESHOLD) {
      if (currentStop) {
        const stopDuration = (new Date(pt.timestamp) - new Date(currentStop.startTime)) / 60000;
        if (stopDuration >= MIN_STOP_DURATION) {
          currentStop.endIndex = i - 1;
          currentStop.endTime = prevPt?.timestamp || pt.timestamp;
          currentStop.duration = stopDuration;
          stops.push(currentStop);
        }
        currentStop = null;
      }
      movingMinutes += timeDelta;
    }
  }

  if (currentStop) {
    const lastPt = trackPoints[trackPoints.length - 1];
    const stopDuration = (new Date(lastPt.timestamp) - new Date(currentStop.startTime)) / 60000;
    if (stopDuration >= MIN_STOP_DURATION) {
      currentStop.endIndex = trackPoints.length - 1;
      currentStop.endTime = lastPt.timestamp;
      currentStop.duration = stopDuration;
      stops.push(currentStop);
    }
  }

  return stops;
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleString('no-NO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSpeed(kts) {
  if (kts == null) return 'N/A';
  return `${kts.toFixed(1)} kn`;
}

function calculateStats(trackPoints) {
  if (!trackPoints || trackPoints.length === 0) return null;
  const speeds = trackPoints.filter(p => p.speed != null).map(p => p.speed);
  if (speeds.length === 0) return null;
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxSpeed = Math.max(...speeds);
  return {
    avgSpeed,
    maxSpeed,
    startTime: trackPoints[0].timestamp,
    endTime: trackPoints[trackPoints.length - 1].timestamp,
    durationMs: new Date(trackPoints[trackPoints.length - 1].timestamp) - new Date(trackPoints[0].timestamp),
  };
}

// Detect AIS gaps (>30 minutes between consecutive points)
const AIS_GAP_THRESHOLD = 30 * 60 * 1000; // 30 minutes in ms

function detectAisGaps(trackPoints) {
  const gaps = [];
  for (let i = 1; i < trackPoints.length; i++) {
    const prevTime = new Date(trackPoints[i - 1].timestamp).getTime();
    const currTime = new Date(trackPoints[i].timestamp).getTime();
    const delta = currTime - prevTime;
    if (delta > AIS_GAP_THRESHOLD) {
      gaps.push({
        startIndex: i - 1,
        endIndex: i,
        startTime: trackPoints[i - 1].timestamp,
        endTime: trackPoints[i].timestamp,
        duration: delta / 60000, // minutes
      });
    }
  }
  return gaps;
}

// Mini-map with both past (solid) and future (dotted) traces
const HistoricalMiniMap = forwardRef(function HistoricalMiniMap({ selectedPoint, trackPoints, selectedIndex, baseLayer, onOpenInMainMap, lang }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  // Expose map view state and force render for export
  useImperativeHandle(ref, () => ({
    getMapViewState: () => {
      const map = mapRef.current;
      if (!map) return null;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      return {
        center: [center.lng, center.lat],
        zoom,
        bounds: {
          west: bounds.getWest(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
          south: bounds.getSouth(),
        }
      };
    },
    getMapRect: () => {
      const el = containerRef.current?.querySelector('.maplibregl-canvas') || containerRef.current;
      return el?.getBoundingClientRect() || null;
    },
    forceRender: async () => {
      const map = mapRef.current;
      if (!map) return;
      // Force a synchronous render
      map.triggerRepaint();
      // Wait for render to complete
      await new Promise(resolve => {
        map.once('render', resolve);
        setTimeout(resolve, 500); // Fallback timeout
      });
    }
  }), []);

  useEffect(() => {
    if (!containerRef.current || !selectedPoint) return;

    // Use proxied tiles to avoid CORS issues for canvas export
    const darkStyle = {
      version: 8,
      sources: {
        'proxy-tiles': {
          type: 'raster',
          tiles: [
            '/api/tiles/carto-dark/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; CartoDB &copy; OpenStreetMap',
        },
      },
      layers: [
        {
          id: 'proxy-tiles-layer',
          type: 'raster',
          source: 'proxy-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkStyle,
      center: selectedPoint.coordinates,
      zoom: 11,
      interactive: true,
      attributionControl: false,
      preserveDrawingBuffer: true, // Required for canvas export
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Past trace (solid cyan→yellow gradient)
      const pastTrace = trackPoints.slice(0, selectedIndex + 1);
      if (pastTrace.length > 1) {
        map.addSource('past-trace', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: pastTrace.map(p => p.coordinates) },
          },
          lineMetrics: true,
        });
        map.addLayer({
          id: 'past-trace-line',
          type: 'line',
          source: 'past-trace',
          paint: {
            'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#06b6d4', 1, '#fbbf24'],
            'line-width': 3,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      // Future trace (dotted gray)
      const futureTrace = trackPoints.slice(selectedIndex);
      if (futureTrace.length > 1) {
        map.addSource('future-trace', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: futureTrace.map(p => p.coordinates) },
          },
        });
        map.addLayer({
          id: 'future-trace-line',
          type: 'line',
          source: 'future-trace',
          paint: {
            'line-color': '#94a3b8',
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      // Vessel marker at selected position
      const el = document.createElement('div');
      el.innerHTML = `<svg width="24" height="24" viewBox="0 0 48 48" style="transform: rotate(${selectedPoint.heading || selectedPoint.course || 0}deg)">
        <path d="M24 4 L19 16 L17 18 L17 38 L19 40 L29 40 L31 38 L31 18 L29 16 Z" fill="#fbbf24" stroke="#000" stroke-width="2"/>
      </svg>`;
      el.style.cursor = 'default';
      new maplibregl.Marker({ element: el }).setLngLat(selectedPoint.coordinates).addTo(map);
    });

    mapRef.current = map;
    return () => map.remove();
  }, [selectedPoint, trackPoints, selectedIndex, baseLayer]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-96 rounded-lg overflow-hidden border border-slate-600" />
      {/* Open in main map button */}
      <button
        onClick={onOpenInMainMap}
        className="absolute bottom-2 left-2 bg-slate-800/90 hover:bg-slate-700 text-white text-xs px-3 py-1.5 rounded shadow flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        {lang === 'no' ? 'Åpne i hovedkart' : 'Open in main map'}
      </button>
    </div>
  );
});

// Draggable wrapper for the analysis panel
function DraggableAnalysisPanel({ vesselCoords, children, mapRef: mainMapRef }) {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [isDragged, setIsDragged] = useState(false);
  const containerRef = useRef(null);
  const startRef = useRef({ mouseX: 0, mouseY: 0, dx: 0, dy: 0 });
  const dragRef = useRef(false);
  const [, forceUpdate] = useState(0);

  // Get map container offset
  function getMapOffset() {
    if (!mainMapRef) return { left: 0, top: 0 };
    try {
      const rect = mainMapRef.getContainer().getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    } catch { return { left: 0, top: 0 }; }
  }

  // Project vessel coords to screen
  function getOriginCanvas() {
    if (vesselCoords && mainMapRef) {
      try {
        const pt = mainMapRef.project(vesselCoords);
        return { x: pt.x, y: pt.y };
      } catch {}
    }
    return { x: window.innerWidth / 2, y: window.innerHeight - 200 };
  }

  const origin = getOriginCanvas();
  const mapOffset = getMapOffset();
  const canvasX = origin.x + offset.dx;
  const canvasY = origin.y + offset.dy;
  const posX = canvasX + mapOffset.left;
  const posY = canvasY + mapOffset.top;

  // Force re-render when map moves
  useEffect(() => {
    if (!mainMapRef) return;
    const onMove = () => forceUpdate((n) => n + 1);
    mainMapRef.on('move', onMove);
    return () => mainMapRef.off('move', onMove);
  }, [mainMapRef]);

  const onMouseDown = useCallback((e) => {
    if (!e.target.closest('.draggable-header')) return;
    if (e.target.closest('button')) return;
    if (e.target.closest('.select-text')) return; // Allow text selection
    e.preventDefault();
    e.stopPropagation();
    setIsDragged(true);
    startRef.current = { mouseX: e.clientX, mouseY: e.clientY, dx: offset.dx, dy: offset.dy };
    dragRef.current = true;

    const onMouseMove = (e) => {
      if (!dragRef.current) return;
      setOffset({
        dx: startRef.current.dx + (e.clientX - startRef.current.mouseX),
        dy: startRef.current.dy + (e.clientY - startRef.current.mouseY),
      });
    };
    const onMouseUp = () => {
      dragRef.current = false;
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
    };
    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
  }, [offset]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('pointerdown', onMouseDown);
    return () => el.removeEventListener('pointerdown', onMouseDown);
  }, [onMouseDown]);

  return (
    <>
      {/* Connection line to vessel */}
      {isDragged && vesselCoords && (
        <svg className="absolute inset-0 pointer-events-none z-[19]" style={{ width: '100%', height: '100%' }}>
          <line
            x1={origin.x} y1={origin.y}
            x2={canvasX + 300} y2={canvasY + 20}
            stroke="#000" strokeWidth="3" strokeDasharray="8 5" opacity="0.8"
          />
          <circle cx={origin.x} cy={origin.y} r="5" fill="#fbbf24" stroke="#000" strokeWidth="2" />
        </svg>
      )}
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          left: posX - 300,
          top: posY - 200,
          zIndex: 20,
        }}
      >
        {children}
      </div>
    </>
  );
}

// Main deep analysis component
export default function VesselDeepAnalysis({ vessel, traceData, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const mainMapRef = useMapStore((s) => s.mapRef);
  const setFocusedVessel = useMapStore((s) => s.setFocusedVessel);
  const setVesselTimeTravel = useMapStore((s) => s.setVesselTimeTravel);
  const clearVesselDeepAnalysis = useMapStore((s) => s.clearVesselDeepAnalysis);

  const [expanded, setExpanded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const miniMapRef = useRef(null);

  const user = useAuthStore((s) => s.user);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);

  const trackPoints = useMemo(() => {
    if (!traceData?.properties?.trackPoints) return [];
    return [...traceData.properties.trackPoints].reverse();
  }, [traceData]);

  const stats = useMemo(() => calculateStats(trackPoints), [trackPoints]);
  const stops = useMemo(() => detectStops(trackPoints), [trackPoints]);
  const aisGaps = useMemo(() => detectAisGaps(trackPoints), [trackPoints]);

  // Get current vessel position from trace (last point)
  const vesselCoords = useMemo(() => {
    if (trackPoints.length === 0) return null;
    return trackPoints[trackPoints.length - 1].coordinates;
  }, [trackPoints]);

  // Generate SVG for track visualization (used in export)
  // Uses the actual map bounds from user's pan/zoom
  const generateTrackSVG = (width, height, mapBounds) => {
    if (!trackPoints || trackPoints.length < 2 || selectedIndex == null) return null;

    const selPt = trackPoints[selectedIndex];

    // Use actual map bounds if available, otherwise calculate from center
    let west, east, north, south;
    if (mapBounds) {
      west = mapBounds.west;
      east = mapBounds.east;
      north = mapBounds.north;
      south = mapBounds.south;
    } else {
      // Fallback: calculate bounds from selected point at zoom 11
      const centerLng = selPt.coordinates[0];
      const centerLat = selPt.coordinates[1];
      const degPerPixel = 360 / (256 * Math.pow(2, 11));
      west = centerLng - (width / 2) * degPerPixel;
      east = centerLng + (width / 2) * degPerPixel;
      // Latitude is more complex due to Mercator, approximate
      const latRange = (height / 2) * degPerPixel * Math.cos(centerLat * Math.PI / 180);
      north = centerLat + latRange;
      south = centerLat - latRange;
    }

    // Mercator projection helpers
    const lngToX = (lng) => ((lng - west) / (east - west)) * width;
    const latToY = (lat) => {
      // Mercator Y projection
      const mercator = (l) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI / 180) / 2));
      const mercNorth = mercator(north);
      const mercSouth = mercator(south);
      const mercLat = mercator(lat);
      return height - ((mercLat - mercSouth) / (mercNorth - mercSouth)) * height;
    };

    // Project coordinates to SVG space
    const project = ([lng, lat]) => {
      const x = lngToX(lng);
      const y = latToY(lat);
      return [x, y];
    };

    // Build past trace path
    const pastPoints = trackPoints.slice(0, selectedIndex + 1);
    const pastPath = pastPoints.map((pt, i) => {
      const [x, y] = project(pt.coordinates);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    // Build future trace path
    const futurePoints = trackPoints.slice(selectedIndex);
    const futurePath = futurePoints.map((pt, i) => {
      const [x, y] = project(pt.coordinates);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    // Vessel position
    const [vx, vy] = project(selPt.coordinates);
    const rotation = selPt.heading || selPt.course || 0;

    // SVG with transparent background (overlays on static map image)
    // Use solid yellow for past trace (SVG gradients don't follow path like MapLibre's line-progress)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <path d="${pastPath}" fill="none" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${futurePath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="6,4" stroke-linecap="round"/>
      <g transform="translate(${vx},${vy}) rotate(${rotation})">
        <path d="M0,-12 L-5,0 L-4,2 L-4,14 L-3,16 L3,16 L4,14 L4,2 L5,0 Z" fill="#fbbf24" stroke="#000" stroke-width="1.5"/>
      </g>
    </svg>`;
  };

  // Calculate actual map bounds from center, zoom, and dimensions using Web Mercator projection
  // This ensures SVG projection matches the static map tiles exactly
  const calculateStaticMapBounds = (centerLng, centerLat, zoom, width, height) => {
    // Web Mercator: tile size is 256px, world is 256 * 2^zoom pixels
    const worldSize = 256 * Math.pow(2, zoom);

    // Longitude to X pixel
    const lngToX = (lng) => ((lng + 180) / 360) * worldSize;

    // Latitude to Y pixel (Web Mercator)
    const latToY = (lat) => {
      const latRad = lat * Math.PI / 180;
      const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
      return (worldSize / 2) * (1 - mercN / Math.PI);
    };

    // X pixel to longitude
    const xToLng = (x) => (x / worldSize) * 360 - 180;

    // Y pixel to latitude (Web Mercator inverse)
    const yToLat = (y) => {
      const mercN = Math.PI * (1 - 2 * y / worldSize);
      return Math.atan(Math.sinh(mercN)) * 180 / Math.PI;
    };

    // Center pixel coordinates
    const centerX = lngToX(centerLng);
    const centerY = latToY(centerLat);

    // Calculate corner pixels (Y increases downward in pixel coords)
    const westX = centerX - width / 2;
    const eastX = centerX + width / 2;
    const northY = centerY - height / 2;
    const southY = centerY + height / 2;

    // Convert back to geographic coordinates
    return {
      west: xToLng(westX),
      east: xToLng(eastX),
      north: yToLat(northY),
      south: yToLat(southY),
    };
  };

  // Export with map canvas compositing
  const handleSaveReport = async () => {
    if (!containerRef.current) return;
    setExporting(true);

    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const mapContainer = containerRef.current.querySelector('.maplibregl-map');
      const mapRect = mapContainer?.getBoundingClientRect();

      // Hide the map marker during capture (SVG overlay will provide the vessel)
      const markers = containerRef.current.querySelectorAll('.maplibregl-marker');
      markers.forEach(m => m.style.visibility = 'hidden');

      const h2cCanvas = await html2canvas(containerRef.current, {
        scale: 2,
        backgroundColor: '#0f172a',
        useCORS: true,
        allowTaint: true,
      });

      // Restore marker visibility
      markers.forEach(m => m.style.visibility = '');

      // Create a new canvas and copy html2canvas result
      const canvas = document.createElement('canvas');
      canvas.width = h2cCanvas.width;
      canvas.height = h2cCanvas.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(h2cCanvas, 0, 0);

      // Generate and composite SVG track visualization over the map area
      if (mapRect && selectedIndex != null) {
        const scale = 2;
        const offsetX = (mapRect.left - containerRect.left) * scale;
        const offsetY = (mapRect.top - containerRect.top) * scale;
        const svgWidth = Math.round(mapRect.width);
        const svgHeight = Math.round(mapRect.height);

        // Get the map view state for static map generation
        let mapViewState = null;
        if (miniMapRef.current?.getMapViewState) {
          mapViewState = miniMapRef.current.getMapViewState();
        }

        if (mapViewState) {
          const staticZoom = Math.round(mapViewState.zoom);

          // Fetch static map image from backend
          try {
            const staticMapUrl = `/api/tiles/static-map?lat=${mapViewState.center[1]}&lng=${mapViewState.center[0]}&zoom=${staticZoom}&width=${svgWidth}&height=${svgHeight}`;
            const mapResponse = await fetch(staticMapUrl);

            if (mapResponse.ok) {
              const mapBlob = await mapResponse.blob();
              const mapImageUrl = URL.createObjectURL(mapBlob);
              const mapImage = new Image();
              await new Promise((resolve, reject) => {
                mapImage.onload = resolve;
                mapImage.onerror = reject;
                mapImage.src = mapImageUrl;
              });
              ctx.drawImage(mapImage, offsetX, offsetY, svgWidth * scale, svgHeight * scale);
              URL.revokeObjectURL(mapImageUrl);
            }
          } catch (err) {
            console.error('Static map error:', err);
          }

          // Calculate actual bounds from static map parameters (fixes alignment bug)
          const actualBounds = calculateStaticMapBounds(
            mapViewState.center[0],
            mapViewState.center[1],
            staticZoom,
            svgWidth,
            svgHeight
          );

          const svgString = generateTrackSVG(svgWidth, svgHeight, actualBounds);

          if (svgString) {
            try {
              const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
              const svgImage = new Image();
              await new Promise((resolve, reject) => {
                svgImage.onload = resolve;
                svgImage.onerror = reject;
                svgImage.src = svgDataUrl;
              });

              // Draw the SVG track overlay on top of the map
              ctx.drawImage(svgImage, offsetX, offsetY, svgWidth * scale, svgHeight * scale);
            } catch (err) {
              console.error('SVG overlay error:', err);
            }
          }
        }
      }

      const link = document.createElement('a');
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      link.download = `vessel_analysis_${vessel?.mmsi || 'unknown'}_${localTime}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleWasosUpload = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const mapContainer = containerRef.current.querySelector('.maplibregl-map');
      const mapRect = mapContainer?.getBoundingClientRect();

      // Hide the map marker during capture
      const markers = containerRef.current.querySelectorAll('.maplibregl-marker');
      markers.forEach(m => m.style.visibility = 'hidden');

      const h2cCanvas = await html2canvas(containerRef.current, {
        scale: 2,
        backgroundColor: '#0f172a',
        useCORS: true,
        allowTaint: true,
      });

      // Restore marker visibility
      markers.forEach(m => m.style.visibility = '');

      const canvas = document.createElement('canvas');
      canvas.width = h2cCanvas.width;
      canvas.height = h2cCanvas.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(h2cCanvas, 0, 0);

      // Generate and composite SVG track visualization over the map area
      if (mapRect && selectedIndex != null) {
        const scale = 2;
        const offsetX = (mapRect.left - containerRect.left) * scale;
        const offsetY = (mapRect.top - containerRect.top) * scale;
        const svgWidth = Math.round(mapRect.width);
        const svgHeight = Math.round(mapRect.height);

        // Get map view state for proper bounds calculation
        let mapViewState = null;
        if (miniMapRef.current?.getMapViewState) {
          mapViewState = miniMapRef.current.getMapViewState();
        }

        // Calculate actual bounds from map view state
        let svgBounds = mapViewState?.bounds;
        if (mapViewState && !svgBounds) {
          svgBounds = calculateStaticMapBounds(
            mapViewState.center[0],
            mapViewState.center[1],
            Math.round(mapViewState.zoom),
            svgWidth,
            svgHeight
          );
        }

        const svgString = generateTrackSVG(svgWidth, svgHeight, svgBounds);
        if (svgString) {
          const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
          const svgImage = new Image();
          await new Promise((resolve, reject) => {
            svgImage.onload = resolve;
            svgImage.onerror = reject;
            svgImage.src = svgDataUrl;
          });
          ctx.drawImage(svgImage, offsetX, offsetY, svgWidth * scale, svgHeight * scale);
        }
      }

      const imageData = canvas.toDataURL('image/png');
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `vessel_analysis_${vessel?.mmsi || 'unknown'}_${localTime}.png`;
      const coords = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].coordinates : null;
      setExpanded(false);
      prepareWasosUpload(imageData, coords, filename);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  // Open in main map: focus vessel, enable time travel mode
  const handleOpenInMainMap = useCallback(() => {
    if (!selectedPoint || selectedIndex == null) return;

    // Set time travel state
    setVesselTimeTravel({
      mmsi: vessel?.mmsi,
      selectedIndex,
      trackPoints,
    });

    // Focus on the vessel
    setFocusedVessel(String(vessel?.mmsi));

    // Fly to the historical position
    if (mainMapRef && selectedPoint.coordinates) {
      mainMapRef.flyTo({
        center: selectedPoint.coordinates,
        zoom: 12,
        duration: 1500,
      });
    }

    // Close the analysis panel
    clearVesselDeepAnalysis();
  }, [selectedPoint, selectedIndex, vessel, trackPoints, setVesselTimeTravel, setFocusedVessel, mainMapRef, clearVesselDeepAnalysis]);

  if (!trackPoints || trackPoints.length < 2) {
    return (
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-slate-800/95 rounded-lg shadow-xl p-4 min-w-[300px] text-center">
        <div className="text-slate-400 text-sm">{t('vessel.noTrackData', lang)}</div>
        <button onClick={onClose} className="mt-2 text-slate-400 hover:text-white text-sm">
          {t('general.close', lang)}
        </button>
      </div>
    );
  }

  // Expanded dimensions increased by 35%
  const width = expanded ? 1485 : 580;
  const height = expanded ? 378 : 160;
  const padding = { top: expanded ? 30 : 15, right: expanded ? 40 : 15, bottom: expanded ? 55 : 28, left: expanded ? 70 : 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const startTime = new Date(trackPoints[0].timestamp).getTime();
  const endTime = new Date(trackPoints[trackPoints.length - 1].timestamp).getTime();
  const timeRange = endTime - startTime || 1;

  const speeds = trackPoints.filter(p => p.speed != null).map(p => p.speed);
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 10;
  const speedRange = maxSpeed * 1.15;

  // Helper to calculate X/Y position for a track point
  const getPointCoords = (p) => {
    const x = padding.left + ((new Date(p.timestamp).getTime() - startTime) / timeRange) * chartWidth;
    const y = p.speed != null ? padding.top + chartHeight - (p.speed / speedRange) * chartHeight : padding.top + chartHeight;
    return { x, y };
  };

  // Build gap indices set for quick lookup
  const gapStartIndices = new Set(aisGaps.map(g => g.startIndex));

  // Build solid path segments and gap connector paths
  const solidSegments = [];
  const gapPaths = [];
  let currentSegment = [];

  trackPoints.forEach((p, i) => {
    if (p.speed == null) return;

    const coords = getPointCoords(p);

    if (gapStartIndices.has(i)) {
      // End current segment before gap
      if (currentSegment.length > 0) {
        currentSegment.push(coords);
        solidSegments.push([...currentSegment]);
      }
      // Start gap connector from this point
      const nextPt = trackPoints[i + 1];
      if (nextPt && nextPt.speed != null) {
        const nextCoords = getPointCoords(nextPt);
        gapPaths.push({ from: coords, to: nextCoords });
      }
      currentSegment = [];
    } else if (i > 0 && gapStartIndices.has(i - 1)) {
      // Point after gap - start new segment
      currentSegment = [coords];
    } else {
      currentSegment.push(coords);
    }
  });

  // Add final segment
  if (currentSegment.length > 0) {
    solidSegments.push(currentSegment);
  }

  // Convert segments to SVG paths
  const solidPaths = solidSegments.map(segment =>
    segment.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  );

  // Legacy pathPoints for area fill (includes all points)
  const pathPoints = trackPoints
    .filter(p => p.speed != null)
    .map((p, i) => {
      const { x, y } = getPointCoords(p);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = pathPoints + ` L ${padding.left + chartWidth} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  const yLabelCount = expanded ? 6 : 4;
  const yLabels = Array.from({ length: yLabelCount }, (_, i) => (speedRange * i) / (yLabelCount - 1));

  const xLabelCount = expanded ? 8 : 5;
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => startTime + (timeRange * i) / (xLabelCount - 1));

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;

    if (x >= padding.left && x <= padding.left + chartWidth) {
      const fraction = (x - padding.left) / chartWidth;
      const targetTime = startTime + fraction * timeRange;
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < trackPoints.length; i++) {
        const diff = Math.abs(new Date(trackPoints[i].timestamp).getTime() - targetTime);
        if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
      }
      const pt = trackPoints[closestIdx];
      const lineX = padding.left + ((new Date(pt.timestamp).getTime() - startTime) / timeRange) * chartWidth;
      const speedY = pt.speed != null ? padding.top + chartHeight - (pt.speed / speedRange) * chartHeight : null;
      setHoverInfo({ point: pt, index: closestIdx, lineX, speedY });
    } else {
      setHoverInfo(null);
    }
  };

  // Resolve chart X position to nearest track point
  const resolvePointFromX = (clientX) => {
    if (!svgRef.current || trackPoints.length === 0) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const x = (clientX - rect.left) * scaleX;
    if (x < padding.left || x > padding.left + chartWidth) return null;
    const fraction = (x - padding.left) / chartWidth;
    const targetTime = startTime + fraction * timeRange;
    let closestIdx = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < trackPoints.length; i++) {
      const diff = Math.abs(new Date(trackPoints[i].timestamp).getTime() - targetTime);
      if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
    }
    return { point: trackPoints[closestIdx], index: closestIdx };
  };

  const handleChartClick = (e) => {
    // Compute directly from click/tap X position — works for both mouse and touch
    const resolved = resolvePointFromX(e.clientX);
    if (resolved) {
      setSelectedPoint(resolved.point);
      setSelectedIndex(resolved.index);
      if (!expanded) {
        setExpanded(true);
      }
    }
  };

  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) setExpanded(false); };

  const fontSize = expanded ? 13 : 10;
  const containerClass = expanded ? "bg-slate-900 rounded-lg shadow-2xl p-6" : "bg-slate-800/95 rounded-lg shadow-xl p-3 min-w-[600px]";

  const content = (
    <div className={containerClass} ref={containerRef} style={expanded ? { width: '92vw', maxWidth: '1620px', maxHeight: '95vh', overflow: 'auto' } : undefined}>
      {/* Header - draggable */}
      <div className={`draggable-header flex justify-between items-start ${expanded ? 'mb-3' : 'mb-2'} cursor-grab`}>
        <div className="cursor-text select-text">
          <div className={`text-white font-semibold ${expanded ? 'text-xl' : 'text-base'}`}>
            {lang === 'no' ? 'Historisk AIS-analyse' : 'Historic AIS Analysis'}: {vessel?.name || `MMSI ${vessel?.mmsi}`}
            {vessel?.countryCode && <span className="ml-2 text-slate-400 text-sm font-normal">{vessel.countryCode}</span>}
          </div>
          <div className="text-slate-400 text-xs">
            MMSI: <a href={`https://www.vesselfinder.com/vessels/details/${vessel?.mmsi}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer">{vessel?.mmsi}</a>
            {vessel?.imoNumber && <span> | IMO: {vessel.imoNumber}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded && user?.wasosEnabled ? (
            <ExportMenu
              onSaveToDisk={handleSaveReport}
              onTransferToWasos={handleWasosUpload}
              wasosLoggedIn={wasosLoggedIn}
              buttonIcon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
              buttonClassName="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
              disabled={exporting}
            />
          ) : expanded && (
            <button onClick={handleSaveReport} disabled={exporting} className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors" title={t('measure.export', lang)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors" title={expanded ? t('measure.shrink', lang) : t('measure.expand', lang)}>
            {expanded ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
            )}
          </button>
          <button onClick={onClose} className={`text-slate-400 hover:text-white leading-none px-1 ${expanded ? 'text-2xl' : 'text-lg'}`}>&times;</button>
        </div>
      </div>

      {/* Stats row */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mb-3 text-sm' : 'mb-2 text-xs'} flex-wrap`}>
        <span><span className="text-slate-500">{t('vessel.trackPeriod', lang)}:</span> {stats ? formatTime(stats.startTime) : '—'} &mdash; {stats ? formatTime(stats.endTime) : '—'}</span>
        <span className="text-cyan-400">{t('vessel.avgSpeed', lang)}: {stats ? formatSpeed(stats.avgSpeed) : '—'}</span>
        <span className="text-green-400">{t('vessel.maxSpeed', lang)}: {stats ? formatSpeed(stats.maxSpeed) : '—'}</span>
        <span className="text-red-400">{t('vessel.stopCount', lang)}: {stops.length}</span>
        {aisGaps.length > 0 && <span className="text-amber-400">{t('vessel.aisGaps', lang)}: {aisGaps.length}</span>}
      </div>

      {/* Speed-Time Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`rounded ${expanded ? 'bg-slate-800 w-full' : 'bg-slate-900/50 w-full'}`}
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: expanded ? '400px' : '160px', cursor: 'crosshair' }}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={handleMouseMove}
        onPointerLeave={() => setHoverInfo(null)}
        onClick={handleChartClick}
      >
        {/* Grid lines - horizontal */}
        {yLabels.map((speed, i) => {
          const y = padding.top + chartHeight - (speed / speedRange) * chartHeight;
          return (
            <g key={`y-${i}`}>
              <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y} stroke="#374151" strokeWidth="1" />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" fill="#9ca3af" fontSize={fontSize}>{speed.toFixed(0)}</text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((time, i) => {
          const x = padding.left + (i / (xLabelCount - 1)) * chartWidth;
          const label = new Date(time).toLocaleString('no-NO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return (
            <g key={`x-${i}`}>
              <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartHeight} stroke="#374151" strokeWidth="1" />
              <text x={x} y={height - (expanded ? 8 : 5)} textAnchor="middle" fill="#9ca3af" fontSize={expanded ? 11 : 8}>{label}</text>
            </g>
          );
        })}

        {/* Stop periods */}
        {stops.map((stop, i) => {
          const startX = padding.left + ((new Date(stop.startTime).getTime() - startTime) / timeRange) * chartWidth;
          const endX = padding.left + ((new Date(stop.endTime).getTime() - startTime) / timeRange) * chartWidth;
          return (
            <g key={`stop-${i}`}>
              <rect x={startX} y={padding.top} width={Math.max(endX - startX, 4)} height={chartHeight} fill="#ef4444" fillOpacity="0.2" />
              <line x1={startX} y1={padding.top} x2={startX} y2={padding.top + chartHeight} stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" />
              <circle cx={(startX + endX) / 2} cy={padding.top + 10} r={expanded ? 8 : 6} fill="#ef4444" />
              <text x={(startX + endX) / 2} y={padding.top + (expanded ? 14 : 12)} textAnchor="middle" fill="#fff" fontSize={expanded ? 10 : 7} fontWeight="bold">S</text>
            </g>
          );
        })}

        <defs>
          <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0e7490" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {pathPoints && <path d={areaPath} fill="url(#speedGradient)" />}

        {/* Solid speed line segments */}
        {solidPaths.map((d, i) => (
          <path key={`solid-${i}`} d={d} fill="none" stroke="#06b6d4" strokeWidth={expanded ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* AIS gap connectors (dotted lines) */}
        {gapPaths.map((gap, i) => (
          <line
            key={`gap-${i}`}
            x1={gap.from.x}
            y1={gap.from.y}
            x2={gap.to.x}
            y2={gap.to.y}
            stroke="#f59e0b"
            strokeWidth={expanded ? 2 : 1.5}
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
        ))}

        {/* AIS gap markers */}
        {aisGaps.map((gap, i) => {
          const startX = padding.left + ((new Date(gap.startTime).getTime() - startTime) / timeRange) * chartWidth;
          const endX = padding.left + ((new Date(gap.endTime).getTime() - startTime) / timeRange) * chartWidth;
          const midX = (startX + endX) / 2;
          return (
            <g key={`gap-marker-${i}`}>
              <rect x={startX} y={padding.top} width={Math.max(endX - startX, 4)} height={chartHeight} fill="#f59e0b" fillOpacity="0.1" />
              <circle cx={midX} cy={padding.top + (expanded ? 24 : 18)} r={expanded ? 8 : 6} fill="#f59e0b" />
              <text x={midX} y={padding.top + (expanded ? 28 : 21)} textAnchor="middle" fill="#000" fontSize={expanded ? 9 : 7} fontWeight="bold">?</text>
            </g>
          );
        })}

        {/* Scrubber */}
        {hoverInfo && (
          <>
            <line x1={hoverInfo.lineX} y1={padding.top} x2={hoverInfo.lineX} y2={padding.top + chartHeight} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3 2" />
            {hoverInfo.speedY != null && <circle cx={hoverInfo.lineX} cy={hoverInfo.speedY} r={expanded ? 5 : 4} fill="#fbbf24" stroke="#fff" strokeWidth={1.5} />}
          </>
        )}

        {/* Selected point */}
        {selectedPoint && selectedIndex != null && (() => {
          const x = padding.left + ((new Date(selectedPoint.timestamp).getTime() - startTime) / timeRange) * chartWidth;
          const y = selectedPoint.speed != null ? padding.top + chartHeight - (selectedPoint.speed / speedRange) * chartHeight : padding.top + chartHeight;
          return <circle cx={x} cy={y} r={expanded ? 7 : 5} fill="#22c55e" stroke="#fff" strokeWidth={2} />;
        })()}

        {/* Axis labels */}
        <text x={padding.left + chartWidth / 2} y={height - 1} textAnchor="middle" fill="#64748b" fontSize={expanded ? 11 : 9}>{lang === 'no' ? 'Tid' : 'Time'}</text>
        <text x={expanded ? 14 : 8} y={padding.top + chartHeight / 2} textAnchor="middle" fill="#64748b" fontSize={expanded ? 11 : 9} transform={`rotate(-90, ${expanded ? 14 : 8}, ${padding.top + chartHeight / 2})`}>{lang === 'no' ? 'Hastighet (kn)' : 'Speed (kn)'}</text>
      </svg>

      {/* Scrubber info */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mt-3 text-sm' : 'mt-2 text-xs'} bg-slate-700/50 rounded px-3 py-1.5`}>
        <span>{lang === 'no' ? 'Tid' : 'Time'}: <strong className="text-white">{hoverInfo ? formatTime(hoverInfo.point.timestamp) : '—'}</strong></span>
        <span>{lang === 'no' ? 'Hastighet' : 'Speed'}: <strong className="text-cyan-400">{hoverInfo?.point.speed != null ? formatSpeed(hoverInfo.point.speed) : '—'}</strong></span>
        <span>{lang === 'no' ? 'Kurs' : 'Course'}: <strong className="text-white">{hoverInfo?.point.course != null ? `${hoverInfo.point.course.toFixed(0)}\u00b0` : '—'}</strong></span>
        <span className="text-slate-500 ml-auto">{t('vessel.clickToSeePosition', lang)}</span>
      </div>

      {/* Mini-map (expanded mode) */}
      {selectedPoint && expanded && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="text-slate-400">
              {t('vessel.historicalPosition', lang)}: {formatTime(selectedPoint.timestamp)}
              {selectedPoint.speed != null && ` | ${formatSpeed(selectedPoint.speed)}`}
            </div>
            {/* Trace legend */}
            <div className="flex items-center gap-4 text-slate-400">
              <div className="flex items-center gap-1.5">
                <svg width="32" height="4" className="flex-shrink-0">
                  <line x1="0" y1="2" x2="32" y2="2" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                <span>{lang === 'no' ? 'Fortid' : 'Past'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="32" height="4" className="flex-shrink-0">
                  <line x1="0" y1="2" x2="32" y2="2" stroke="#64748b" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round"/>
                </svg>
                <span>{lang === 'no' ? 'Fremtid' : 'Future'}</span>
              </div>
            </div>
          </div>
          <HistoricalMiniMap
            ref={miniMapRef}
            selectedPoint={selectedPoint}
            trackPoints={trackPoints}
            selectedIndex={selectedIndex}
            baseLayer={baseLayer}
            onOpenInMainMap={handleOpenInMainMap}
            lang={lang}
          />
        </div>
      )}

    </div>
  );

  // Expanded mode uses portal
  if (expanded) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center" onClick={handleBackdropClick}>
        {content}
      </div>,
      document.body
    );
  }

  // Non-expanded mode uses draggable wrapper
  return (
    <DraggableAnalysisPanel vesselCoords={vesselCoords} mapRef={mainMapRef}>
      {content}
    </DraggableAnalysisPanel>
  );
}
