import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const BOX_SOURCE = 'vessel-activity-box';
const BOX_FILL_LAYER = 'vessel-activity-box-fill';
const BOX_LINE_LAYER = 'vessel-activity-box-line';

// Haversine formula to calculate distance in km
function calculateDistanceKm(p1, p2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Check if box exceeds 100km in either dimension
function getBoxDimensions(nw, se) {
  const width = calculateDistanceKm(
    { lat: nw.lat, lng: nw.lng },
    { lat: nw.lat, lng: se.lng }
  );
  const height = calculateDistanceKm(
    { lat: nw.lat, lng: nw.lng },
    { lat: se.lat, lng: nw.lng }
  );
  return { width, height };
}

function isBoxOversized(nw, se) {
  const { width, height } = getBoxDimensions(nw, se);
  return width > 100 || height > 100;
}

// Create GeoJSON polygon from bounds
function createBoxGeoJSON(bounds) {
  const { west, east, north, south } = bounds;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
          [west, north],
        ],
      ],
    },
  };
}

export default function VesselActivityBox({ mapRef }) {
  const lang = useMapStore((s) => s.lang);
  const drawing = useMapStore((s) => s.vesselActivityDrawing);
  const setDrawing = useMapStore((s) => s.setVesselActivityDrawing);
  const vesselActivityBox = useMapStore((s) => s.vesselActivityBox);
  const setVesselActivityBox = useMapStore((s) => s.setVesselActivityBox);

  const [startPoint, setStartPoint] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [warning, setWarning] = useState(null);
  const tooltipRef = useRef(null);
  const layersAddedRef = useRef(false);

  // Add box layers to map
  const addBoxLayers = useCallback(() => {
    if (!mapRef || layersAddedRef.current) return;

    if (!mapRef.getSource(BOX_SOURCE)) {
      mapRef.addSource(BOX_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!mapRef.getLayer(BOX_FILL_LAYER)) {
      mapRef.addLayer({
        id: BOX_FILL_LAYER,
        type: 'fill',
        source: BOX_SOURCE,
        paint: {
          'fill-color': '#06b6d4',
          'fill-opacity': 0.15,
        },
      });
    }

    if (!mapRef.getLayer(BOX_LINE_LAYER)) {
      mapRef.addLayer({
        id: BOX_LINE_LAYER,
        type: 'line',
        source: BOX_SOURCE,
        paint: {
          'line-color': '#06b6d4',
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      });
    }

    layersAddedRef.current = true;
  }, [mapRef]);

  // Remove box layers from map
  const removeBoxLayers = useCallback(() => {
    if (!mapRef) return;
    try {
      if (mapRef.getLayer(BOX_LINE_LAYER)) mapRef.removeLayer(BOX_LINE_LAYER);
      if (mapRef.getLayer(BOX_FILL_LAYER)) mapRef.removeLayer(BOX_FILL_LAYER);
      if (mapRef.getSource(BOX_SOURCE)) mapRef.removeSource(BOX_SOURCE);
    } catch {}
    layersAddedRef.current = false;
  }, [mapRef]);

  // Update box visualization
  const updateBoxVisualization = useCallback(
    (bounds) => {
      if (!mapRef) return;
      addBoxLayers();
      const src = mapRef.getSource(BOX_SOURCE);
      if (src) {
        src.setData(bounds ? createBoxGeoJSON(bounds) : { type: 'FeatureCollection', features: [] });
      }
    },
    [mapRef, addBoxLayers]
  );

  // Handle existing box display
  useEffect(() => {
    if (!mapRef) return;
    if (vesselActivityBox && !drawing) {
      updateBoxVisualization(vesselActivityBox.bounds);
    } else if (!vesselActivityBox && !drawing) {
      updateBoxVisualization(null);
    }
  }, [mapRef, vesselActivityBox, drawing, updateBoxVisualization]);

  // Drawing mode handlers
  useEffect(() => {
    if (!mapRef || !drawing) return;

    addBoxLayers();
    mapRef.getCanvas().style.cursor = 'crosshair';
    mapRef.dragPan.disable();

    const handleMouseDown = (e) => {
      setStartPoint({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      setCurrentPoint({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };

    const handleMouseMove = (e) => {
      if (!startPoint) {
        // Show tooltip even when not dragging
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${e.point.x + 15}px`;
          tooltipRef.current.style.top = `${e.point.y + 15}px`;
        }
        return;
      }

      const current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      setCurrentPoint(current);

      // Calculate bounds
      const west = Math.min(startPoint.lng, current.lng);
      const east = Math.max(startPoint.lng, current.lng);
      const north = Math.max(startPoint.lat, current.lat);
      const south = Math.min(startPoint.lat, current.lat);
      const bounds = { west, east, north, south };

      // Check dimensions
      const nw = { lat: north, lng: west };
      const se = { lat: south, lng: east };
      const { width, height } = getBoxDimensions(nw, se);

      if (isBoxOversized(nw, se)) {
        setWarning({ width, height });
      } else {
        setWarning(null);
      }

      updateBoxVisualization(bounds);

      // Position tooltip
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${e.point.x + 15}px`;
        tooltipRef.current.style.top = `${e.point.y + 15}px`;
      }
    };

    const handleMouseUp = () => {
      if (!startPoint || !currentPoint) return;

      const west = Math.min(startPoint.lng, currentPoint.lng);
      const east = Math.max(startPoint.lng, currentPoint.lng);
      const north = Math.max(startPoint.lat, currentPoint.lat);
      const south = Math.min(startPoint.lat, currentPoint.lat);
      const bounds = { west, east, north, south };

      const nw = { lat: north, lng: west };
      const se = { lat: south, lng: east };
      const { width, height } = getBoxDimensions(nw, se);

      if (!isBoxOversized(nw, se) && width > 0.5 && height > 0.5) {
        // Valid box - save it
        setVesselActivityBox({ bounds, widthKm: width, heightKm: height });
      }

      // Reset drawing state
      setStartPoint(null);
      setCurrentPoint(null);
      setWarning(null);
      setDrawing(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setStartPoint(null);
        setCurrentPoint(null);
        setWarning(null);
        setDrawing(false);
        updateBoxVisualization(vesselActivityBox?.bounds || null);
      }
    };

    mapRef.on('mousedown', handleMouseDown);
    mapRef.on('mousemove', handleMouseMove);
    mapRef.on('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      mapRef.off('mousedown', handleMouseDown);
      mapRef.off('mousemove', handleMouseMove);
      mapRef.off('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      mapRef.getCanvas().style.cursor = '';
      mapRef.dragPan.enable();
    };
  }, [mapRef, drawing, startPoint, currentPoint, setDrawing, setVesselActivityBox, vesselActivityBox, addBoxLayers, updateBoxVisualization]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeBoxLayers();
    };
  }, [removeBoxLayers]);

  // Calculate current dimensions for display
  const currentDimensions = startPoint && currentPoint
    ? getBoxDimensions(
        { lat: Math.max(startPoint.lat, currentPoint.lat), lng: Math.min(startPoint.lng, currentPoint.lng) },
        { lat: Math.min(startPoint.lat, currentPoint.lat), lng: Math.max(startPoint.lng, currentPoint.lng) }
      )
    : null;

  if (!drawing) return null;

  return (
    <>
      {/* Dimension tooltip */}
      <div
        ref={tooltipRef}
        className="fixed pointer-events-none z-50"
        style={{ display: currentDimensions ? 'block' : 'none' }}
      >
        <div
          className={`px-3 py-1.5 rounded text-xs font-medium shadow-lg ${
            warning ? 'bg-red-600 text-white' : 'bg-cyan-600 text-white'
          }`}
        >
          {currentDimensions && (
            <>
              {currentDimensions.width.toFixed(1)} km &times; {currentDimensions.height.toFixed(1)} km
              {warning && (
                <div className="text-[10px] opacity-90 mt-0.5">
                  {t('vesselActivity.tooLarge', lang)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drawing mode indicator */}
      {!startPoint && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-40">
          <div className="bg-slate-900/90 text-white px-4 py-2 rounded-lg text-sm">
            {lang === 'no' ? 'Dra for \u00e5 tegne overv\u00e5kningsomr\u00e5de' : 'Drag to draw monitoring area'}
            <div className="text-slate-400 text-xs mt-1">
              {lang === 'no' ? 'Trykk Esc for \u00e5 avbryte' : 'Press Esc to cancel'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
