import { useState, useEffect, useCallback, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

// Calculate 3D distance between two points (Haversine + elevation)
function calculateDistance3D(p1, p2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const horizontalDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const elevDiff = (p2.elevation || 0) - (p1.elevation || 0);
  return Math.sqrt(horizontalDist ** 2 + elevDiff ** 2);
}

// Format distance for display
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

// Fetch elevation from Kartverket API
async function fetchElevation(lat, lng) {
  try {
    const res = await fetch(`/api/tiles/elevation?lat=${lat}&lon=${lng}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.elevation || 0;
  } catch {
    return 0;
  }
}

export default function MeasuringTool() {
  const mapRef = useMapStore((s) => s.mapRef);
  const measuringToolVisible = useMapStore((s) => s.measuringToolVisible);
  const toggleMeasuringTool = useMapStore((s) => s.toggleMeasuringTool);
  const lang = useMapStore((s) => s.lang);

  const [routes, setRoutes] = useState([]); // Completed routes
  const [currentRoute, setCurrentRoute] = useState([]); // Active route waypoints
  const [mousePos, setMousePos] = useState(null); // Live cursor position
  const [, setTick] = useState(0); // Force re-render on map move
  const clickTimeoutRef = useRef(null);
  const lastClickRef = useRef(0);

  // Clear all routes when tool is deactivated
  useEffect(() => {
    if (!measuringToolVisible) {
      setRoutes([]);
      setCurrentRoute([]);
      setMousePos(null);
    }
  }, [measuringToolVisible]);

  // Handle map click to add waypoint
  const handleClick = useCallback(
    async (e) => {
      if (!measuringToolVisible) return;

      const now = Date.now();
      const isDoubleClick = now - lastClickRef.current < 300;
      lastClickRef.current = now;

      if (isDoubleClick) {
        // Double-click: finish current route
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
          clickTimeoutRef.current = null;
        }
        if (currentRoute.length >= 2) {
          const totalDistance = currentRoute.reduce((sum, pt, i) => {
            if (i === 0) return 0;
            return sum + calculateDistance3D(currentRoute[i - 1], pt);
          }, 0);
          setRoutes((prev) => [
            ...prev,
            { id: Date.now(), waypoints: currentRoute, totalDistance },
          ]);
          setCurrentRoute([]);
        }
        return;
      }

      // Single click: add waypoint (with small delay to detect double-click)
      clickTimeoutRef.current = setTimeout(async () => {
        const { lng, lat } = e.lngLat;
        const elevation = await fetchElevation(lat, lng);
        setCurrentRoute((prev) => [...prev, { lng, lat, elevation }]);
      }, 150);
    },
    [measuringToolVisible, currentRoute]
  );

  // Handle mouse move for preview line
  const handleMouseMove = useCallback(
    (e) => {
      if (!measuringToolVisible || currentRoute.length === 0) {
        setMousePos(null);
        return;
      }
      const { lng, lat } = e.lngLat;
      setMousePos({ lng, lat });
    },
    [measuringToolVisible, currentRoute.length]
  );

  // Handle Escape key to finish route
  useEffect(() => {
    if (!measuringToolVisible) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (currentRoute.length >= 2) {
          const totalDistance = currentRoute.reduce((sum, pt, i) => {
            if (i === 0) return 0;
            return sum + calculateDistance3D(currentRoute[i - 1], pt);
          }, 0);
          setRoutes((prev) => [
            ...prev,
            { id: Date.now(), waypoints: currentRoute, totalDistance },
          ]);
        }
        setCurrentRoute([]);
        setMousePos(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [measuringToolVisible, currentRoute]);

  // Attach map event listeners
  useEffect(() => {
    if (!mapRef || !measuringToolVisible) return;

    mapRef.on('click', handleClick);
    mapRef.on('mousemove', handleMouseMove);

    // Force re-render on map move to keep SVG in sync
    const onMove = () => setTick((n) => n + 1);
    mapRef.on('move', onMove);

    // Change cursor
    mapRef.getCanvas().style.cursor = 'crosshair';

    return () => {
      mapRef.off('click', handleClick);
      mapRef.off('mousemove', handleMouseMove);
      mapRef.off('move', onMove);
      mapRef.getCanvas().style.cursor = '';
    };
  }, [mapRef, measuringToolVisible, handleClick, handleMouseMove]);

  if (!measuringToolVisible || !mapRef) return null;

  // Project coordinates to screen
  const project = (coord) => {
    try {
      const p = mapRef.project([coord.lng, coord.lat]);
      return { x: p.x, y: p.y };
    } catch {
      return null;
    }
  };

  // Render SVG lines and labels for a route
  const renderRoute = (waypoints, isActive = false) => {
    if (waypoints.length === 0) return null;

    const points = waypoints.map(project).filter(Boolean);
    if (points.length === 0) return null;

    const segments = [];
    for (let i = 1; i < waypoints.length; i++) {
      const p1 = project(waypoints[i - 1]);
      const p2 = project(waypoints[i]);
      if (p1 && p2) {
        const dist = calculateDistance3D(waypoints[i - 1], waypoints[i]);
        segments.push({ p1, p2, dist });
      }
    }

    return (
      <>
        {/* Lines */}
        {segments.map((seg, i) => (
          <line
            key={`line-${i}`}
            x1={seg.p1.x}
            y1={seg.p1.y}
            x2={seg.p2.x}
            y2={seg.p2.y}
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}

        {/* Distance labels */}
        {segments.map((seg, i) => {
          const midX = (seg.p1.x + seg.p2.x) / 2;
          const midY = (seg.p1.y + seg.p2.y) / 2;
          return (
            <text
              key={`label-${i}`}
              x={midX}
              y={midY - 8}
              textAnchor="middle"
              fill="#000000"
              fontSize="13"
              fontWeight="600"
              stroke="#ffffff"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {formatDistance(seg.dist)}
            </text>
          );
        })}

        {/* Waypoint markers */}
        {points.map((p, i) => (
          <circle
            key={`point-${i}`}
            cx={p.x}
            cy={p.y}
            r="6"
            fill="#3b82f6"
            stroke="#ffffff"
            strokeWidth="2"
          />
        ))}

        {/* Preview line to cursor */}
        {isActive && mousePos && points.length > 0 && (() => {
          const lastPt = points[points.length - 1];
          const cursorPt = project(mousePos);
          if (!cursorPt) return null;
          return (
            <line
              x1={lastPt.x}
              y1={lastPt.y}
              x2={cursorPt.x}
              y2={cursorPt.y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          );
        })()}
      </>
    );
  };

  // Calculate total for current route
  const currentTotal = currentRoute.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    return sum + calculateDistance3D(currentRoute[i - 1], pt);
  }, 0);

  return (
    <>
      {/* SVG overlay for measuring lines */}
      <svg
        className="absolute inset-0 z-[5]"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* Completed routes */}
        {routes.map((route) => (
          <g key={route.id}>{renderRoute(route.waypoints)}</g>
        ))}

        {/* Active route */}
        <g>{renderRoute(currentRoute, true)}</g>
      </svg>

      {/* Total distance boxes */}
      {(routes.length > 0 || currentRoute.length >= 2) && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex flex-col gap-1">
          {routes.map((route, i) => (
            <div
              key={route.id}
              className="bg-slate-800/90 text-white px-3 py-1.5 rounded shadow-lg text-sm font-medium"
            >
              {t('measure.route', lang)} {i + 1}: {formatDistance(route.totalDistance)}
            </div>
          ))}
          {currentRoute.length >= 2 && (
            <div className="bg-blue-600/90 text-white px-3 py-1.5 rounded shadow-lg text-sm font-medium">
              {t('measure.route', lang)} {routes.length + 1}: {formatDistance(currentTotal)}
            </div>
          )}
        </div>
      )}

      {/* Hint text */}
      {currentRoute.length === 0 && routes.length === 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-slate-800/90 text-white px-4 py-2 rounded shadow-lg text-sm">
          {t('measure.clickToStart', lang)}
        </div>
      )}
      {currentRoute.length === 1 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-slate-800/90 text-white px-4 py-2 rounded shadow-lg text-sm">
          {t('measure.clickToContinue', lang)}
        </div>
      )}
    </>
  );
}
