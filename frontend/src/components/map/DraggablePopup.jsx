import { useState, useRef, useCallback, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

/**
 * DraggablePopup with geo-aware origin tracking.
 * Props:
 *   originLng, originLat — geo-coordinates of the anchor point
 *   originX, originY     — initial screen position (fallback if no geo)
 *   onPin                — called when auto-pinned via drag
 *   showConnectionLine   — whether to show dashed line to origin (default true)
 *   children             — popup content
 */
export default function DraggablePopup({ originLng, originLat, originX, originY, onPin, showConnectionLine = true, children }) {
  const mapRef = useMapStore((s) => s.mapRef);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 }); // offset from projected origin
  const [isDragged, setIsDragged] = useState(false);
  const dragRef = useRef(null);
  const startRef = useRef({ mouseX: 0, mouseY: 0, dx: 0, dy: 0 });
  const isDraggedRef = useRef(false);
  const containerRef = useRef(null);

  // Project geo-origin to current screen position
  function getOriginScreen() {
    if (originLng != null && originLat != null && mapRef) {
      try {
        const pt = mapRef.project([originLng, originLat]);
        return { x: pt.x, y: pt.y };
      } catch { /* fall through */ }
    }
    return { x: originX || 0, y: originY || 0 };
  }

  const origin = getOriginScreen();

  // Clamp popup position to stay within viewport
  const popupEl = containerRef.current;
  let posX = origin.x + offset.dx;
  let posY = origin.y + offset.dy;
  if (popupEl && !isDragged) {
    const rect = popupEl.getBoundingClientRect();
    const popupH = rect.height || 200;
    const popupW = rect.width || 260;
    // If popup would clip above viewport, shift it down
    if (posY - popupH < 0) {
      posY = Math.max(10, posY + popupH + 20);
    }
    // If popup would clip right side
    if (posX + popupW > window.innerWidth) {
      posX = window.innerWidth - popupW - 10;
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
      if (onPin) onPin();
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

    const onMouseUp = () => {
      dragRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [offset, onPin]);

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
            x2={posX + 120}
            y2={posY + 20}
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
