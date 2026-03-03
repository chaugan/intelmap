import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import html2canvas from 'html2canvas-pro';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';
import ExportMenu from '../common/ExportMenu.jsx';

// Detect stops: periods of ~0 speed for 1+ hour after moving for 1+ hour
function detectStops(trackPoints) {
  const MIN_STOP_DURATION = 60; // minutes at speed ~ 0
  const MIN_MOVE_DURATION = 60; // minutes at speed > 1 kt before new stop
  const STOP_SPEED_THRESHOLD = 0.5; // knots
  const MOVE_SPEED_THRESHOLD = 1.0; // knots

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
      // Vessel stopped
      if (!currentStop && movingMinutes >= MIN_MOVE_DURATION) {
        currentStop = {
          startIndex: i,
          startTime: pt.timestamp,
          coordinates: pt.coordinates,
        };
      }
      movingMinutes = 0;
    } else if (pt.speed != null && pt.speed > MOVE_SPEED_THRESHOLD) {
      // Vessel moving
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

  // Handle stop at end of track
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

// Format duration in hours/minutes
function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Format timestamp
function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleString('no-NO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format speed
function formatSpeed(kts) {
  if (kts == null) return 'N/A';
  return `${kts.toFixed(1)} kn`;
}

// Calculate stats from track points
function calculateStats(trackPoints) {
  if (!trackPoints || trackPoints.length === 0) return null;

  const speeds = trackPoints.filter(p => p.speed != null).map(p => p.speed);
  if (speeds.length === 0) return null;

  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxSpeed = Math.max(...speeds);
  const minTime = new Date(trackPoints[0].timestamp);
  const maxTime = new Date(trackPoints[trackPoints.length - 1].timestamp);
  const durationMs = maxTime - minTime;

  return {
    avgSpeed,
    maxSpeed,
    startTime: trackPoints[0].timestamp,
    endTime: trackPoints[trackPoints.length - 1].timestamp,
    durationMs,
  };
}

// Mini-map component showing historical position
function HistoricalMiniMap({ selectedPoint, trackPoints, selectedIndex, baseLayer }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !selectedPoint) return;

    // Get map style URL based on base layer
    const styleUrl = baseLayer === 'osm'
      ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      : 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseLayer === 'osm'
        ? styleUrl
        : {
            version: 8,
            sources: {
              'kartverket': {
                type: 'raster',
                tiles: [styleUrl],
                tileSize: 256,
                attribution: '&copy; Kartverket',
              },
            },
            layers: [{
              id: 'background',
              type: 'raster',
              source: 'kartverket',
            }],
          },
      center: selectedPoint.coordinates,
      zoom: 11,
      interactive: true,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Add trace up to selected time
      const traceUpToTime = trackPoints.slice(0, selectedIndex + 1);
      if (traceUpToTime.length > 1) {
        map.addSource('historical-trace', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: traceUpToTime.map(p => p.coordinates),
            },
          },
          lineMetrics: true,
        });

        map.addLayer({
          id: 'historical-trace-line',
          type: 'line',
          source: 'historical-trace',
          paint: {
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0, '#06b6d4', // cyan (oldest)
              1, '#fbbf24', // yellow (selected time)
            ],
            'line-width': 3,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      // Add vessel marker at selected position
      const el = document.createElement('div');
      el.innerHTML = `<svg width="24" height="24" viewBox="0 0 48 48" style="transform: rotate(${selectedPoint.heading || selectedPoint.course || 0}deg)">
        <path d="M24 4 L19 16 L17 18 L17 38 L19 40 L29 40 L31 38 L31 18 L29 16 Z" fill="#fbbf24" stroke="#000" stroke-width="2"/>
      </svg>`;
      el.style.cursor = 'default';

      new maplibregl.Marker({ element: el })
        .setLngLat(selectedPoint.coordinates)
        .addTo(map);
    });

    mapRef.current = map;
    return () => map.remove();
  }, [selectedPoint, trackPoints, selectedIndex, baseLayer]);

  return (
    <div
      ref={containerRef}
      className="w-full h-48 rounded-lg overflow-hidden border border-slate-600"
    />
  );
}

// Main deep analysis component
export default function VesselDeepAnalysis({ vessel, traceData, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const [expanded, setExpanded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  // WaSOS integration
  const user = useAuthStore((s) => s.user);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);

  // Parse track points from trace data
  const trackPoints = useMemo(() => {
    if (!traceData?.properties?.trackPoints) return [];
    // BarentsWatch returns newest-first, so reverse to oldest-first
    return [...traceData.properties.trackPoints].reverse();
  }, [traceData]);

  // Calculate stats and detect stops
  const stats = useMemo(() => calculateStats(trackPoints), [trackPoints]);
  const stops = useMemo(() => detectStops(trackPoints), [trackPoints]);

  // Export to disk
  const handleSaveReport = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(containerRef.current, {
        scale: 2,
        backgroundColor: '#0f172a',
        useCORS: true,
        allowTaint: true,
      });
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

  // Transfer to WaSOS
  const handleWasosUpload = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(containerRef.current, {
        scale: 2,
        backgroundColor: '#0f172a',
        useCORS: true,
        allowTaint: true,
      });
      const imageData = canvas.toDataURL('image/png');
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `vessel_analysis_${vessel?.mmsi || 'unknown'}_${localTime}.png`;

      // Get coordinates from vessel
      const coords = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].coordinates : null;

      setExpanded(false);
      prepareWasosUpload(imageData, coords, filename);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (!trackPoints || trackPoints.length < 2) {
    return (
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-slate-800/95 rounded-lg shadow-xl p-4 min-w-[300px] text-center">
        <div className="text-slate-400 text-sm">{t('vessel.noTrackData', lang)}</div>
        <button
          onClick={onClose}
          className="mt-2 text-slate-400 hover:text-white text-sm"
        >
          {t('general.close', lang)}
        </button>
      </div>
    );
  }

  // SVG dimensions
  const width = expanded ? 1100 : 580;
  const height = expanded ? 280 : 160;
  const padding = {
    top: expanded ? 25 : 15,
    right: expanded ? 30 : 15,
    bottom: expanded ? 45 : 28,
    left: expanded ? 60 : 45,
  };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Time range
  const startTime = new Date(trackPoints[0].timestamp).getTime();
  const endTime = new Date(trackPoints[trackPoints.length - 1].timestamp).getTime();
  const timeRange = endTime - startTime || 1;

  // Speed range (with padding)
  const speeds = trackPoints.filter(p => p.speed != null).map(p => p.speed);
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 10;
  const speedRange = maxSpeed * 1.15;

  // Build path for speed line
  const pathPoints = trackPoints
    .filter(p => p.speed != null)
    .map((p, i, arr) => {
      const x = padding.left + ((new Date(p.timestamp).getTime() - startTime) / timeRange) * chartWidth;
      const y = padding.top + chartHeight - (p.speed / speedRange) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  // Create filled area path
  const areaPath = pathPoints +
    ` L ${padding.left + chartWidth} ${padding.top + chartHeight}` +
    ` L ${padding.left} ${padding.top + chartHeight} Z`;

  // Y-axis labels
  const yLabelCount = expanded ? 6 : 4;
  const yLabels = [];
  for (let i = 0; i < yLabelCount; i++) {
    yLabels.push((speedRange * i) / (yLabelCount - 1));
  }

  // X-axis labels (time)
  const xLabelCount = expanded ? 8 : 5;
  const xLabels = [];
  for (let i = 0; i < xLabelCount; i++) {
    const time = startTime + (timeRange * i) / (xLabelCount - 1);
    xLabels.push(time);
  }

  // Handle mouse move for scrubber
  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const scaleX = width / rect.width;
    const x = svgX * scaleX;

    if (x >= padding.left && x <= padding.left + chartWidth) {
      const fraction = (x - padding.left) / chartWidth;
      const targetTime = startTime + fraction * timeRange;

      // Find closest track point
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < trackPoints.length; i++) {
        const diff = Math.abs(new Date(trackPoints[i].timestamp).getTime() - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }

      const pt = trackPoints[closestIdx];
      const lineX = padding.left + ((new Date(pt.timestamp).getTime() - startTime) / timeRange) * chartWidth;
      const speedY = pt.speed != null
        ? padding.top + chartHeight - (pt.speed / speedRange) * chartHeight
        : null;

      setHoverInfo({ point: pt, index: closestIdx, lineX, speedY });
    } else {
      setHoverInfo(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
  };

  // Handle click to select point for mini-map
  const handleChartClick = () => {
    if (hoverInfo) {
      setSelectedPoint(hoverInfo.point);
      setSelectedIndex(hoverInfo.index);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      setExpanded(false);
    }
  };

  const fontSize = expanded ? 13 : 10;

  const containerClass = expanded
    ? "bg-slate-900 rounded-lg shadow-2xl p-5"
    : "bg-slate-800/95 rounded-lg shadow-xl p-3 min-w-[600px]";

  const content = (
    <div className={containerClass} ref={containerRef} style={expanded ? { width: '85vw', maxWidth: '1200px', maxHeight: '90vh', overflow: 'auto' } : undefined}>
      {/* Header */}
      <div className={`flex justify-between items-start ${expanded ? 'mb-3' : 'mb-2'}`}>
        <div>
          <div className={`text-white font-semibold ${expanded ? 'text-xl' : 'text-base'}`}>
            {vessel?.name || `MMSI ${vessel?.mmsi}`}
            {vessel?.countryCode && (
              <span className="ml-2 text-slate-400 text-sm font-normal">{vessel.countryCode}</span>
            )}
          </div>
          <div className="text-slate-400 text-xs">
            MMSI: {vessel?.mmsi}
            {vessel?.imoNumber && ` | IMO: ${vessel.imoNumber}`}
            {vessel?.imoNumber && (
              <a
                href={`https://www.vesselfinder.com/vessels/details/${vessel.imoNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-cyan-400 hover:text-cyan-300"
              >
                {t('vessel.viewOnVesselFinder', lang)} &nearr;
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded && user?.wasosEnabled ? (
            <ExportMenu
              onSaveToDisk={handleSaveReport}
              onTransferToWasos={handleWasosUpload}
              wasosLoggedIn={wasosLoggedIn}
              buttonIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
              buttonClassName="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
              disabled={exporting}
            />
          ) : expanded ? (
            <button
              onClick={handleSaveReport}
              disabled={exporting}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
              title={t('measure.export', lang)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          ) : null}
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
            &times;
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mb-3 text-sm' : 'mb-2 text-xs'} flex-wrap`}>
        <span>
          <span className="text-slate-500">{t('vessel.trackPeriod', lang)}:</span>{' '}
          {stats ? formatTime(stats.startTime) : '—'} &mdash; {stats ? formatTime(stats.endTime) : '—'}
        </span>
        <span className="text-cyan-400">
          {t('vessel.avgSpeed', lang)}: {stats ? formatSpeed(stats.avgSpeed) : '—'}
        </span>
        <span className="text-green-400">
          {t('vessel.maxSpeed', lang)}: {stats ? formatSpeed(stats.maxSpeed) : '—'}
        </span>
        <span className="text-red-400">
          {t('vessel.stopCount', lang)}: {stops.length}
        </span>
      </div>

      {/* Speed-Time Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`rounded ${expanded ? 'bg-slate-800 w-full' : 'bg-slate-900/50 w-full'}`}
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: expanded ? '300px' : '160px', cursor: 'crosshair' }}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleChartClick}
      >
        {/* Grid lines - horizontal */}
        {yLabels.map((speed, i) => {
          const y = padding.top + chartHeight - (speed / speedRange) * chartHeight;
          return (
            <g key={`y-${i}`}>
              <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y}
                stroke="#374151" strokeWidth="1" />
              <text x={padding.left - 6} y={y + 4} textAnchor="end"
                fill="#9ca3af" fontSize={fontSize}>{speed.toFixed(0)}</text>
            </g>
          );
        })}

        {/* X-axis labels (time) */}
        {xLabels.map((time, i) => {
          const x = padding.left + (i / (xLabelCount - 1)) * chartWidth;
          const d = new Date(time);
          const label = d.toLocaleString('no-NO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return (
            <g key={`x-${i}`}>
              <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartHeight}
                stroke="#374151" strokeWidth="1" />
              <text x={x} y={height - (expanded ? 8 : 5)} textAnchor="middle"
                fill="#9ca3af" fontSize={expanded ? 11 : 8}>{label}</text>
            </g>
          );
        })}

        {/* Stop periods (red vertical bands) */}
        {stops.map((stop, i) => {
          const startX = padding.left + ((new Date(stop.startTime).getTime() - startTime) / timeRange) * chartWidth;
          const endX = padding.left + ((new Date(stop.endTime).getTime() - startTime) / timeRange) * chartWidth;
          return (
            <g key={`stop-${i}`}>
              <rect
                x={startX}
                y={padding.top}
                width={Math.max(endX - startX, 4)}
                height={chartHeight}
                fill="#ef4444"
                fillOpacity="0.2"
              />
              <line x1={startX} y1={padding.top} x2={startX} y2={padding.top + chartHeight}
                stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" />
              {/* Stop icon at top */}
              <circle cx={(startX + endX) / 2} cy={padding.top + 10} r={expanded ? 8 : 6} fill="#ef4444" />
              <text x={(startX + endX) / 2} y={padding.top + (expanded ? 14 : 12)} textAnchor="middle"
                fill="#fff" fontSize={expanded ? 10 : 7} fontWeight="bold">S</text>
            </g>
          );
        })}

        {/* Gradient definition */}
        <defs>
          <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0e7490" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Filled area */}
        {pathPoints && <path d={areaPath} fill="url(#speedGradient)" />}

        {/* Speed line */}
        {pathPoints && (
          <path d={pathPoints} fill="none" stroke="#06b6d4" strokeWidth={expanded ? 2 : 1.5} strokeLinejoin="round" />
        )}

        {/* Scrubber vertical line */}
        {hoverInfo && (
          <>
            <line
              x1={hoverInfo.lineX}
              y1={padding.top}
              x2={hoverInfo.lineX}
              y2={padding.top + chartHeight}
              stroke="#fbbf24"
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
            {hoverInfo.speedY != null && (
              <circle
                cx={hoverInfo.lineX}
                cy={hoverInfo.speedY}
                r={expanded ? 5 : 4}
                fill="#fbbf24"
                stroke="#fff"
                strokeWidth={1.5}
              />
            )}
          </>
        )}

        {/* Selected point marker */}
        {selectedPoint && selectedIndex != null && (
          (() => {
            const x = padding.left + ((new Date(selectedPoint.timestamp).getTime() - startTime) / timeRange) * chartWidth;
            const y = selectedPoint.speed != null
              ? padding.top + chartHeight - (selectedPoint.speed / speedRange) * chartHeight
              : padding.top + chartHeight;
            return (
              <circle
                cx={x}
                cy={y}
                r={expanded ? 7 : 5}
                fill="#22c55e"
                stroke="#fff"
                strokeWidth={2}
              />
            );
          })()
        )}

        {/* Axis labels */}
        <text x={padding.left + chartWidth / 2} y={height - 1} textAnchor="middle"
          fill="#64748b" fontSize={expanded ? 11 : 9}>{lang === 'no' ? 'Tid' : 'Time'}</text>
        <text x={expanded ? 14 : 8} y={padding.top + chartHeight / 2} textAnchor="middle"
          fill="#64748b" fontSize={expanded ? 11 : 9}
          transform={`rotate(-90, ${expanded ? 14 : 8}, ${padding.top + chartHeight / 2})`}>
          {lang === 'no' ? 'Hastighet (kn)' : 'Speed (kn)'}
        </text>
      </svg>

      {/* Scrubber info display */}
      <div className={`flex gap-4 text-slate-300 ${expanded ? 'mt-3 text-sm' : 'mt-2 text-xs'} bg-slate-700/50 rounded px-3 py-1.5`}>
        <span>
          {lang === 'no' ? 'Tid' : 'Time'}:{' '}
          <strong className="text-white">{hoverInfo ? formatTime(hoverInfo.point.timestamp) : '—'}</strong>
        </span>
        <span>
          {t('vessel.avgSpeed', lang).replace('Gj.snitt', 'Hastighet').replace('Avg', 'Speed')}:{' '}
          <strong className="text-cyan-400">{hoverInfo?.point.speed != null ? formatSpeed(hoverInfo.point.speed) : '—'}</strong>
        </span>
        <span>
          {lang === 'no' ? 'Kurs' : 'Course'}:{' '}
          <strong className="text-white">{hoverInfo?.point.course != null ? `${hoverInfo.point.course.toFixed(0)}\u00b0` : '—'}</strong>
        </span>
        <span className="text-slate-500 ml-auto">
          {t('vessel.clickToSeePosition', lang)}
        </span>
      </div>

      {/* Mini-map (when point selected) */}
      {selectedPoint && expanded && (
        <div className="mt-3">
          <div className="text-slate-400 text-xs mb-1">
            {t('vessel.historicalPosition', lang)}: {formatTime(selectedPoint.timestamp)}
            {selectedPoint.speed != null && ` | ${formatSpeed(selectedPoint.speed)}`}
          </div>
          <HistoricalMiniMap
            selectedPoint={selectedPoint}
            trackPoints={trackPoints}
            selectedIndex={selectedIndex}
            baseLayer={baseLayer}
          />
        </div>
      )}

      {/* Compact mini-map hint for non-expanded */}
      {selectedPoint && !expanded && (
        <div className="mt-2 text-xs text-slate-500 text-center">
          {t('vessel.historicalPosition', lang)}: {formatTime(selectedPoint.timestamp)} &mdash;{' '}
          <button onClick={() => setExpanded(true)} className="text-cyan-400 hover:text-cyan-300">
            {t('measure.expand', lang)}
          </button>
        </div>
      )}
    </div>
  );

  // Use portal for expanded mode
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

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
      {content}
    </div>
  );
}
