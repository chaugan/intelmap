import { useState, useEffect, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const CATEGORY_COLORS = {
  'Military': '#f59e0b',
  'Government': '#dc2626',
  'Helicopter': '#a855f7',
  'Commercial': '#3b82f6',
  'General Aviation': '#22c55e',
  'Other': '#737373',
};

function categorizeAircraft(props) {
  if (props.military) return 'Military';
  if (props.special) return 'Government';
  if (props.helicopter) return 'Helicopter';
  if (props.callsign && /^[A-Z]{3}\d/.test(props.callsign)) return 'Commercial';
  if (props.type) return 'General Aviation';
  return 'Other';
}

// Detect aircraft-specific anomalies
function detectAnomalies(trackPoints, bounds) {
  const anomalies = {
    altitudeChanges: [],
    orbiting: [],
    adsbGaps: [],
    squawkChanges: [],
  };

  if (!trackPoints || trackPoints.length < 2) return anomalies;

  const { west, east, north, south } = bounds;
  const isInBox = ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north;

  let lastPointInBox = null;

  for (let i = 1; i < trackPoints.length; i++) {
    const pt = trackPoints[i];
    const prevPt = trackPoints[i - 1];

    if (!isInBox(pt.coordinates)) continue;

    const timeDelta = (new Date(pt.timestamp) - new Date(prevPt.timestamp)) / 60000;

    // Altitude changes: >5000ft in <2 minutes
    if (pt.altitude != null && prevPt.altitude != null && timeDelta > 0 && timeDelta < 2) {
      const altChange = Math.abs(pt.altitude - prevPt.altitude);
      if (altChange > 5000) {
        anomalies.altitudeChanges.push({
          timestamp: pt.timestamp,
          coordinates: pt.coordinates,
          from: prevPt.altitude,
          to: pt.altitude,
          change: altChange,
        });
      }
    }

    // ADS-B gaps: >5 minutes between consecutive points in box
    if (timeDelta > 5 && isInBox(prevPt.coordinates)) {
      anomalies.adsbGaps.push({
        startTime: prevPt.timestamp,
        endTime: pt.timestamp,
        duration: timeDelta,
        startCoords: prevPt.coordinates,
        endCoords: pt.coordinates,
      });
    }

    lastPointInBox = pt;
  }

  // Orbiting detection: multiple heading reversals in a 5-minute window
  const inBoxPoints = trackPoints.filter(pt => isInBox(pt.coordinates) && pt.track != null && pt.speed != null);
  if (inBoxPoints.length >= 4) {
    for (let i = 0; i < inBoxPoints.length - 3; i++) {
      const windowEnd = new Date(inBoxPoints[i].timestamp).getTime() + 5 * 60000;
      const windowPts = [];
      for (let j = i; j < inBoxPoints.length; j++) {
        if (new Date(inBoxPoints[j].timestamp).getTime() > windowEnd) break;
        windowPts.push(inBoxPoints[j]);
      }
      if (windowPts.length < 4) continue;

      // Count direction reversals
      let reversals = 0;
      for (let j = 2; j < windowPts.length; j++) {
        const d1 = windowPts[j - 1].track - windowPts[j - 2].track;
        const d2 = windowPts[j].track - windowPts[j - 1].track;
        if ((d1 > 30 && d2 < -30) || (d1 < -30 && d2 > 30)) reversals++;
      }

      const avgSpeed = windowPts.reduce((s, p) => s + (p.speed || 0), 0) / windowPts.length;
      if (reversals >= 2 && avgSpeed < 150) {
        anomalies.orbiting.push({
          startTime: windowPts[0].timestamp,
          endTime: windowPts[windowPts.length - 1].timestamp,
          coordinates: windowPts[0].coordinates,
          reversals,
          avgSpeed,
        });
        // Skip ahead to avoid duplicate detections
        i += windowPts.length - 1;
      }
    }
  }

  return anomalies;
}

// Check if line segment crosses box edge
function segmentCrossesBox(p1, p2, bounds) {
  const { west, east, north, south } = bounds;
  const [x1, y1] = p1;
  const [x2, y2] = p2;

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

  return [
    checkHorizontal(north, west, east),
    checkHorizontal(south, west, east),
    checkVertical(west, south, north),
    checkVertical(east, south, north),
  ].filter(Boolean);
}

// Analyze aircraft track for entry/exit events
function analyzeTrack(trackPoints, bounds) {
  if (!trackPoints || trackPoints.length < 2) return { events: [], currentlyInside: false, timeInBox: 0, firstSeen: null, lastSeen: null, minAlt: null, maxAlt: null };

  const { west, east, north, south } = bounds;
  const isInBox = ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north;

  const events = [];
  let wasInside = isInBox(trackPoints[0].coordinates);
  let timeInBox = 0;
  let lastInBoxTime = wasInside ? new Date(trackPoints[0].timestamp) : null;
  let firstSeen = wasInside ? trackPoints[0].timestamp : null;
  let lastSeen = wasInside ? trackPoints[0].timestamp : null;
  let minAlt = null;
  let maxAlt = null;

  for (let i = 1; i < trackPoints.length; i++) {
    const pt = trackPoints[i];
    const prevPt = trackPoints[i - 1];
    const isInside = isInBox(pt.coordinates);

    if (!wasInside && isInside) {
      events.push({ type: 'entry', timestamp: pt.timestamp, coordinates: pt.coordinates });
      lastInBoxTime = new Date(pt.timestamp);
      if (!firstSeen) firstSeen = pt.timestamp;
    } else if (wasInside && !isInside) {
      events.push({ type: 'exit', timestamp: pt.timestamp, coordinates: prevPt.coordinates });
      if (lastInBoxTime) {
        timeInBox += (new Date(pt.timestamp) - lastInBoxTime) / 60000;
        lastInBoxTime = null;
      }
    } else if (!wasInside && !isInside) {
      const crossings = segmentCrossesBox(prevPt.coordinates, pt.coordinates, bounds);
      if (crossings.length >= 2) {
        const midTime = new Date((new Date(prevPt.timestamp).getTime() + new Date(pt.timestamp).getTime()) / 2);
        events.push({ type: 'entry', timestamp: midTime.toISOString(), coordinates: crossings[0] });
        events.push({ type: 'exit', timestamp: midTime.toISOString(), coordinates: crossings[1] });
        if (!firstSeen) firstSeen = midTime.toISOString();
        lastSeen = midTime.toISOString();
      }
    }

    if (isInside) {
      lastSeen = pt.timestamp;
      if (pt.altitude != null && !pt.onGround) {
        if (minAlt === null || pt.altitude < minAlt) minAlt = pt.altitude;
        if (maxAlt === null || pt.altitude > maxAlt) maxAlt = pt.altitude;
      }
    }

    wasInside = isInside;
  }

  if (wasInside && lastInBoxTime) {
    const lastPt = trackPoints[trackPoints.length - 1];
    timeInBox += (new Date(lastPt.timestamp) - lastInBoxTime) / 60000;
  }

  return { events, currentlyInside: wasInside, timeInBox, firstSeen, lastSeen, minAlt, maxAlt };
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

function formatAlt(ft) {
  if (ft == null) return 'N/A';
  return `${Math.round(ft).toLocaleString()} ft`;
}

function AircraftItem({ aircraft, analysis, onFocus, lang }) {
  const [expanded, setExpanded] = useState(false);
  const category = categorizeAircraft(aircraft);

  return (
    <div className="border-b border-slate-700/50 last:border-0">
      <button
        onClick={() => onFocus(aircraft.hex, aircraft.coordinates)}
        className="w-full text-left px-3 py-2 hover:bg-slate-700/50 transition-colors flex items-center gap-2 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">
            {aircraft.callsign || aircraft.registration || aircraft.hex}
          </div>
          <div className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
            <span style={{ color: CATEGORY_COLORS[category] || '#737373' }}>
              {category}
            </span>
            {aircraft.type && <span className="text-slate-500">{aircraft.type}</span>}
            {analysis.currentlyInside && (
              <span className="text-green-400">{t('aircraftActivity.inside', lang)}</span>
            )}
          </div>
        </div>
        {analysis.minAlt != null && (
          <div className="text-[10px] text-slate-500 text-right">
            {formatAlt(analysis.minAlt)}{analysis.minAlt !== analysis.maxAlt && ` - ${formatAlt(analysis.maxAlt)}`}
          </div>
        )}
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
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-slate-400 hover:text-white p-1"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </button>

      {expanded && (
        <div className="px-3 pb-2 text-[10px] text-slate-400 space-y-1">
          {aircraft.registration && <div>Reg: {aircraft.registration}</div>}
          {analysis.firstSeen && <div>{t('aircraftActivity.firstSeen', lang)}: {formatTime(analysis.firstSeen)}</div>}
          {analysis.lastSeen && <div>{t('aircraftActivity.lastSeen', lang)}: {formatTime(analysis.lastSeen)}</div>}
          {analysis.timeInBox > 0 && <div>{t('aircraftActivity.timeInBox', lang)}: {formatDuration(analysis.timeInBox)}</div>}
          {analysis.events.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {analysis.events.slice(-5).map((event, i) => (
                <div key={i} className={event.type === 'entry' ? 'text-green-400' : 'text-red-400'}>
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

export default function AircraftActivityPanel() {
  const lang = useMapStore((s) => s.lang);
  const mapRef = useMapStore((s) => s.mapRef);
  const aircraftActivityBox = useMapStore((s) => s.aircraftActivityBox);
  const clearAircraftActivityBox = useMapStore((s) => s.clearAircraftActivityBox);
  const setFocusedAircraft = useMapStore((s) => s.setFocusedAircraft);

  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState('entered');
  const [aircraftPositions, setAircraftPositions] = useState({});

  const analyzeActivity = useCallback(async () => {
    if (!aircraftActivityBox) return;

    setLoading(true);
    try {
      const { bounds } = aircraftActivityBox;

      // Expand search bounds — 2x for aircraft (faster moving)
      const MIN_LAT_EXPANSION = 0.9;
      const MIN_LNG_EXPANSION = 1.8;
      const latRange = bounds.north - bounds.south;
      const lngRange = bounds.east - bounds.west;
      const latExpansion = Math.max(latRange * 2, MIN_LAT_EXPANSION);
      const lngExpansion = Math.max(lngRange * 2, MIN_LNG_EXPANSION);

      const expandedBounds = {
        south: Math.max(bounds.south - latExpansion, -90),
        north: Math.min(bounds.north + latExpansion, 90),
        west: bounds.west - lngExpansion,
        east: bounds.east + lngExpansion,
      };

      // Fetch current aircraft in expanded area (fresh=1 bypasses the shared cache)
      const res = await fetch(
        `/api/aircraft?south=${expandedBounds.south}&north=${expandedBounds.north}&west=${expandedBounds.west}&east=${expandedBounds.east}&fresh=1`
      );
      if (!res.ok) throw new Error('Failed to fetch aircraft');
      const geojson = await res.json();

      const positions = {};
      geojson.features.forEach((f) => {
        positions[f.properties.hex] = {
          ...f.properties,
          coordinates: f.geometry.coordinates,
        };
      });

      const hexes = Object.keys(positions);

      if (hexes.length === 0) {
        setAnalysisData({ entered: [], exited: [], inside: [], anomalies: {} });
        setAircraftPositions({});
        setLoading(false);
        return;
      }

      // Fetch batch traces
      const BATCH_SIZE = 50;
      const allTraces = {};
      const allErrors = [];

      for (let i = 0; i < hexes.length; i += BATCH_SIZE) {
        const batch = hexes.slice(i, i + BATCH_SIZE);
        try {
          const traceRes = await fetch('/api/aircraft/traces/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hexes: batch }),
          });

          if (traceRes.ok) {
            const { traces, errors } = await traceRes.json();
            Object.assign(allTraces, traces);
            if (errors) allErrors.push(...errors);
          }
        } catch (err) {
          console.error('Aircraft batch trace error:', err);
        }
      }

      // Analyze each aircraft
      const entered = [];
      const exited = [];
      const inside = [];
      const allAnomalies = {};
      const relevantPositions = {};

      const lineSegmentIntersects = (p1, p2, isHorizontal, value, min, max) => {
        const [x1, y1] = p1;
        const [x2, y2] = p2;
        if (isHorizontal) {
          if ((y1 <= value && y2 >= value) || (y1 >= value && y2 <= value)) {
            if (y1 === y2) return false;
            const x = x1 + (value - y1) * (x2 - x1) / (y2 - y1);
            return x >= min && x <= max;
          }
        } else {
          if ((x1 <= value && x2 >= value) || (x1 >= value && x2 <= value)) {
            if (x1 === x2) return false;
            const y = y1 + (value - x1) * (y2 - y1) / (x2 - x1);
            return y >= min && y <= max;
          }
        }
        return false;
      };

      const traceIntersectsBox = (trackPoints) => {
        const { west, east, north, south } = bounds;
        for (let i = 0; i < trackPoints.length; i++) {
          const [lng, lat] = trackPoints[i].coordinates;
          if (lng >= west && lng <= east && lat >= south && lat <= north) return true;
          if (i > 0) {
            const p1 = trackPoints[i - 1].coordinates;
            const p2 = trackPoints[i].coordinates;
            if (lineSegmentIntersects(p1, p2, true, north, west, east) ||
                lineSegmentIntersects(p1, p2, true, south, west, east) ||
                lineSegmentIntersects(p1, p2, false, west, south, north) ||
                lineSegmentIntersects(p1, p2, false, east, south, north)) {
              return true;
            }
          }
        }
        return false;
      };

      for (const hex of hexes) {
        const trace = allTraces[hex];
        const aircraft = positions[hex];

        if (!trace || !trace.properties?.trackPoints) continue;

        const trackPoints = trace.properties.trackPoints;

        if (!traceIntersectsBox(trackPoints)) continue;

        relevantPositions[hex] = aircraft;

        const analysis = analyzeTrack(trackPoints, bounds);
        const anomalies = detectAnomalies(trackPoints, bounds);

        const aircraftData = {
          hex,
          callsign: aircraft.callsign,
          registration: aircraft.registration,
          type: aircraft.type,
          military: aircraft.military,
          special: aircraft.special,
          helicopter: aircraft.helicopter,
          coordinates: aircraft.coordinates,
          analysis,
          anomalies,
        };

        const hasEntry = analysis.events.some((e) => e.type === 'entry');
        const hasExit = analysis.events.some((e) => e.type === 'exit');

        if (hasEntry) entered.push(aircraftData);
        if (hasExit) exited.push(aircraftData);
        if (analysis.currentlyInside) inside.push(aircraftData);

        if (anomalies.altitudeChanges.length > 0 || anomalies.orbiting.length > 0 ||
            anomalies.adsbGaps.length > 0 || anomalies.squawkChanges.length > 0) {
          allAnomalies[hex] = anomalies;
        }
      }

      setAircraftPositions(relevantPositions);
      setAnalysisData({ entered, exited, inside, anomalies: allAnomalies });
    } catch (err) {
      console.error('Aircraft activity analysis error:', err);
    } finally {
      setLoading(false);
    }
  }, [aircraftActivityBox]);

  useEffect(() => {
    if (aircraftActivityBox) {
      analyzeActivity();
    } else {
      setAnalysisData(null);
    }
  }, [aircraftActivityBox, analyzeActivity]);

  const handleFocusAircraft = useCallback(
    (hex, coordinates) => {
      setFocusedAircraft(hex);
      if (mapRef && coordinates) {
        mapRef.flyTo({ center: coordinates, zoom: 12, duration: 1500 });
      }
    },
    [setFocusedAircraft, mapRef]
  );

  const handleClear = () => {
    clearAircraftActivityBox();
    setAnalysisData(null);
  };

  if (!aircraftActivityBox) return null;

  const totalAnomalies = analysisData
    ? Object.values(analysisData.anomalies).reduce(
        (sum, a) => sum + a.altitudeChanges.length + a.orbiting.length + a.adsbGaps.length + a.squawkChanges.length,
        0
      )
    : 0;

  return (
    <div className="absolute bottom-4 right-4 z-20 w-80 max-h-[calc(100vh-120px)] bg-slate-900/95 rounded-lg shadow-xl border border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-white text-sm">{t('aircraftActivity.title', lang)}</div>
          <button onClick={handleClear} className="text-slate-400 hover:text-white text-lg leading-none">
            &times;
          </button>
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          {aircraftActivityBox.widthKm.toFixed(0)}km &times; {aircraftActivityBox.heightKm.toFixed(0)}km | {t('aircraftActivity.last24h', lang)}
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
            <span>{t('aircraftActivity.entered', lang)}</span>
          </button>
          <button
            onClick={() => setExpandedSection('exited')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              expandedSection === 'exited' ? 'bg-red-600/30 text-red-400' : 'text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-bold">{analysisData?.exited.length || 0}</span>
            <span>{t('aircraftActivity.exited', lang)}</span>
          </button>
          <button
            onClick={() => setExpandedSection('inside')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              expandedSection === 'inside' ? 'bg-amber-600/30 text-amber-400' : 'text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-bold">{analysisData?.inside.length || 0}</span>
            <span>{t('aircraftActivity.inside', lang)}</span>
          </button>
        </div>
      </div>

      {/* Aircraft list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="p-4 text-center text-sm">
            <div className="inline-flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-amber-400 animate-pulse">{t('aircraftActivity.analyzing', lang)}</span>
            </div>
          </div>
        ) : !analysisData ? (
          <div className="p-4 text-center text-slate-400 text-sm">{t('aircraftActivity.noAircraft', lang)}</div>
        ) : (
          <>
            <div className="px-3 py-1.5 bg-slate-800/50 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
              {expandedSection === 'entered' && `${t('aircraftActivity.entered', lang)} (${analysisData.entered.length})`}
              {expandedSection === 'exited' && `${t('aircraftActivity.exited', lang)} (${analysisData.exited.length})`}
              {expandedSection === 'inside' && `${t('aircraftActivity.inside', lang)} (${analysisData.inside.length})`}
            </div>

            {expandedSection === 'entered' && analysisData.entered.map((a) => (
              <AircraftItem key={a.hex} aircraft={a} analysis={a.analysis} onFocus={handleFocusAircraft} lang={lang} />
            ))}
            {expandedSection === 'exited' && analysisData.exited.map((a) => (
              <AircraftItem key={a.hex} aircraft={a} analysis={a.analysis} onFocus={handleFocusAircraft} lang={lang} />
            ))}
            {expandedSection === 'inside' && analysisData.inside.map((a) => (
              <AircraftItem key={a.hex} aircraft={a} analysis={a.analysis} onFocus={handleFocusAircraft} lang={lang} />
            ))}

            {expandedSection === 'entered' && analysisData.entered.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('aircraftActivity.noAircraft', lang)}</div>
            )}
            {expandedSection === 'exited' && analysisData.exited.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('aircraftActivity.noAircraft', lang)}</div>
            )}
            {expandedSection === 'inside' && analysisData.inside.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">{t('aircraftActivity.noAircraft', lang)}</div>
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
                {t('aircraftActivity.anomalies', lang)} ({totalAnomalies})
              </span>
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${expandedSection === 'anomalies' ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expandedSection === 'anomalies' && (
              <div className="px-3 pb-2 text-[10px] text-slate-400 space-y-2">
                {Object.entries(analysisData.anomalies).map(([hex, anomalies]) => {
                  const aircraft = aircraftPositions[hex];
                  return (
                    <div key={hex} className="space-y-1">
                      <button
                        onClick={() => handleFocusAircraft(hex, aircraft?.coordinates)}
                        className="text-slate-300 font-medium hover:text-amber-400 cursor-pointer transition-colors"
                      >
                        {aircraft?.callsign || aircraft?.registration || hex}
                      </button>
                      {anomalies.altitudeChanges.length > 0 && (
                        <div className="text-amber-400 pl-2">
                          {anomalies.altitudeChanges.length}x {t('aircraftActivity.altitudeChange', lang)}
                        </div>
                      )}
                      {anomalies.orbiting.length > 0 && (
                        <div className="text-orange-400 pl-2">
                          {anomalies.orbiting.length}x {t('aircraftActivity.orbiting', lang)}
                        </div>
                      )}
                      {anomalies.adsbGaps.length > 0 && (
                        <div className="text-red-400 pl-2">
                          {anomalies.adsbGaps.length}x {t('aircraftActivity.adsbGaps', lang)}
                        </div>
                      )}
                      {anomalies.squawkChanges.length > 0 && (
                        <div className="text-red-500 pl-2">
                          {anomalies.squawkChanges.length}x {t('aircraftActivity.squawkChange', lang)}
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
          onClick={() => analyzeActivity()}
          disabled={loading}
          className="flex-1 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors disabled:opacity-50"
        >
          {t('aircraftActivity.refresh', lang)}
        </button>
        <button
          onClick={handleClear}
          className="flex-1 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
        >
          {t('aircraftActivity.clearArea', lang)}
        </button>
      </div>
    </div>
  );
}
