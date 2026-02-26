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

// Calculate 2D horizontal distance only
function calculateDistance2D(p1, p2) {
  const R = 6371000;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Format distance for display
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

// Format elevation
function formatElevation(meters) {
  return `${Math.round(meters)} m`;
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

// Interpolate points along a path at regular intervals
function interpolatePoints(waypoints, intervalMeters = 25) {
  const points = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < waypoints.length; i++) {
    if (i === 0) {
      points.push({ ...waypoints[0], cumulativeDistance: 0, isWaypoint: true, waypointIndex: 0 });
      continue;
    }

    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const segmentDist = calculateDistance2D(prev, curr);

    // Calculate how many intermediate points we need
    const numIntermediate = Math.floor(segmentDist / intervalMeters);

    for (let j = 1; j <= numIntermediate; j++) {
      const fraction = j / (numIntermediate + 1);
      const lng = prev.lng + (curr.lng - prev.lng) * fraction;
      const lat = prev.lat + (curr.lat - prev.lat) * fraction;
      const distAlongSegment = segmentDist * fraction;

      points.push({
        lng,
        lat,
        elevation: null, // Will be fetched
        cumulativeDistance: cumulativeDistance + distAlongSegment,
        isWaypoint: false,
      });
    }

    cumulativeDistance += segmentDist;
    points.push({
      ...curr,
      cumulativeDistance,
      isWaypoint: true,
      waypointIndex: i,
    });
  }

  return points;
}

// Fetch elevations for multiple points in parallel batches
async function fetchElevationsForPoints(points, batchSize = 10) {
  const results = [...points];

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const elevations = await Promise.all(
      batch.map(p => p.elevation !== null ? Promise.resolve(p.elevation) : fetchElevation(p.lat, p.lng))
    );

    for (let j = 0; j < batch.length; j++) {
      results[i + j] = { ...results[i + j], elevation: elevations[j] };
    }
  }

  return results;
}

// Calculate detailed route statistics from profile points
function getDetailedStats(profilePoints) {
  if (profilePoints.length === 0) return null;

  let totalAscent = 0;
  let totalDescent = 0;
  let minElevation = profilePoints[0].elevation;
  let maxElevation = profilePoints[0].elevation;
  let minIndex = 0;
  let maxIndex = 0;

  for (let i = 1; i < profilePoints.length; i++) {
    const elevDiff = profilePoints[i].elevation - profilePoints[i - 1].elevation;
    if (elevDiff > 0) totalAscent += elevDiff;
    else totalDescent += Math.abs(elevDiff);

    if (profilePoints[i].elevation < minElevation) {
      minElevation = profilePoints[i].elevation;
      minIndex = i;
    }
    if (profilePoints[i].elevation > maxElevation) {
      maxElevation = profilePoints[i].elevation;
      maxIndex = i;
    }
  }

  const totalDistance = profilePoints[profilePoints.length - 1].cumulativeDistance;

  return {
    totalDistance,
    totalAscent,
    totalDescent,
    minElevation,
    maxElevation,
    minIndex,
    maxIndex,
    profilePoints,
  };
}

// Calculate basic stats from waypoints only (for display during drawing)
function getBasicStats(waypoints) {
  if (waypoints.length === 0) return null;

  let totalDistance = 0;
  let totalAscent = 0;
  let totalDescent = 0;

  for (let i = 1; i < waypoints.length; i++) {
    totalDistance += calculateDistance2D(waypoints[i - 1], waypoints[i]);
    const elevDiff = waypoints[i].elevation - waypoints[i - 1].elevation;
    if (elevDiff > 0) totalAscent += elevDiff;
    else totalDescent += Math.abs(elevDiff);
  }

  return { totalDistance, totalAscent, totalDescent };
}

// Height profile component with detailed terrain
function HeightProfile({ profilePoints, waypointIndices, routeIndex, lang, onClose, loading }) {
  if (!profilePoints || profilePoints.length < 2) return null;

  const stats = getDetailedStats(profilePoints);
  if (!stats) return null;

  const { minElevation, maxElevation, totalDistance, totalAscent, totalDescent, minIndex, maxIndex } = stats;

  // SVG dimensions - wider for more detail
  const width = 500;
  const height = 180;
  const padding = { top: 15, right: 15, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale with some padding
  const elevRange = maxElevation - minElevation || 1;
  const elevPadding = elevRange * 0.15;
  const minY = minElevation - elevPadding;
  const maxY = maxElevation + elevPadding;

  // Create smooth path
  const pathPoints = profilePoints.map((p, i) => {
    const x = padding.left + (p.cumulativeDistance / totalDistance) * chartWidth;
    const y = padding.top + chartHeight - ((p.elevation - minY) / (maxY - minY)) * chartHeight;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  // Create filled area path
  const areaPath = pathPoints +
    ` L ${padding.left + chartWidth} ${padding.top + chartHeight}` +
    ` L ${padding.left} ${padding.top + chartHeight} Z`;

  // Y-axis labels (5 levels)
  const yLabelCount = 5;
  const yLabels = [];
  for (let i = 0; i < yLabelCount; i++) {
    const elev = minElevation + (elevRange * i) / (yLabelCount - 1);
    yLabels.push(Math.round(elev));
  }

  // X-axis labels
  const xLabelCount = 5;
  const xLabels = [];
  for (let i = 0; i < xLabelCount; i++) {
    xLabels.push((totalDistance * i) / (xLabelCount - 1));
  }

  // Find waypoint positions for markers
  const waypointMarkers = profilePoints
    .map((p, i) => (p.isWaypoint ? { ...p, index: i } : null))
    .filter(Boolean);

  return (
    <div className="bg-slate-800/95 rounded-lg shadow-xl p-3 min-w-[520px]">
      <div className="flex justify-between items-center mb-2">
        <span className="text-white text-sm font-medium">
          {t('measure.route', lang)} {routeIndex + 1} - {t('measure.profile', lang)}
          {loading && <span className="ml-2 text-yellow-400 text-xs">(loading terrain...)</span>}
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 text-xs text-slate-300 mb-2 flex-wrap">
        <span className="text-green-400">↑ {formatElevation(totalAscent)}</span>
        <span className="text-red-400">↓ {formatElevation(totalDescent)}</span>
        <span className="text-emerald-400">{t('measure.highest', lang)}: {formatElevation(maxElevation)}</span>
        <span className="text-blue-400">{t('measure.lowest', lang)}: {formatElevation(minElevation)}</span>
        <span className="text-slate-400">{profilePoints.length} {t('measure.points', lang)}</span>
      </div>

      {/* SVG Chart */}
      <svg width={width} height={height} className="bg-slate-900/50 rounded">
        {/* Grid lines - horizontal */}
        {yLabels.map((label, i) => {
          const y = padding.top + chartHeight - ((label - minY) / (maxY - minY)) * chartHeight;
          return (
            <g key={`y-${i}`}>
              <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y}
                stroke="#374151" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end"
                fill="#9ca3af" fontSize="10">{label}</text>
            </g>
          );
        })}

        {/* Grid lines - vertical */}
        {xLabels.map((dist, i) => {
          const x = padding.left + (dist / totalDistance) * chartWidth;
          return (
            <line key={`vgrid-${i}`} x1={x} y1={padding.top} x2={x} y2={padding.top + chartHeight}
              stroke="#374151" strokeWidth="1" />
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((dist, i) => {
          const x = padding.left + (dist / totalDistance) * chartWidth;
          return (
            <text key={`x-${i}`} x={x} y={height - 8} textAnchor="middle"
              fill="#9ca3af" fontSize="10">{formatDistance(dist)}</text>
          );
        })}

        {/* Gradient definition */}
        <defs>
          <linearGradient id={`elevGradient-${routeIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Filled area */}
        <path d={areaPath} fill={`url(#elevGradient-${routeIndex})`} />

        {/* Main terrain line */}
        <path d={pathPoints} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />

        {/* Min/Max markers */}
        {(() => {
          const minPt = profilePoints[minIndex];
          const maxPt = profilePoints[maxIndex];
          const minX = padding.left + (minPt.cumulativeDistance / totalDistance) * chartWidth;
          const minYPos = padding.top + chartHeight - ((minPt.elevation - minY) / (maxY - minY)) * chartHeight;
          const maxX = padding.left + (maxPt.cumulativeDistance / totalDistance) * chartWidth;
          const maxYPos = padding.top + chartHeight - ((maxPt.elevation - minY) / (maxY - minY)) * chartHeight;
          return (
            <>
              {/* Lowest point */}
              <circle cx={minX} cy={minYPos} r="5" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
              <text x={minX} y={minYPos - 8} textAnchor="middle" fill="#60a5fa" fontSize="9" fontWeight="bold">
                {formatElevation(minPt.elevation)}
              </text>
              {/* Highest point */}
              <circle cx={maxX} cy={maxYPos} r="5" fill="#22c55e" stroke="#fff" strokeWidth="2" />
              <text x={maxX} y={maxYPos - 8} textAnchor="middle" fill="#22c55e" fontSize="9" fontWeight="bold">
                {formatElevation(maxPt.elevation)}
              </text>
            </>
          );
        })()}

        {/* Waypoint markers */}
        {waypointMarkers.map((wp, i) => {
          const x = padding.left + (wp.cumulativeDistance / totalDistance) * chartWidth;
          const y = padding.top + chartHeight - ((wp.elevation - minY) / (maxY - minY)) * chartHeight;
          // Don't render if too close to min/max markers
          if (wp.index === minIndex || wp.index === maxIndex) return null;
          return (
            <g key={`wp-${i}`}>
              <circle cx={x} cy={y} r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
              <text x={x} y={y + 3} textAnchor="middle" fill="#fff" fontSize="7" fontWeight="bold">
                {wp.waypointIndex + 1}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={padding.left + chartWidth / 2} y={height - 1} textAnchor="middle"
          fill="#64748b" fontSize="9">{t('measure.distance', lang)}</text>
        <text x={10} y={padding.top + chartHeight / 2} textAnchor="middle"
          fill="#64748b" fontSize="9" transform={`rotate(-90, 10, ${padding.top + chartHeight / 2})`}>
          {t('measure.elevation', lang)} (m)
        </text>
      </svg>
    </div>
  );
}

export default function MeasuringTool() {
  const mapRef = useMapStore((s) => s.mapRef);
  const measuringToolVisible = useMapStore((s) => s.measuringToolVisible);
  const lang = useMapStore((s) => s.lang);

  const [routes, setRoutes] = useState([]); // Completed routes with detailed profiles
  const [currentRoute, setCurrentRoute] = useState([]); // Active route waypoints
  const [mousePos, setMousePos] = useState(null); // Live cursor position
  const [, setTick] = useState(0); // Force re-render on map move
  const [expandedProfile, setExpandedProfile] = useState(null); // Which route's profile is expanded
  const [loadingProfile, setLoadingProfile] = useState(null); // Which route is loading detailed profile
  const clickTimeoutRef = useRef(null);
  const lastClickRef = useRef(0);

  // Clear all routes when tool is deactivated
  useEffect(() => {
    if (!measuringToolVisible) {
      setRoutes([]);
      setCurrentRoute([]);
      setMousePos(null);
      setExpandedProfile(null);
      setLoadingProfile(null);
    }
  }, [measuringToolVisible]);

  // Finalize route with detailed elevation profile
  const finalizeRoute = useCallback(async (waypoints) => {
    if (waypoints.length < 2) return;

    const routeId = Date.now();
    const basicStats = getBasicStats(waypoints);

    // Add route immediately with basic stats
    setRoutes((prev) => [
      ...prev,
      {
        id: routeId,
        waypoints,
        stats: basicStats,
        profilePoints: null,
        loading: true,
      },
    ]);
    setLoadingProfile(routeId);

    try {
      // Interpolate points along the route (every 25m for detail)
      const interpolated = interpolatePoints(waypoints, 25);
      console.log('[Measure] Interpolated points:', interpolated.length);

      // Fetch all elevations
      const profileWithElevations = await fetchElevationsForPoints(interpolated, 8);
      console.log('[Measure] Fetched elevations:', profileWithElevations.length);

      // Calculate detailed stats
      const detailedStats = getDetailedStats(profileWithElevations);
      console.log('[Measure] Detailed stats:', detailedStats);

      // Update route with detailed profile
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === routeId
            ? {
                ...r,
                stats: detailedStats,
                profilePoints: profileWithElevations,
                loading: false,
              }
            : r
        )
      );
    } catch (err) {
      console.error('[Measure] Error fetching terrain:', err);
      // Still mark as not loading, use waypoints as fallback profile
      const fallbackProfile = waypoints.map((wp, i) => ({
        ...wp,
        cumulativeDistance: i === 0 ? 0 : waypoints.slice(0, i + 1).reduce((sum, w, j) =>
          j === 0 ? 0 : sum + calculateDistance2D(waypoints[j - 1], waypoints[j]), 0),
        isWaypoint: true,
        waypointIndex: i,
      }));
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === routeId
            ? {
                ...r,
                profilePoints: fallbackProfile,
                loading: false,
              }
            : r
        )
      );
    }
    setLoadingProfile(null);
  }, []);

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
          finalizeRoute(currentRoute);
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
    [measuringToolVisible, currentRoute, finalizeRoute]
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
          finalizeRoute(currentRoute);
        }
        setCurrentRoute([]);
        setMousePos(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [measuringToolVisible, currentRoute, finalizeRoute]);

  // Attach map event listeners
  useEffect(() => {
    if (!mapRef || !measuringToolVisible) return;

    mapRef.on('click', handleClick);
    mapRef.on('mousemove', handleMouseMove);

    // Force re-render on map move to keep SVG in sync
    const onMove = () => setTick((n) => n + 1);
    mapRef.on('move', onMove);

    // Disable double-click zoom when measuring
    mapRef.doubleClickZoom.disable();

    // Change cursor
    mapRef.getCanvas().style.cursor = 'crosshair';

    return () => {
      mapRef.off('click', handleClick);
      mapRef.off('mousemove', handleMouseMove);
      mapRef.off('move', onMove);
      mapRef.doubleClickZoom.enable();
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

    const points = waypoints.map((wp) => ({ ...project(wp), elevation: wp.elevation })).filter(p => p.x !== undefined);
    if (points.length === 0) return null;

    const segments = [];
    for (let i = 1; i < waypoints.length; i++) {
      const p1 = project(waypoints[i - 1]);
      const p2 = project(waypoints[i]);
      if (p1 && p2) {
        const dist = calculateDistance3D(waypoints[i - 1], waypoints[i]);
        const elevDiff = waypoints[i].elevation - waypoints[i - 1].elevation;
        segments.push({ p1, p2, dist, elevDiff });
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

        {/* Distance labels with elevation diff */}
        {segments.map((seg, i) => {
          const midX = (seg.p1.x + seg.p2.x) / 2;
          const midY = (seg.p1.y + seg.p2.y) / 2;
          const elevSign = seg.elevDiff >= 0 ? '+' : '';
          return (
            <g key={`label-${i}`}>
              <text
                x={midX}
                y={midY - 12}
                textAnchor="middle"
                fill="#000000"
                fontSize="12"
                fontWeight="600"
                stroke="#ffffff"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {formatDistance(seg.dist)}
              </text>
              <text
                x={midX}
                y={midY + 2}
                textAnchor="middle"
                fill={seg.elevDiff >= 0 ? '#22c55e' : '#ef4444'}
                fontSize="10"
                fontWeight="500"
                stroke="#ffffff"
                strokeWidth="2"
                paintOrder="stroke"
              >
                {elevSign}{Math.round(seg.elevDiff)} m
              </text>
            </g>
          );
        })}

        {/* Waypoint markers with elevation */}
        {points.map((p, i) => (
          <g key={`point-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r="8"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="2"
            />
            <text
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="8"
              fontWeight="bold"
            >
              {i + 1}
            </text>
            {/* Elevation label below marker */}
            <text
              x={p.x}
              y={p.y + 22}
              textAnchor="middle"
              fill="#000000"
              fontSize="10"
              fontWeight="500"
              stroke="#ffffff"
              strokeWidth="2"
              paintOrder="stroke"
            >
              {formatElevation(p.elevation)}
            </text>
          </g>
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

  // Calculate stats for current route
  const currentStats = getBasicStats(currentRoute);

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

      {/* Route info boxes */}
      {(routes.length > 0 || currentRoute.length >= 2) && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex flex-col gap-1 items-center">
          {routes.map((route, i) => (
            <div key={route.id} className="flex flex-col items-center gap-1">
              <button
                onClick={() => setExpandedProfile(expandedProfile === i ? null : i)}
                className="bg-slate-800/90 text-white px-3 py-1.5 rounded shadow-lg text-sm font-medium hover:bg-slate-700/90 transition-colors flex items-center gap-2"
              >
                <span>{t('measure.route', lang)} {i + 1}: {formatDistance(route.stats?.totalDistance || 0)}</span>
                <span className="text-green-400 text-xs">↑{formatElevation(route.stats?.totalAscent || 0)}</span>
                <span className="text-red-400 text-xs">↓{formatElevation(route.stats?.totalDescent || 0)}</span>
                {route.loading && <span className="text-yellow-400 text-xs animate-pulse">...</span>}
                <span className="text-slate-400 text-xs ml-1">{expandedProfile === i ? '▲' : '▼'}</span>
              </button>
              {expandedProfile === i && (
                route.profilePoints ? (
                  <HeightProfile
                    profilePoints={route.profilePoints}
                    waypointIndices={route.waypoints.map((_, idx) => idx)}
                    routeIndex={i}
                    lang={lang}
                    onClose={() => setExpandedProfile(null)}
                    loading={route.loading}
                  />
                ) : (
                  <div className="bg-slate-800/95 rounded-lg shadow-xl p-4 min-w-[340px] text-center">
                    <div className="text-yellow-400 text-sm animate-pulse">
                      {t('measure.loadingTerrain', lang)}
                    </div>
                  </div>
                )
              )}
            </div>
          ))}
          {currentRoute.length >= 2 && currentStats && (
            <div className="bg-blue-600/90 text-white px-3 py-1.5 rounded shadow-lg text-sm font-medium flex items-center gap-2">
              <span>{t('measure.route', lang)} {routes.length + 1}: {formatDistance(currentStats.totalDistance)}</span>
              <span className="text-green-300 text-xs">↑{formatElevation(currentStats.totalAscent)}</span>
              <span className="text-red-300 text-xs">↓{formatElevation(currentStats.totalDescent)}</span>
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
