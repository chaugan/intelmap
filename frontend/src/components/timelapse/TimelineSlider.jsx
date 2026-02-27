import { useState, useCallback, useRef, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

export default function TimelineSlider({ camera, currentTime, duration, onSeek }) {
  const lang = useMapStore((s) => s.lang);
  const sliderRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  // Calculate available time range from camera data
  const availableFrom = camera?.availableFrom ? new Date(camera.availableFrom) : null;
  const availableTo = camera?.availableTo ? new Date(camera.availableTo) : null;

  // Handle click/drag on slider
  const handleInteraction = useCallback((clientX) => {
    if (!sliderRef.current || duration <= 0) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const newTime = percent * duration;
    onSeek(newTime);
  }, [duration, onSeek]);

  const handleMouseDown = useCallback((e) => {
    setIsDragging(true);
    handleInteraction(e.clientX);
  }, [handleInteraction]);

  const handleMouseMove = useCallback((e) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));

    setHoverX(x);
    setHoverTime(percent * duration);

    if (isDragging) {
      handleInteraction(e.clientX);
    }
  }, [isDragging, duration, handleInteraction]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
    setIsDragging(false);
  }, []);

  // Global mouse handlers for dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMove = (e) => handleMouseMove(e);
      const handleGlobalUp = () => setIsDragging(false);

      document.addEventListener('mousemove', handleGlobalMove);
      document.addEventListener('mouseup', handleGlobalUp);

      return () => {
        document.removeEventListener('mousemove', handleGlobalMove);
        document.removeEventListener('mouseup', handleGlobalUp);
      };
    }
  }, [isDragging, handleMouseMove]);

  const progress = duration > 0 ? (currentTime || 0) / duration : 0;

  // Generate day markers for 7-day range
  const dayMarkers = [];
  if (availableFrom && availableTo) {
    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = Math.ceil((availableTo - availableFrom) / dayMs);

    for (let i = 0; i <= Math.min(rangeDays, 7); i++) {
      const date = new Date(availableFrom.getTime() + i * dayMs);
      date.setHours(0, 0, 0, 0);

      if (date >= availableFrom && date <= availableTo) {
        const percent = (date - availableFrom) / (availableTo - availableFrom);
        dayMarkers.push({
          percent,
          label: date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-US', {
            month: 'short',
            day: 'numeric',
          }),
        });
      }
    }
  }

  return (
    <div className="space-y-2">
      {/* Timeline bar */}
      <div
        ref={sliderRef}
        className="relative h-6 bg-slate-700 rounded-full cursor-pointer"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />

        {/* Day markers */}
        {dayMarkers.map((marker, i) => (
          <div
            key={i}
            className="absolute top-0 h-full w-px bg-slate-500/50"
            style={{ left: `${marker.percent * 100}%` }}
          />
        ))}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-cyan-500 transition-all"
          style={{ left: `calc(${progress * 100}% - 8px)` }}
        />

        {/* Hover tooltip */}
        {hoverTime !== null && !isDragging && (
          <div
            className="absolute -top-8 transform -translate-x-1/2 px-2 py-1 bg-slate-900 text-white text-xs rounded shadow-lg whitespace-nowrap"
            style={{ left: hoverX }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Day labels */}
      {dayMarkers.length > 0 && (
        <div className="relative h-4">
          {dayMarkers.map((marker, i) => (
            <span
              key={i}
              className="absolute text-[10px] text-slate-500 transform -translate-x-1/2"
              style={{ left: `${marker.percent * 100}%` }}
            >
              {marker.label}
            </span>
          ))}
          <span className="absolute right-0 text-[10px] text-emerald-400 font-medium">
            {lang === 'no' ? 'NÅ' : 'NOW'}
          </span>
        </div>
      )}

      {/* Time range info */}
      <div className="flex justify-between text-xs text-slate-500">
        <span>
          {availableFrom
            ? availableFrom.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '--'}
        </span>
        <span>
          {availableTo
            ? availableTo.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '--'}
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
