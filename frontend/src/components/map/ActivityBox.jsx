import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

// Haversine formula to calculate distance in km
function calculateDistanceKm(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

function createBoxGeoJSON(bounds) {
  const { west, east, north, south } = bounds;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, north], [east, north], [east, south], [west, south], [west, north],
      ]],
    },
  };
}

export default function ActivityBox({ mapRef, sourceId, color, maxSizeKm, drawing, setDrawing, box, setBox, tooLargeKey }) {
  const lang = useMapStore((s) => s.lang);
  const fillLayerId = `${sourceId}-fill`;
  const lineLayerId = `${sourceId}-line`;

  const [startPoint, setStartPoint] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [warning, setWarning] = useState(null);
  const tooltipRef = useRef(null);
  const layersAddedRef = useRef(false);

  const addBoxLayers = useCallback(() => {
    if (!mapRef || layersAddedRef.current) return;

    if (!mapRef.getSource(sourceId)) {
      mapRef.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!mapRef.getLayer(fillLayerId)) {
      mapRef.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: { 'fill-color': color, 'fill-opacity': 0.15 },
      });
    }

    if (!mapRef.getLayer(lineLayerId)) {
      mapRef.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [3, 2] },
      });
    }

    layersAddedRef.current = true;
  }, [mapRef, sourceId, fillLayerId, lineLayerId, color]);

  const removeBoxLayers = useCallback(() => {
    if (!mapRef) return;
    try {
      if (mapRef.getLayer(lineLayerId)) mapRef.removeLayer(lineLayerId);
      if (mapRef.getLayer(fillLayerId)) mapRef.removeLayer(fillLayerId);
      if (mapRef.getSource(sourceId)) mapRef.removeSource(sourceId);
    } catch {}
    layersAddedRef.current = false;
  }, [mapRef, sourceId, fillLayerId, lineLayerId]);

  const updateBoxVisualization = useCallback(
    (bounds) => {
      if (!mapRef) return;
      addBoxLayers();
      const src = mapRef.getSource(sourceId);
      if (src) {
        src.setData(bounds ? createBoxGeoJSON(bounds) : { type: 'FeatureCollection', features: [] });
      }
    },
    [mapRef, addBoxLayers, sourceId]
  );

  // Handle existing box display
  useEffect(() => {
    if (!mapRef) return;
    if (box && !drawing) {
      updateBoxVisualization(box.bounds);
    } else if (!box && !drawing) {
      updateBoxVisualization(null);
    }
  }, [mapRef, box, drawing, updateBoxVisualization]);

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
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${e.point.x + 15}px`;
          tooltipRef.current.style.top = `${e.point.y + 15}px`;
        }
        return;
      }

      const current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      setCurrentPoint(current);

      const west = Math.min(startPoint.lng, current.lng);
      const east = Math.max(startPoint.lng, current.lng);
      const north = Math.max(startPoint.lat, current.lat);
      const south = Math.min(startPoint.lat, current.lat);
      const bounds = { west, east, north, south };

      const nw = { lat: north, lng: west };
      const se = { lat: south, lng: east };
      const { width, height } = getBoxDimensions(nw, se);

      if (width > maxSizeKm || height > maxSizeKm) {
        setWarning({ width, height });
      } else {
        setWarning(null);
      }

      updateBoxVisualization(bounds);

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

      if (width <= maxSizeKm && height <= maxSizeKm && width > 0.5 && height > 0.5) {
        setBox({ bounds, widthKm: width, heightKm: height });
      }

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
        updateBoxVisualization(box?.bounds || null);
      }
    };

    mapRef.on('mousedown', handleMouseDown);
    mapRef.on('mousemove', handleMouseMove);
    mapRef.on('mouseup', handleMouseUp);
    mapRef.on('touchstart', handleMouseDown);
    mapRef.on('touchmove', handleMouseMove);
    mapRef.on('touchend', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      mapRef.off('mousedown', handleMouseDown);
      mapRef.off('mousemove', handleMouseMove);
      mapRef.off('mouseup', handleMouseUp);
      mapRef.off('touchstart', handleMouseDown);
      mapRef.off('touchmove', handleMouseMove);
      mapRef.off('touchend', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      mapRef.getCanvas().style.cursor = '';
      mapRef.dragPan.enable();
    };
  }, [mapRef, drawing, startPoint, currentPoint, setDrawing, setBox, box, maxSizeKm, addBoxLayers, updateBoxVisualization]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { removeBoxLayers(); };
  }, [removeBoxLayers]);

  const currentDimensions = startPoint && currentPoint
    ? getBoxDimensions(
        { lat: Math.max(startPoint.lat, currentPoint.lat), lng: Math.min(startPoint.lng, currentPoint.lng) },
        { lat: Math.min(startPoint.lat, currentPoint.lat), lng: Math.max(startPoint.lng, currentPoint.lng) }
      )
    : null;

  if (!drawing) return null;

  const warningColor = color === '#f59e0b' ? 'bg-red-600' : 'bg-red-600';
  const normalColor = color === '#f59e0b' ? 'bg-amber-600' : 'bg-cyan-600';

  return (
    <>
      <div
        ref={tooltipRef}
        className="fixed pointer-events-none z-50"
        style={{ display: currentDimensions ? 'block' : 'none' }}
      >
        <div className={`px-3 py-1.5 rounded text-xs font-medium shadow-lg ${warning ? warningColor : normalColor} text-white`}>
          {currentDimensions && (
            <>
              {currentDimensions.width.toFixed(1)} km &times; {currentDimensions.height.toFixed(1)} km
              {warning && (
                <div className="text-[10px] opacity-90 mt-0.5">
                  {t(tooLargeKey, lang)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
