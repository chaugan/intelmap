import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
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

  // State for clamped position (calculated after first render)
  const [clampedPos, setClampedPos] = useState({ posX, posY, canvasX, canvasY, ready: false });

  // Clamp popup position to stay within viewport (all edges)
  useLayoutEffect(() => {
    const popupEl = containerRef.current;
    if (!popupEl || isDragged) {
      setClampedPos({ posX, posY, canvasX, canvasY, ready: true });
      return;
    }

    const rect = popupEl.getBoundingClientRect();
    const popupH = rect.height || 200;
    const popupW = rect.width || 260;
    const padding = 10;

    let newPosX = posX;
    let newPosY = posY;
    let newCanvasX = canvasX;
    let newCanvasY = canvasY;

    // Clamp bottom edge
    if (newPosY + popupH > window.innerHeight - padding) {
      const shift = newPosY + popupH - (window.innerHeight - padding);
      newCanvasY -= shift;
      newPosY -= shift;
    }
    // Clamp top edge
    if (newPosY < padding) {
      const shift = padding - newPosY;
      newCanvasY += shift;
      newPosY += shift;
    }
    // Clamp right edge
    if (newPosX + popupW > window.innerWidth - padding) {
      newPosX = window.innerWidth - popupW - padding;
      newCanvasX = newPosX - mapOffset.left;
    }
    // Clamp left edge
    if (newPosX < padding) {
      newPosX = padding;
      newCanvasX = newPosX - mapOffset.left;
    }

    setClampedPos({ posX: newPosX, posY: newPosY, canvasX: newCanvasX, canvasY: newCanvasY, ready: true });
  }, [posX, posY, canvasX, canvasY, isDragged, mapOffset.left]);

  // Use clamped position for rendering
  const finalPosX = clampedPos.ready ? clampedPos.posX : posX;
  const finalPosY = clampedPos.ready ? clampedPos.posY : posY;
  const finalCanvasX = clampedPos.ready ? clampedPos.canvasX : canvasX;
  const finalCanvasY = clampedPos.ready ? clampedPos.canvasY : canvasY;

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

  const onTouchDown = useCallback((e) => {
    if (!e.target.closest('.context-menu-header') && !e.target.closest('.draggable-header')) return;
    const touch = e.touches[0];
    e.preventDefault();

    if (!isDraggedRef.current) {
      isDraggedRef.current = true;
      setIsDragged(true);
      if (onPin) {
        if (mapRef) {
          try {
            const pinCanvasX = origin.x + offset.dx;
            const pinCanvasY = origin.y + offset.dy;
            const lngLat = mapRef.unproject([pinCanvasX, pinCanvasY]);
            onPin({ lng: lngLat.lng, lat: lngLat.lat });
          } catch { onPin(); }
        } else { onPin(); }
      }
    }

    startRef.current = { mouseX: touch.clientX, mouseY: touch.clientY, dx: offset.dx, dy: offset.dy };
    dragRef.current = true;

    const onTouchMove = (e) => {
      if (!dragRef.current) return;
      const t = e.touches[0];
      setOffset({
        dx: startRef.current.dx + (t.clientX - startRef.current.mouseX),
        dy: startRef.current.dy + (t.clientY - startRef.current.mouseY),
      });
    };

    const onTouchEnd = (e) => {
      dragRef.current = false;
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      if (onDragEnd && mapRef) {
        try {
          const ct = e.changedTouches[0];
          const finalCanvasX = origin.x + startRef.current.dx + (ct.clientX - startRef.current.mouseX);
          const finalCanvasY = origin.y + startRef.current.dy + (ct.clientY - startRef.current.mouseY);
          const lngLat = mapRef.unproject([finalCanvasX, finalCanvasY]);
          onDragEnd({ lng: lngLat.lng, lat: lngLat.lat });
        } catch {}
      }
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }, [offset, onPin, onDragEnd, mapRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchDown, { passive: false });
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('touchstart', onTouchDown);
    };
  }, [onMouseDown, onTouchDown]);

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
            x2={finalCanvasX + 120}
            y2={finalCanvasY + 20}
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
          left: finalPosX,
          top: finalPosY,
          zIndex: 50,
          cursor: 'default',
          visibility: clampedPos.ready ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>
  );
}
