import { useState, useRef, useCallback, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

/**
 * DraggablePopup with geo-aware origin tracking.
 * Props:
 *   originLng, originLat — geo-coordinates of the anchor point
 *   originX, originY     — initial screen position (fallback if no geo)
 *   initialDisplayLng, initialDisplayLat — saved display position to restore
 *   onPin                — called when auto-pinned via drag
 *   showConnectionLine   — whether to show dashed line to origin (default true)
 *   children             — popup content
 */
export default function DraggablePopup({ originLng, originLat, originX, originY, initialDisplayLng, initialDisplayLat, onPin, onDragEnd, showConnectionLine = true, children }) {
  const mapRef = useMapStore((s) => s.mapRef);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 }); // offset from projected origin
  const [isDragged, setIsDragged] = useState(false);
  const dragRef = useRef(null);
  const startRef = useRef({ mouseX: 0, mouseY: 0, dx: 0, dy: 0 });
  const isDraggedRef = useRef(false);
  const containerRef = useRef(null);
  const initializedRef = useRef(false);

  // Get map container offset for coordinate conversion (canvas → viewport)
  function getMapOffset() {
    if (!mapRef) return { left: 0, top: 0 };
    try {
      const rect = mapRef.getContainer().getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    } catch { return { left: 0, top: 0 }; }
  }

  // Project geo-origin to canvas-relative screen position
  function getOriginCanvas() {
    if (originLng != null && originLat != null && mapRef) {
      try {
        const pt = mapRef.project([originLng, originLat]);
        return { x: pt.x, y: pt.y };
      } catch { /* fall through */ }
    }
    // Fallback: convert viewport coords to canvas-relative
    const mo = getMapOffset();
    return { x: (originX || 0) - mo.left, y: (originY || 0) - mo.top };
  }

  // Restore saved display position on first mount
  useEffect(() => {
    if (initializedRef.current) return;
    if (initialDisplayLng == null || initialDisplayLat == null || !mapRef) return;
    try {
      const originPt = mapRef.project([originLng, originLat]);
      const displayPt = mapRef.project([initialDisplayLng, initialDisplayLat]);
      setOffset({ dx: displayPt.x - originPt.x, dy: displayPt.y - originPt.y });
      setIsDragged(true);
      isDraggedRef.current = true;
      initializedRef.current = true;
    } catch {}
  }, [mapRef, initialDisplayLng, initialDisplayLat, originLng, originLat]);

  const origin = getOriginCanvas();
  const mapOffset = getMapOffset();

  // Canvas-relative position (for SVG connection line)
  let canvasX = origin.x + offset.dx;
  let canvasY = origin.y + offset.dy;

  // Viewport-relative position (for fixed popup)
  let posX = canvasX + mapOffset.left;
  let posY = canvasY + mapOffset.top;

  // Clamp popup position to stay within viewport
  const popupEl = containerRef.current;
  if (popupEl && !isDragged) {
    const rect = popupEl.getBoundingClientRect();
    const popupH = rect.height || 200;
    const popupW = rect.width || 260;
    if (posY - popupH < 0) {
      const shift = popupH + 20;
      canvasY += shift;
      posY += shift;
    }
    if (posX + popupW > window.innerWidth) {
      posX = window.innerWidth - popupW - 10;
      canvasX = posX - mapOffset.left;
    }
  }

  // Force re-render when map moves so origin tracks the geo-coordinate
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!mapRef) return;
    const onMove = () => forceUpdate((n) => n + 1);
    mapRef.on('move', onMove);
    return () => mapRef.off('move', onMove);
  }, [mapRef]);

  const onMouseDown = useCallback((e) => {
    if (!e.target.closest('.context-menu-header') && !e.target.closest('.draggable-header')) return;
    e.preventDefault();
    e.stopPropagation();

    // Auto-pin immediately on mousedown to prevent the menu from being closed during drag
    if (!isDraggedRef.current) {
      isDraggedRef.current = true;
      setIsDragged(true);
      if (onPin) {
        // Compute current display position as geo-coords so the pin saves its position
        if (mapRef) {
          try {
            const pinCanvasX = origin.x + offset.dx;
            const pinCanvasY = origin.y + offset.dy;
            const lngLat = mapRef.unproject([pinCanvasX, pinCanvasY]);
            onPin({ lng: lngLat.lng, lat: lngLat.lat });
          } catch { onPin(); }
        } else {
          onPin();
        }
      }
    }

    startRef.current = { mouseX: e.clientX, mouseY: e.clientY, dx: offset.dx, dy: offset.dy };
    dragRef.current = true;

    const onMouseMove = (e) => {
      if (!dragRef.current) return;
      const ddx = e.clientX - startRef.current.mouseX;
      const ddy = e.clientY - startRef.current.mouseY;
      setOffset({
        dx: startRef.current.dx + ddx,
        dy: startRef.current.dy + ddy,
      });
    };

    const onMouseUp = (e) => {
      dragRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      // Report final position to parent for persistence
      if (onDragEnd && mapRef) {
        try {
          const finalCanvasX = origin.x + startRef.current.dx + (e.clientX - startRef.current.mouseX);
          const finalCanvasY = origin.y + startRef.current.dy + (e.clientY - startRef.current.mouseY);
          const lngLat = mapRef.unproject([finalCanvasX, finalCanvasY]);
          onDragEnd({ lng: lngLat.lng, lat: lngLat.lat });
        } catch {}
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [offset, onPin, onDragEnd, mapRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousedown', onMouseDown);
    return () => el.removeEventListener('mousedown', onMouseDown);
  }, [onMouseDown]);

  return (
    <>
      {/* Connection line from geo-origin to current popup position */}
      {showConnectionLine && isDragged && (
        <svg
          className="absolute inset-0 pointer-events-none z-[49]"
          style={{ width: '100%', height: '100%' }}
        >
          <line
            x1={origin.x}
            y1={origin.y}
            x2={canvasX + 120}
            y2={canvasY + 20}
            stroke="#000000"
            strokeWidth="3.5"
            strokeDasharray="8 5"
            opacity="0.9"
          />
          <circle cx={origin.x} cy={origin.y} r="5" fill="#000000" opacity="0.9" />
        </svg>
      )}
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          left: posX,
          top: posY,
          zIndex: 50,
          cursor: 'default',
        }}
      >
        {children}
      </div>
    </>
  );
}
