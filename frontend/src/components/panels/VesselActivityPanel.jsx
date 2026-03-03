import { useState, useEffect, useMemo, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

// Category colors matching VesselLegend
const CATEGORY_COLORS = {
  'Military': '#f59e0b',
  'Law Enforcement': '#dc2626',
  'Cargo': '#22c55e',
  'Tanker': '#ef4444',
  'Passenger': '#3b82f6',
  'Fishing': '#f97316',
  'High-speed': '#eab308',
  'Sailing/Pleasure': '#a855f7',
  'Other': '#737373',
};

// Detect anomalies in vessel track
function detectAnomalies(trackPoints, bounds) {
  const anomalies = {
    speedChanges: [],
    loitering: [],
    aisGaps: [],
  };

  if (!trackPoints || trackPoints.length < 2) return anomalies;

  const { west, east, north, south } = bounds;
  const isInBox = ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north;

  let loiteringStart = null;
  let loiteringMinutes = 0;
  let lastPointInBox = null;

  for (let i = 1; i < trackPoints.length; i++) {
    const pt = trackPoints[i];
    const prevPt = trackPoints[i - 1];

    // Only analyze points inside the box
    if (!isInBox(pt.coordinates)) continue;

    const timeDelta = (new Date(pt.timestamp) - new Date(prevPt.timestamp)) / 60000;

    // Detect speed changes (>5 knots change)
    if (pt.speed != null && prevPt.speed != null) {
      const speedChange = Math.abs(pt.speed - prevPt.speed);
      if (speedChange > 5 && timeDelta < 10) {
        anomalies.speedChanges.push({
          timestamp: pt.timestamp,
          coordinates: pt.coordinates,
          from: prevPt.speed,
          to: pt.speed,
          change: speedChange,
        });
      }
    }

    // Detect loitering (<2 knots for extended periods)
    if (pt.speed != null && pt.speed < 2) {
      if (!loiteringStart) {
        loiteringStart = pt;
        loiteringMinutes = 0;
      }
      loiteringMinutes += timeDelta;
    } else {
      if (loiteringStart && loiteringMinutes > 120) {
        anomalies.loitering.push({
          startTime: loiteringStart.timestamp,
          endTime: prevPt.timestamp,
          coordinates: loiteringStart.coordinates,
          duration: loiteringMinutes,
        });
      }
      loiteringStart = null;
      loiteringMinutes = 0;
    }

    // Detect AIS gaps (>30 min between points)
    if (timeDelta > 30 && isInBox(prevPt.coordinates)) {
      anomalies.aisGaps.push({
        startTime: prevPt.timestamp,
        endTime: pt.timestamp,
        duration: timeDelta,
        startCoords: prevPt.coordinates,
        endCoords: pt.coordinates,
      });
    }

    lastPointInBox = pt;
  }

  // Check final loitering period
  if (loiteringStart && loiteringMinutes > 120) {
    anomalies.loitering.push({
      startTime: loiteringStart.timestamp,
      endTime: trackPoints[trackPoints.length - 1].timestamp,
      coordinates: loiteringStart.coordinates,
      duration: loiteringMinutes,
    });
  }

  return anomalies;
}

// Check if line segment crosses any box edge (for pass-through detection)
function segmentCrossesBox(p1, p2, bounds) {
  const { west, east, north, south } = bounds;
  const [x1, y1] = p1;
  const [x2, y2] = p2;

  // Check intersection with each edge
  const checkHorizontal = (y, xMin, xMax) => {
    if ((y1 <= y && y2 >= y) || (y1 >= y && y2 <= y)) {
      if (y1 === y2) return null;
      const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
      if (x >= xMin && x <= xMax) return [x, y];
    }
    return null;
  };

  const checkVertical = (x, yMin, yMax) => {
    if ((x1 <= x && x2 >= x) || (x1 >= x && x2 <= x)) {
      if (x1 === x2) return null;
      const y = y1 + (x - x1) * (y2 - y1) / (x2 - x1);
      if (y >= yMin && y <= yMax) return [x, y];
    }
    return null;
  };

  // Find all intersection points with box edges
  const intersections = [
    checkHorizontal(north, west, east),
    checkHorizontal(south, west, east),
    checkVertical(west, south, north),
    checkVertical(east, south, north),
  ].filter(Boolean);

  return intersections;
}

// Analyze vessel track for entry/exit events
function analyzeVesselTrack(trackPoints, bounds) {
  if (!trackPoints || trackPoints.length < 2) return { events: [], currentlyInside: false, timeInBox: 0, firstSeen: null, lastSeen: null };

  const { west, east, north, south } = bounds;
  const isInBox = ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north;

  const events = [];
  let wasInside = isInBox(trackPoints[0].coordinates);
  let timeInBox = 0;
  let lastInBoxTime = wasInside ? new Date(trackPoints[0].timestamp) : null;
  let firstSeen = wasInside ? trackPoints[0].timestamp : null;
  let lastSeen = wasInside ? trackPoints[0].timestamp : null;

  for (let i = 1; i < trackPoints.length; i++) {
    const pt = trackPoints[i];
    const prevPt = trackPoints[i - 1];
    const isInside = isInBox(pt.coordinates);

    if (!wasInside && isInside) {
      // Clear entry: was outside, now inside
      events.push({
        type: 'entry',
        timestamp: pt.timestamp,
        coordinates: pt.coordinates,
      });
      lastInBoxTime = new Date(pt.timestamp);
      if (!firstSeen) firstSeen = pt.timestamp;
    } else if (wasInside && !isInside) {
      // Clear exit: was inside, now outside
      events.push({
        type: 'exit',
        timestamp: pt.timestamp,
        coordinates: prevPt.coordinates,
      });
      if (lastInBoxTime) {
        timeInBox += (new Date(pt.timestamp) - lastInBoxTime) / 60000;
        lastInBoxTime = null;
      }
    } else if (!wasInside && !isInside) {
      // Both points outside - check if segment passes THROUGH the box
      const crossings = segmentCrossesBox(prevPt.coordinates, pt.coordinates, bounds);
      if (crossings.length >= 2) {
        // Vessel crossed through the box (entered and exited between two points)
        // Interpolate timestamp for midpoint
        const midTime = new Date((new Date(prevPt.timestamp).getTime() + new Date(pt.timestamp).getTime()) / 2);
        events.push({
          type: 'entry',
          timestamp: midTime.toISOString(),
          coordinates: crossings[0],
        });
        events.push({
          type: 'exit',
          timestamp: midTime.toISOString(),
          coordinates: crossings[1],
        });
        if (!firstSeen) firstSeen = midTime.toISOString();
        lastSeen = midTime.toISOString();
      }
    }

    if (isInside) {
      lastSeen = pt.timestamp;
    }

    wasInside = isInside;
  }

  // If still inside at end of track
  if (wasInside && lastInBoxTime) {
    const lastPt = trackPoints[trackPoints.length - 1];
    timeInBox += (new Date(lastPt.timestamp) - lastInBoxTime) / 60000;
  }

  return { events, currentlyInside: wasInside, timeInBox, firstSeen, lastSeen };
}

function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString('no-NO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Vessel list item component
function VesselItem({ vessel, analysis, onFocus, lang, isLoading }) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    onFocus(vessel.mmsi, vessel.coordinates);
  };

  return (
    <div className="border-b border-slate-700/50 last:border-0">
      <button
        onClick={handleClick}
        className="w-full text-left px-3 py-2 hover:bg-slate-700/50 transition-colors flex items-center gap-2 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">
            {vessel.name || `MMSI ${vessel.mmsi}`}
          </div>
          <div className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
            <span style={{ color: CATEGORY_COLORS[vessel.shipTypeCategory] || '#737373' }}>
              {vessel.shipTypeCategory || 'Unknown'}
            </span>
            {analysis.currentlyInside && (
              <span className="text-green-400">{t('vesselActivity.inside', lang)}</span>
            )}
          </div>
        </div>
        {analysis.events.length > 0 && (
          <div className="flex items-center gap-1">
            {analysis.events.some((e) => e.type === 'entry') && (
              <span className="text-green-400 text-[10px] bg-green-400/10 px-1.5 py-0.5 rounded">
                {analysis.events.filter((e) => e.type === 'entry').length}&uarr;
              </span>
            )}
            {analysis.events.some((e) => e.type === 'exit') && (
              <span className="text-red-400 text-[10px] bg-red-400/10 px-1.5 py-0.5 rounded">
                {analysis.events.filter((e) => e.type === 'exit').length}&darr;
              </span>
            )}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="text-slate-400 hover:text-white p-1"
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2 text-[10px] text-slate-400 space-y-1">
          {analysis.firstSeen && (
            <div>
              {t('vesselActivity.firstSeen', lang)}: {formatTime(analysis.firstSeen)}
            </div>
          )}
          {analysis.lastSeen && (
            <div>
              {t('vesselActivity.lastSeen', lang)}: {formatTime(analysis.lastSeen)}
            </div>
          )}
          {analysis.timeInBox > 0 && (
            <div>
              {t('vesselActivity.timeInBox', lang)}: {formatDuration(analysis.timeInBox)}
            </div>
          )}
          {analysis.events.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {analysis.events.slice(-5).map((event, i) => (
                <div
                  key={i}
                  className={event.type === 'entry' ? 'text-green-400' : 'text-red-400'}
                >
                  {event.type === 'entry' ? '\u2191' : '\u2193'} {formatTime(event.timestamp)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Main panel component
export default function VesselActivityPanel() {
  const lang = useMapStore((s) => s.lang);
  const mapRef = useMapStore((s) => s.mapRef);
  const vesselActivityBox = useMapStore((s) => s.vesselActivityBox);
  const clearVesselActivityBox = useMapStore((s) => s.clearVesselActivityBox);
  const setVesselActivityDrawing = useMapStore((s) => s.setVesselActivityDrawing);
  const setFocusedVessel = useMapStore((s) => s.setFocusedVessel);

  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState('entered');
  const [vesselPositions, setVesselPositions] = useState({});
  const [debugInfo, setDebugInfo] = useState(null);

  // Analyze vessel activity when box is set
  const analyzeActivity = useCallback(async () => {
    if (!vesselActivityBox) {
      return;
    }

    setLoading(true);
    try {
      const { bounds } = vesselActivityBox;

      // Expand search bounds significantly to catch vessels that passed through historically
      // A vessel at 12-15 knots can travel 300-400km per day, so over 5 days that's 1500-2000km
      // We use a minimum expansion of ~300km to catch vessels that have traveled away
      // 300km ≈ 2.7° latitude, and ~5° longitude at Norwegian latitudes (60°N)
      const MIN_LAT_EXPANSION = 2.7; // ~300km
      const MIN_LNG_EXPANSION = 5.0; // ~300km at 60°N

      const latRange = bounds.north - bounds.south;
      const lngRange = bounds.east - bounds.west;

      // Use the larger of: 3x box size OR minimum expansion distance
      const latExpansion = Math.max(latRange * 1.5, MIN_LAT_EXPANSION);
      const lngExpansion = Math.max(lngRange * 1.5, MIN_LNG_EXPANSION);

      const expandedBounds = {
        south: Math.max(bounds.south - latExpansion, -90),
        north: Math.min(bounds.north + latExpansion, 90),
        west: bounds.west - lngExpansion,
        east: bounds.east + lngExpansion,
      };

      // Fetch current vessels from expanded area
      console.log('Fetching vessels from expanded bounds:', expandedBounds);
      const res = await fetch(
        `/api/ais?south=${expandedBounds.south}&north=${expandedBounds.north}&west=${expandedBounds.west}&east=${expandedBounds.east}`
      );
      if (!res.ok) throw new Error('Failed to fetch vessels');
      const geojson = await res.json();

      // Build map of current vessel positions
      const positions = {};
      geojson.features.forEach((f) => {
        positions[f.properties.mmsi] = {
          ...f.properties,
          coordinates: f.geometry.coordinates,
        };
      });

      // Get unique MMSIs from expanded area
      const mmsis = Object.keys(positions);
      console.log('Found ' + mmsis.length + ' vessels in expanded area');

      if (mmsis.length === 0) {
        setAnalysisData({ entered: [], exited: [], inside: [], anomalies: {} });
        setVesselPositions({});
        setDebugInfo({ vesselsInArea: 0, tracesChecked: 0, relevantVessels: 0 });
        setLoading(false);
        return;
      }

      // Fetch batch traces in chunks of 50 (API limit)
      const BATCH_SIZE = 50;
      const allTraces = {};
      const allErrors = [];

      for (let i = 0; i < mmsis.length; i += BATCH_SIZE) {
        const batch = mmsis.slice(i, i + BATCH_SIZE);
        try {
          const traceRes = await fetch('/api/ais/traces/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mmsis: batch }),
          });

          if (traceRes.ok) {
            const { traces, errors } = await traceRes.json();
            Object.assign(allTraces, traces);
            if (errors) allErrors.push(...errors);
          }
        } catch (err) {
          console.error('Batch trace error:', err);
        }
      }

      const traces = allTraces;

      // Analyze each vessel - only include if trace intersects monitoring box
      const entered = [];
      const exited = [];
      const inside = [];
      const allAnomalies = {};
      const relevantPositions = {};

      // Helper to check if a line segment intersects a horizontal or vertical line
      const lineSegmentIntersects = (p1, p2, isHorizontal, value, min, max) => {
        const [x1, y1] = p1;
        const [x2, y2] = p2;
        if (isHorizontal) {
          // Check intersection with horizontal line y = value
          if ((y1 <= value && y2 >= value) || (y1 >= value && y2 <= value)) {
            if (y1 === y2) return false;
            const x = x1 + (value - y1) * (x2 - x1) / (y2 - y1);
            return x >= min && x <= max;
          }
        } else {
          // Check intersection with vertical line x = value
          if ((x1 <= value && x2 >= value) || (x1 >= value && x2 <= value)) {
            if (x1 === x2) return false;
            const y = y1 + (value - x1) * (y2 - y1) / (x2 - x1);
            return y >= min && y <= max;
          }
        }
        return false;
      };

      // Helper to check if trace intersects the monitoring box
      // Checks both points inside box AND line segments crossing box boundaries
      const traceIntersectsBox = (trackPoints) => {
        const { west, east, north, south } = bounds;

        for (let i = 0; i < trackPoints.length; i++) {
          const [lng, lat] = trackPoints[i].coordinates;

          // Check if point is inside box
          if (lng >= west && lng <= east && lat >= south && lat <= north) {
            return true;
          }

          // Check if line segment from previous point crosses box boundary
          if (i > 0) {
            const p1 = trackPoints[i - 1].coordinates;
            const p2 = trackPoints[i].coordinates;

            // Check intersection with each of the 4 box edges
            if (lineSegmentIntersects(p1, p2, true, north, west, east) ||  // top edge
                lineSegmentIntersects(p1, p2, true, south, west, east) ||  // bottom edge
                lineSegmentIntersects(p1, p2, false, west, south, north) || // left edge
                lineSegmentIntersects(p1, p2, false, east, south, north)) { // right edge
              return true;
            }
          }
        }
        return false;
      };

      let tracesWithData = 0;
      let tracesCheckedForIntersection = 0;

      for (const mmsi of mmsis) {
        const trace = traces[mmsi];
        const vessel = positions[mmsi];

        if (!trace || !trace.properties?.trackPoints) continue;
        tracesWithData++;

        const trackPoints = [...trace.properties.trackPoints].reverse();
        tracesCheckedForIntersection++;

        // Debug: log first few vessels' trace info
        if (tracesCheckedForIntersection <= 3) {
          const sampleCoords = trackPoints.slice(0, 3).map(p => p.coordinates);
          console.log(`Trace ${tracesCheckedForIntersection} (${mmsi}):`, {
            pointCount: trackPoints.length,
            firstPoint: trackPoints[0],
            sampleCoords,
          });
          // Test point-in-box manually for debugging
          if (trackPoints.length > 0) {
            const testPt = trackPoints[0].coordinates;
            console.log(`  First point [${testPt}] vs bounds:`, {
              'lng >= west': testPt[0] >= bounds.west,
              'lng <= east': testPt[0] <= bounds.east,
              'lat >= south': testPt[1] >= bounds.south,
              'lat <= north': testPt[1] <= bounds.north,
              bounds,
            });
          }
        }

        // Skip vessels whose historical track never intersected the monitoring box
        const intersects = traceIntersectsBox(trackPoints);
        if (tracesCheckedForIntersection <= 3) {
          console.log(`  Intersects box: ${intersects}`);
        }
        if (!intersects) continue;

        // This vessel's trace intersects the box - include in analysis
        relevantPositions[mmsi] = vessel;

        const analysis = analyzeVesselTrack(trackPoints, bounds);
        const anomalies = detectAnomalies(trackPoints, bounds);

        const vesselData = {
          mmsi,
          name: vessel.name,
          shipTypeCategory: vessel.shipTypeCategory,
          coordinates: vessel.coordinates,
          analysis,
          anomalies,
        };

        // Categorize based on events
        const hasEntry = analysis.events.some((e) => e.type === 'entry');
        const hasExit = analysis.events.some((e) => e.type === 'exit');

        if (hasEntry) entered.push(vesselData);
        if (hasExit) exited.push(vesselData);
        if (analysis.currentlyInside) inside.push(vesselData);

        // Aggregate anomalies
        if (anomalies.speedChanges.length > 0 || anomalies.loitering.length > 0 || anomalies.aisGaps.length > 0) {
          allAnomalies[mmsi] = anomalies;
        }
      }

      const relevantCount = Object.keys(relevantPositions).length;
      console.log(`Activity box: ${tracesWithData} traces had data, ${relevantCount} intersected the box`);
      console.log(`Activity box: entered=${entered.length}, exited=${exited.length}, inside=${inside.length}`);
      console.log('Monitoring box bounds:', bounds);

      setVesselPositions(relevantPositions);
      setDebugInfo({ vesselsInArea: mmsis.length, tracesChecked: mmsis.length, relevantVessels: relevantCount });
      setAnalysisData({ entered, exited, inside, anomalies: allAnomalies });
    } catch (err) {
      console.error('Activity analysis error:', err);
    } finally {
      setLoading(false);
    }
  }, [vesselActivityBox]);

  // Run analysis when box changes
  useEffect(() => {
    if (vesselActivityBox) {
      analyzeActivity();
    } else {
      setAnalysisData(null);
    }
  }, [vesselActivityBox, analyzeActivity]);

  // Handle vessel focus
  const handleFocusVessel = useCallback(
    (mmsi, coordinates) => {
      setFocusedVessel(String(mmsi));
      if (mapRef && coordinates) {
        mapRef.flyTo({
          center: coordinates,
          zoom: 12,
          duration: 1500,
        });
      }
    },
    [setFocusedVessel, mapRef]
  );

  // Handle clear
  const handleClear = () => {
    clearVesselActivityBox();
    setAnalysisData(null);
  };

  // Handle refresh
  const handleRefresh = () => {
    analyzeActivity();
  };

  if (!vesselActivityBox) return null;

  const totalAnomalies = analysisData
    ? Object.values(analysisData.anomalies).reduce(
        (sum, a) => sum + a.speedChanges.length + a.loitering.length + a.aisGaps.length,
        0
      )
    : 0;

  return (
    <div className="absolute bottom-4 right-4 z-20 w-80 max-h-[calc(100vh-120px)] bg-slate-900/95 rounded-lg shadow-xl border border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-white text-sm">{t('vesselActivity.title', lang)}</div>
          <button onClick={handleClear} className="text-slate-400 hover:text-white text-lg leading-none">
            &times;
          </button>
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          {vesselActivityBox.widthKm.toFixed(0)}km &times; {vesselActivityBox.heightKm.toFixed(0)}km | {t('vesselActivity.last5Days', lang)}
          {debugInfo && (
            <span className="ml-2 text-slate-500">
              ({debugInfo.vesselsInArea} scanned, {debugInfo.relevantVessels} matched)
            </span>
          )}
        </div>
      </div>

      {/* Summary counts */}
      <div className="px-4 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="flex gap-3 text-xs">
          <button
            onClick={() => setExpandedSection('entered')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              expandedSection === 'entered' ? 'bg-green-600/30 text-green-400' : 'text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-bold">{analysisData?.entered.length || 0}</span>
            <span>{t('vesselActivity.entered', lang)}</span>
          </button>
          <button
            onClick={() => setExpandedSection('exited')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              expandedSection === 'exited' ? 'bg-red-600/30 text-red-400' : 'text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-bold">{analysisData?.exited.length || 0}</span>
            <span>{t('vesselActivity.exited', lang)}</span>
          </button>
          <button
            onClick={() => setExpandedSection('inside')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              expandedSection === 'inside' ? 'bg-cyan-600/30 text-cyan-400' : 'text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-bold">{analysisData?.inside.length || 0}</span>
            <span>{t('vesselActivity.inside', lang)}</span>
          </button>
        </div>
      </div>

      {/* Vessel list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="p-4 text-center text-slate-400 text-sm">{t('general.loading', lang)}</div>
        ) : !analysisData ? (
          <div className="p-4 text-center text-slate-400 text-sm">{t('vesselActivity.noVessels', lang)}</div>
        ) : (
          <>
            {/* Section heading */}
            <div className="px-3 py-1.5 bg-slate-800/50 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
              {expandedSection === 'entered' && `${t('vesselActivity.entered', lang)} (${analysisData.entered.length})`}
              {expandedSection === 'exited' && `${t('vesselActivity.exited', lang)} (${analysisData.exited.length})`}
              {expandedSection === 'inside' && `${t('vesselActivity.inside', lang)} (${analysisData.inside.length})`}
            </div>

            {/* Vessel items */}
            {expandedSection === 'entered' &&
              analysisData.entered.map((v) => (
                <VesselItem
                  key={v.mmsi}
                  vessel={v}
                  analysis={v.analysis}
                  onFocus={handleFocusVessel}
                  lang={lang}
                  isLoading={loading}
                />
              ))}
            {expandedSection === 'exited' &&
              analysisData.exited.map((v) => (
                <VesselItem
                  key={v.mmsi}
                  vessel={v}
                  analysis={v.analysis}
                  onFocus={handleFocusVessel}
                  lang={lang}
                  isLoading={loading}
                />
              ))}
            {expandedSection === 'inside' &&
              analysisData.inside.map((v) => (
                <VesselItem
                  key={v.mmsi}
                  vessel={v}
                  analysis={v.analysis}
                  onFocus={handleFocusVessel}
                  lang={lang}
                  isLoading={loading}
                />
              ))}

            {/* Empty state for current section */}
            {expandedSection === 'entered' && analysisData.entered.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('vesselActivity.noVessels', lang)}</div>
            )}
            {expandedSection === 'exited' && analysisData.exited.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('vesselActivity.noVessels', lang)}</div>
            )}
            {expandedSection === 'inside' && analysisData.inside.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('vesselActivity.noVessels', lang)}</div>
            )}
          </>
        )}

        {/* Anomalies section */}
        {analysisData && totalAnomalies > 0 && (
          <div className="border-t border-slate-700">
            <button
              onClick={() => setExpandedSection(expandedSection === 'anomalies' ? 'entered' : 'anomalies')}
              className={`w-full px-3 py-2 text-left flex items-center justify-between ${
                expandedSection === 'anomalies' ? 'bg-amber-600/20' : 'hover:bg-slate-700/50'
              }`}
            >
              <span className="text-xs text-amber-400 font-medium">
                {t('vesselActivity.anomalies', lang)} ({totalAnomalies})
              </span>
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${expandedSection === 'anomalies' ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expandedSection === 'anomalies' && (
              <div className="px-3 pb-2 text-[10px] text-slate-400 space-y-2">
                {Object.entries(analysisData.anomalies).map(([mmsi, anomalies]) => {
                  const vessel = vesselPositions[mmsi];
                  return (
                    <div key={mmsi} className="space-y-1">
                      <button
                        onClick={() => handleFocusVessel(mmsi, vessel?.coordinates)}
                        className="text-slate-300 font-medium hover:text-cyan-400 cursor-pointer transition-colors"
                      >
                        {vessel?.name || `MMSI ${mmsi}`}
                      </button>
                      {anomalies.speedChanges.length > 0 && (
                        <div className="text-amber-400 pl-2">
                          {anomalies.speedChanges.length}x {t('vesselActivity.speedChange', lang)}
                        </div>
                      )}
                      {anomalies.loitering.length > 0 && (
                        <div className="text-orange-400 pl-2">
                          {anomalies.loitering.length}x {t('vesselActivity.loitering', lang)}
                        </div>
                      )}
                      {anomalies.aisGaps.length > 0 && (
                        <div className="text-red-400 pl-2">
                          {anomalies.aisGaps.length}x {t('vesselActivity.aisGaps', lang)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div className="px-4 py-2 border-t border-slate-700 flex gap-2 flex-shrink-0">
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex-1 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors disabled:opacity-50"
        >
          {t('vesselActivity.refresh', lang)}
        </button>
        <button
          onClick={handleClear}
          className="flex-1 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
        >
          {t('vesselActivity.clearArea', lang)}
        </button>
      </div>
    </div>
  );
}
