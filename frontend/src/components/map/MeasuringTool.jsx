import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  const [expanded, setExpanded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  if (!profilePoints || profilePoints.length < 2) return null;

  const stats = getDetailedStats(profilePoints);
  if (!stats) return null;

  const { minElevation, maxElevation, totalDistance, totalAscent, totalDescent, minIndex, maxIndex } = stats;
  const startElevation = profilePoints[0].elevation;
  const endElevation = profilePoints[profilePoints.length - 1].elevation;

  // SVG dimensions - viewBox coordinates (not pixels)
  // Expanded uses 4:1 aspect ratio for wide display
  const width = expanded ? 1200 : 500;
  const height = expanded ? 300 : 180;
  const padding = {
    top: expanded ? 30 : 15,
    right: expanded ? 40 : 15,
    bottom: expanded ? 55 : 30,
    left: expanded ? 75 : 50,
  };
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

  // Y-axis labels
  const yLabelCount = expanded ? 8 : 5;
  const yLabels = [];
  for (let i = 0; i < yLabelCount; i++) {
    const elev = minElevation + (elevRange * i) / (yLabelCount - 1);
    yLabels.push(Math.round(elev));
  }

  // X-axis labels
  const xLabelCount = expanded ? 10 : 5;
  const xLabels = [];
  for (let i = 0; i < xLabelCount; i++) {
    xLabels.push((totalDistance * i) / (xLabelCount - 1));
  }

  // Find waypoint positions for markers
  const waypointMarkers = profilePoints
    .map((p, i) => (p.isWaypoint ? { ...p, index: i } : null))
    .filter(Boolean);

  // Handle mouse move for scrubber
  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    // Scale mouse position if SVG is scaled
    const scaleX = width / rect.width;
    const x = svgX * scaleX;

    // Check if within chart area horizontally
    if (x >= padding.left && x <= padding.left + chartWidth) {
      const fraction = (x - padding.left) / chartWidth;
      const distanceFromStart = fraction * totalDistance;
      const distanceToEnd = totalDistance - distanceFromStart;

      // Find the closest profile point
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < profilePoints.length; i++) {
        const diff = Math.abs(profilePoints[i].cumulativeDistance - distanceFromStart);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }
      const elevation = profilePoints[closestIdx].elevation;
      const elevY = padding.top + chartHeight - ((elevation - minY) / (maxY - minY)) * chartHeight;
      const lineX = padding.left + (distanceFromStart / totalDistance) * chartWidth;

      setHoverInfo({ distanceFromStart, distanceToEnd, elevation, elevY, lineX });
    } else {
      setHoverInfo(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
  };

  const fontSize = expanded ? 14 : 10;
  const labelFontSize = expanded ? 12 : 9;
  const markerRadius = expanded ? 7 : 5;
  const wpRadius = expanded ? 6 : 4;

  const containerClass = expanded
    ? "bg-slate-900 rounded-lg shadow-2xl p-6"
    : "bg-slate-800/95 rounded-lg shadow-xl p-3 min-w-[520px]";

  // Handle backdrop click to close expanded view
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      setExpanded(false);
    }
  };

  const content = (
    <div className={containerClass} ref={containerRef} style={expanded ? { width: '80vw', maxHeight: '90vh' } : undefined}>
      <div className={`flex justify-between items-center ${expanded ? 'mb-3' : 'mb-2'} flex-shrink-0`}>
        <span className={`text-white font-medium ${expanded ? 'text-xl' : 'text-sm'}`}>
          {t('measure.route', lang)} {routeIndex + 1} - {t('measure.profile', lang)}
          {loading && <span className="ml-2 text-yellow-400 text-xs">(loading terrain...)</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
            title={expanded ? t('measure.shrink', lang) : t('measure.expand', lang)}
          >
            {expanded ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            className={`text-slate-400 hover:text-white leading-none px-1 ${expanded ? 'text-2xl' : 'text-lg'}`}
          >
            ×
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mb-3 text-base' : 'mb-2 text-xs'} flex-wrap flex-shrink-0`}>
        <span className="text-slate-400">{t('measure.start', lang)}: {formatElevation(startElevation)}</span>
        <span className="text-slate-400">{t('measure.end', lang)}: {formatElevation(endElevation)}</span>
        <span className="text-green-400">↑ {formatElevation(totalAscent)}</span>
        <span className="text-red-400">↓ {formatElevation(totalDescent)}</span>
        <span className="text-emerald-400">{t('measure.highest', lang)}: {formatElevation(maxElevation)}</span>
        <span className="text-blue-400">{t('measure.lowest', lang)}: {formatElevation(minElevation)}</span>
      </div>

      {/* SVG Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`rounded ${expanded ? 'bg-slate-800 w-full' : 'bg-slate-900/50 w-full'}`}
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: expanded ? 'calc(90vh - 140px)' : height }}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines - horizontal */}
        {yLabels.map((label, i) => {
          const y = padding.top + chartHeight - ((label - minY) / (maxY - minY)) * chartHeight;
          return (
            <g key={`y-${i}`}>
              <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y}
                stroke="#374151" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end"
                fill="#9ca3af" fontSize={fontSize}>{label}</text>
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
            <text key={`x-${i}`} x={x} y={height - (expanded ? 12 : 8)} textAnchor="middle"
              fill="#9ca3af" fontSize={fontSize}>{formatDistance(dist)}</text>
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
        <path d={pathPoints} fill="none" stroke="#3b82f6" strokeWidth={expanded ? 2 : 2} strokeLinejoin="round" />

        {/* Scrubber vertical line */}
        {hoverInfo && (
          <>
            <line
              x1={hoverInfo.lineX}
              y1={padding.top}
              x2={hoverInfo.lineX}
              y2={padding.top + chartHeight}
              stroke="#fbbf24"
              strokeWidth={expanded ? 1.3 : 2}
              strokeDasharray={expanded ? "3 2" : "4 2"}
            />
            <circle
              cx={hoverInfo.lineX}
              cy={hoverInfo.elevY}
              r={expanded ? 5 : 6}
              fill="#fbbf24"
              stroke="#fff"
              strokeWidth={expanded ? 1.3 : 2}
            />
          </>
        )}

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
              <circle cx={minX} cy={minYPos} r={markerRadius} fill="#3b82f6" stroke="#fff" strokeWidth="2" />
              <text x={minX} y={minYPos - (expanded ? 12 : 8)} textAnchor="middle" fill="#60a5fa" fontSize={labelFontSize} fontWeight="bold">
                {formatElevation(minPt.elevation)}
              </text>
              {/* Highest point */}
              <circle cx={maxX} cy={maxYPos} r={markerRadius} fill="#22c55e" stroke="#fff" strokeWidth="2" />
              <text x={maxX} y={maxYPos - (expanded ? 12 : 8)} textAnchor="middle" fill="#22c55e" fontSize={labelFontSize} fontWeight="bold">
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
              <circle cx={x} cy={y} r={wpRadius} fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
              <text x={x} y={y + (expanded ? 4 : 3)} textAnchor="middle" fill="#fff" fontSize={expanded ? 10 : 7} fontWeight="bold">
                {wp.waypointIndex + 1}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={padding.left + chartWidth / 2} y={height - (expanded ? 8 : 1)} textAnchor="middle"
          fill="#64748b" fontSize={labelFontSize}>{t('measure.distance', lang)}</text>
        <text x={expanded ? 18 : 10} y={padding.top + chartHeight / 2} textAnchor="middle"
          fill="#64748b" fontSize={labelFontSize} transform={`rotate(-90, ${expanded ? 18 : 10}, ${padding.top + chartHeight / 2})`}>
          {t('measure.elevation', lang)} (m)
        </text>
      </svg>

      {/* Scrubber info display - always visible below chart */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mt-3 text-base' : 'mt-2 text-xs'} bg-slate-700/50 rounded px-3 py-1.5 flex-shrink-0`}>
        <span>{t('measure.fromStart', lang)}: <strong className="text-white">{hoverInfo ? formatDistance(hoverInfo.distanceFromStart) : '—'}</strong></span>
        <span>{t('measure.toEnd', lang)}: <strong className="text-white">{hoverInfo ? formatDistance(hoverInfo.distanceToEnd) : '—'}</strong></span>
        <span>{t('measure.elevation', lang)}: <strong className="text-yellow-400">{hoverInfo ? formatElevation(hoverInfo.elevation) : '—'}</strong></span>
      </div>
    </div>
  );

  // Use portal for expanded mode to escape all CSS containment
  if (expanded) {
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center"
        onClick={handleBackdropClick}
      >
        {content}
      </div>,
      document.body
    );
  }

  return content;
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
  // profilePoints: detailed terrain points for terrain-following line (optional)
  const renderRoute = (waypoints, isActive = false, profilePoints = null) => {
    if (waypoints.length === 0) return null;

    const waypointScreenPts = waypoints.map((wp) => ({ ...project(wp), elevation: wp.elevation })).filter(p => p.x !== undefined);
    if (waypointScreenPts.length === 0) return null;

    // For terrain-following line, use profilePoints if available
    const linePoints = profilePoints
      ? profilePoints.map((p) => project(p)).filter(Boolean)
      : waypointScreenPts;

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

    // Build polyline path from all points (terrain-following)
    const linePath = linePoints.length > 1
      ? linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : null;

    return (
      <>
        {/* Terrain-following line as polyline */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

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
        {waypointScreenPts.map((p, i) => (
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
        {isActive && mousePos && waypointScreenPts.length > 0 && (() => {
          const lastPt = waypointScreenPts[waypointScreenPts.length - 1];
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
        {/* Completed routes - use profilePoints for terrain-following line */}
        {routes.map((route) => (
          <g key={route.id}>{renderRoute(route.waypoints, false, route.profilePoints)}</g>
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
              {/* Height profile - rendered inline, uses portal internally when expanded */}
              {expandedProfile === i && (
                routes[i]?.profilePoints ? (
                  <HeightProfile
                    profilePoints={routes[i].profilePoints}
                    waypointIndices={routes[i].waypoints.map((_, idx) => idx)}
                    routeIndex={i}
                    lang={lang}
                    onClose={() => setExpandedProfile(null)}
                    loading={routes[i].loading}
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
