import { useState, useCallback, useRef, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

export default function TimelineSlider({ camera, currentTime, duration, onSeek, onPause }) {
  const lang = useMapStore((s) => s.lang);
  const sliderRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  // Calculate available time range from camera data
  const availableFrom = camera?.availableFrom ? new Date(camera.availableFrom) : null;
  const availableTo = camera?.availableTo ? new Date(camera.availableTo) : null;
  const timeRangeMs = availableFrom && availableTo ? (availableTo - availableFrom) : 0;

  // Use video duration if available, otherwise estimate from time range
  // At 10fps playback, 1 frame per minute capture = 10fps * 60 = duration in seconds
  const effectiveDuration = duration > 0 ? duration : (timeRangeMs / 60000 / 10); // rough estimate

  // Handle click/drag on slider - allow even before video loads
  const handleInteraction = useCallback((clientX) => {
    if (!sliderRef.current) return;
    if (effectiveDuration <= 0 && timeRangeMs <= 0) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;

    // Only seek if we have actual video duration
    if (duration > 0) {
      const newTime = percent * duration;
      onSeek(newTime);
    }
  }, [duration, effectiveDuration, timeRangeMs, onSeek]);

  const handlePointerDown = useCallback((e) => {
    setIsDragging(true);
    // Pause video when user clicks on timeline
    if (onPause) onPause();
    handleInteraction(e.clientX);
  }, [handleInteraction, onPause]);

  const handlePointerMove = useCallback((e) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));

    setHoverX(x);
    setHoverPercent(percent);

    if (isDragging && duration > 0) {
      handleInteraction(e.clientX);
    }
  }, [isDragging, duration, handleInteraction]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setHoverPercent(null);
    setIsDragging(false);
  }, []);

  // Global pointer handlers for dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMove = (e) => handlePointerMove(e);
      const handleGlobalUp = () => setIsDragging(false);

      document.addEventListener('pointermove', handleGlobalMove);
      document.addEventListener('pointerup', handleGlobalUp);

      return () => {
        document.removeEventListener('pointermove', handleGlobalMove);
        document.removeEventListener('pointerup', handleGlobalUp);
      };
    }
  }, [isDragging, handlePointerMove]);

  const progress = effectiveDuration > 0 ? (currentTime || 0) / effectiveDuration : 0;

  // Calculate hover date/time based on position in time range
  const getDateAtPercent = (percent) => {
    if (!availableFrom || !availableTo) return null;
    const timeAtPercent = availableFrom.getTime() + (percent * timeRangeMs);
    return new Date(timeAtPercent);
  };

  // Generate day markers for time range
  const dayMarkers = [];
  if (availableFrom && availableTo && timeRangeMs > 0) {
    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = Math.ceil(timeRangeMs / dayMs);

    for (let i = 0; i <= Math.min(rangeDays, 7); i++) {
      const date = new Date(availableFrom.getTime() + i * dayMs);
      date.setHours(0, 0, 0, 0);

      if (date >= availableFrom && date <= availableTo) {
        const percent = (date - availableFrom) / timeRangeMs;
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

  // Format date/time for tooltip
  const formatDateTime = (date) => {
    if (!date) return '--';
    return date.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Human-friendly duration
  const formatDurationHuman = (ms) => {
    if (!ms || ms <= 0) return '--';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} ${lang === 'no' ? (days === 1 ? 'dag' : 'dager') : (days === 1 ? 'day' : 'days')}`);
    if (hours > 0) parts.push(`${hours} ${lang === 'no' ? (hours === 1 ? 'time' : 'timer') : (hours === 1 ? 'hour' : 'hours')}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);

    return parts.join(', ');
  };

  return (
    <div className="space-y-2">
      {/* Duration info */}
      {timeRangeMs > 0 && (
        <div className="text-center text-xs text-cyan-400 mb-1">
          {lang === 'no' ? 'Varighet' : 'Duration'}: {formatDurationHuman(timeRangeMs)}
        </div>
      )}

      {/* Timeline bar */}
      <div
        ref={sliderRef}
        className="relative h-6 bg-slate-700 rounded-full cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
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

        {/* Hover tooltip - show date/time */}
        {hoverPercent !== null && !isDragging && (
          <div
            className="absolute -top-10 transform -translate-x-1/2 px-2 py-1 bg-slate-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-10"
            style={{ left: hoverX }}
          >
            {formatDateTime(getDateAtPercent(hoverPercent))}
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
        <span>{formatDateTime(availableFrom)}</span>
        <span>{formatDateTime(availableTo)}</span>
      </div>
    </div>
  );
}
