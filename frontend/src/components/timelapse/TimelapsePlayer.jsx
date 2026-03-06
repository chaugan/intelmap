import { useEffect, useRef, useState, useCallback } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { drawSecurityMarking } from '../../lib/export-marking.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';
import ExportMenu from '../common/ExportMenu.jsx';

/**
 * Frame-based timelapse player
 * Loads individual frames as images for perfect seeking and speed control
 */
export default function TimelapsePlayer() {
  const selectedCamera = useTimelapseStore((s) => s.selectedCamera);
  const playbackSpeed = useTimelapseStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useTimelapseStore((s) => s.setPlaybackSpeed);
  const isPlaying = useTimelapseStore((s) => s.isPlaying);
  const setIsPlaying = useTimelapseStore((s) => s.setIsPlaying);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);

  // Frame data
  const [frames, setFrames] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loop, setLoop] = useState(true);
  const [liveMode, setLiveMode] = useState(false);

  // Preloaded images for smooth playback
  const preloadedImages = useRef(new Map());
  const playIntervalRef = useRef(null);
  const liveIntervalRef = useRef(null);
  const canvasRef = useRef(null);
  const currentImageRef = useRef(null);

  // Reset when camera changes - always start from beginning
  useEffect(() => {
    setIsPlaying(false);
    setLiveMode(false);
    setCurrentIndex(0);
    setFrames([]);
    preloadedImages.current.clear();
  }, [selectedCamera?.cameraId, setIsPlaying]);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      setIsPlaying(false);
      setLiveMode(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
      }
    };
  }, [setIsPlaying]);

  // Fetch frame list
  useEffect(() => {
    if (!selectedCamera) return;

    const fetchFrames = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch frame list (up to 10000 frames for 7 days)
        const res = await fetch(`/api/timelapse/frames/${selectedCamera.cameraId}?limit=10000`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch frames');

        const data = await res.json();
        if (data.length === 0) {
          throw new Error(lang === 'no' ? 'Ingen bilder tilgjengelig' : 'No frames available');
        }

        setFrames(data);
        setCurrentIndex(0); // Always start from beginning
        setLoading(false);

        // Preload first few frames
        preloadFrames(data, 0, 10);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchFrames();
  }, [selectedCamera, lang]);

  // Preload frames around current position
  const preloadFrames = useCallback((frameList, startIdx, count) => {
    if (!selectedCamera) return;

    const toLoad = [];
    for (let i = startIdx; i < Math.min(startIdx + count, frameList.length); i++) {
      const frame = frameList[i];
      if (!preloadedImages.current.has(frame.filename)) {
        toLoad.push(frame);
      }
    }

    toLoad.forEach((frame) => {
      const img = new Image();
      img.src = `/api/timelapse/frame/${selectedCamera.cameraId}/${frame.timestamp}.jpg`;
      img.onload = () => {
        preloadedImages.current.set(frame.filename, img);
        // Limit cache size to prevent memory issues
        if (preloadedImages.current.size > 200) {
          const firstKey = preloadedImages.current.keys().next().value;
          preloadedImages.current.delete(firstKey);
        }
      };
    });
  }, [selectedCamera]);

  // Display current frame
  useEffect(() => {
    if (frames.length === 0 || !selectedCamera || !canvasRef.current) return;

    const frame = frames[currentIndex];
    if (!frame) return;

    const displayFrame = (img) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');

      // Set canvas size to match image
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      ctx.drawImage(img, 0, 0);
      currentImageRef.current = img;
    };

    // Check if preloaded
    const cached = preloadedImages.current.get(frame.filename);
    if (cached && cached.complete) {
      displayFrame(cached);
    } else {
      // Load on demand
      const img = new Image();
      img.src = `/api/timelapse/frame/${selectedCamera.cameraId}/${frame.timestamp}.jpg`;
      img.onload = () => {
        preloadedImages.current.set(frame.filename, img);
        displayFrame(img);
      };
      img.onerror = () => {
        console.error('Failed to load frame:', frame.filename);
      };
    }

    // Preload upcoming frames
    preloadFrames(frames, currentIndex + 1, 20);
  }, [currentIndex, frames, selectedCamera, preloadFrames]);

  // Playback control
  useEffect(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (!isPlaying || frames.length === 0) return;

    // Base: 1 frame per 100ms at 1x speed (10 fps)
    // At 8x: 1 frame per 12.5ms
    const intervalMs = Math.max(10, 100 / playbackSpeed);

    playIntervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= frames.length) {
          if (loop) {
            return 0; // Loop back to start
          } else {
            setIsPlaying(false);
            return prev; // Stay at end
          }
        }
        return next;
      });
    }, intervalMs);

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, playbackSpeed, frames.length, loop, setIsPlaying]);

  // Spacebar play/pause toggle
  useEffect(() => {
    if (!selectedCamera) return;

    const handleKeyDown = (e) => {
      // Exclude inputs, textareas, and buttons (buttons would double-toggle via click)
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
        e.preventDefault();
        // Get current state from store and toggle
        const current = useTimelapseStore.getState().isPlaying;
        setIsPlaying(!current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCamera, setIsPlaying]);

  const stepForward = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
    setLiveMode(false);
    setCurrentIndex((prev) => Math.min(prev + 1, frames.length - 1));
  }, [frames.length, setIsPlaying]);

  const stepBackward = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
    setLiveMode(false);
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, [setIsPlaying]);

  // Keep refs in sync so the single keydown listener always uses latest functions
  const stepForwardRef = useRef(stepForward);
  const stepBackwardRef = useRef(stepBackward);
  stepForwardRef.current = stepForward;
  stepBackwardRef.current = stepBackward;

  // Arrow key stepping — single stable listener via refs
  useEffect(() => {
    if (!selectedCamera) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepForwardRef.current();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepBackwardRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCamera]);

  // Seek to specific time (from timeline slider)
  const handleSeek = useCallback((percent) => {
    if (frames.length === 0) return;
    setLiveMode(false); // Exit live mode when seeking
    const index = Math.round(percent * (frames.length - 1));
    setCurrentIndex(Math.max(0, Math.min(index, frames.length - 1)));
  }, [frames.length]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    setLiveMode(false); // Exit live mode when pausing
  }, [setIsPlaying]);

  // Go to live mode - show latest frame and keep updating
  const goLive = useCallback(() => {
    if (frames.length > 0) {
      setCurrentIndex(frames.length - 1);
    }
    setLiveMode(true);
    setIsPlaying(false); // Not playing through old frames, just showing live
  }, [frames.length, setIsPlaying]);

  // Exit live mode
  const exitLiveMode = useCallback(() => {
    setLiveMode(false);
  }, []);

  // Live mode: poll for new frames every 10 seconds
  useEffect(() => {
    if (!liveMode || !selectedCamera) {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
      return;
    }

    const pollForNewFrames = async () => {
      try {
        const res = await fetch(`/api/timelapse/frames/${selectedCamera.cameraId}?limit=10000`, {
          credentials: 'include',
        });
        if (!res.ok) return;

        const newFrames = await res.json();
        if (newFrames.length > frames.length) {
          // New frames available - update and show latest
          setFrames(newFrames);
          setCurrentIndex(newFrames.length - 1);

          // Preload the new frame
          const latestFrame = newFrames[newFrames.length - 1];
          if (latestFrame) {
            const img = new Image();
            img.src = `/api/timelapse/frame/${selectedCamera.cameraId}/${latestFrame.timestamp}.jpg`;
            img.onload = () => {
              preloadedImages.current.set(latestFrame.filename, img);
            };
          }
        }
      } catch (err) {
        console.error('Live mode poll error:', err);
      }
    };

    // Poll immediately, then every 10 seconds
    pollForNewFrames();
    liveIntervalRef.current = setInterval(pollForNewFrames, 10000);

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [liveMode, selectedCamera, frames.length]);

  // Get frame filename helper
  const getFrameFilename = useCallback(() => {
    if (!selectedCamera || frames.length === 0) return null;
    const frame = frames[currentIndex];
    if (!frame) return null;
    const date = new Date(frame.timestamp);
    const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
    return `${selectedCamera.name || selectedCamera.cameraId}_${timestamp}.jpg`;
  }, [selectedCamera, currentIndex, frames]);

  // Save current frame to disk
  const saveFrame = useCallback(() => {
    if (!selectedCamera || !currentImageRef.current || frames.length === 0) return;

    const filename = getFrameFilename();
    if (!filename) return;

    const canvas = document.createElement('canvas');
    canvas.width = currentImageRef.current.width;
    canvas.height = currentImageRef.current.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(currentImageRef.current, 0, 0);

    const user = useAuthStore.getState().user;
    if (user?.exportMarking && user.exportMarking !== 'none') {
      drawSecurityMarking(ctx, canvas.width, canvas.height, user.exportMarking, user.exportMarkingCorner, user.exportMarkingText);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/jpeg', 0.95);
  }, [selectedCamera, frames, getFrameFilename]);

  // Transfer current frame to WaSOS
  const transferFrameToWasos = useCallback(() => {
    if (!selectedCamera || !currentImageRef.current || frames.length === 0) return;

    const filename = getFrameFilename();
    if (!filename) return;

    const canvas = document.createElement('canvas');
    canvas.width = currentImageRef.current.width;
    canvas.height = currentImageRef.current.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(currentImageRef.current, 0, 0);

    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    const coords = selectedCamera.lat && selectedCamera.lon
      ? [selectedCamera.lon, selectedCamera.lat]
      : null;
    prepareWasosUpload(imageData, coords, filename);
  }, [selectedCamera, frames, getFrameFilename, prepareWasosUpload]);

  // Calculate current time info for timeline
  const currentFrame = frames[currentIndex];
  const currentTimestamp = currentFrame ? new Date(currentFrame.timestamp) : null;
  const progress = frames.length > 1 ? currentIndex / (frames.length - 1) : 0;

  if (!selectedCamera) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
        <svg className="w-16 h-16 mb-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-lg mb-2">
          {lang === 'no' ? 'Velg et kamera' : 'Select a camera'}
        </p>
        <button
          onClick={() => setActiveTab('cameras')}
          className="mt-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 rounded text-white text-sm transition-colors"
        >
          {t('timelapse.cameras', lang)}
        </button>
      </div>
    );
  }

  const speeds = [0.5, 1, 2, 4, 8, 16];

  return (
    <div className="flex flex-col h-full">
      {/* Video / Frame display */}
      <div className="relative bg-black flex-shrink-0">
        <div className="aspect-video relative flex items-center justify-center">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <svg className="w-8 h-8 animate-spin text-cyan-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-red-400">
              <div className="text-center p-4">
                <p>{error}</p>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain"
          />
        </div>

        {/* Camera name overlay */}
        <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-white text-sm">
          {selectedCamera.name || selectedCamera.cameraId}
        </div>

        {/* Current timestamp overlay */}
        {currentTimestamp && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 rounded text-white text-sm font-mono">
            {currentTimestamp.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="p-4 bg-slate-850 border-t border-slate-700">
        <FrameTimelineSlider
          camera={selectedCamera}
          frames={frames}
          currentIndex={currentIndex}
          progress={progress}
          onSeek={handleSeek}
          onPause={handlePause}
          lang={lang}
        />
      </div>

      {/* Controls */}
      <div className="px-4 py-3 bg-slate-900 border-t border-slate-700 shrink-0">
        <div className="flex items-center justify-between">
          {/* Playback controls group */}
          <div className="flex items-center gap-1">
            {/* Step backward */}
            <button
              onClick={(e) => { e.currentTarget.blur(); stepBackward(); }}
              disabled={currentIndex === 0}
              className="w-8 h-8 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-50"
              title={lang === 'no' ? 'Forrige bilde (←)' : 'Previous frame (←)'}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
              </svg>
            </button>

            {/* Play/Pause */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={frames.length === 0}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50"
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Step forward */}
            <button
              onClick={(e) => { e.currentTarget.blur(); stepForward(); }}
              disabled={currentIndex >= frames.length - 1}
              className="w-8 h-8 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-50"
              title={lang === 'no' ? 'Neste bilde (→)' : 'Next frame (→)'}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-2">{t('timelapse.speed', lang)}:</span>
            {speeds.map((speed) => (
              <button
                key={speed}
                onClick={() => setPlaybackSpeed(speed)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  playbackSpeed === speed
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Loop toggle */}
          <button
            onClick={() => setLoop(!loop)}
            className={`px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-1 ${
              loop
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
            title={loop
              ? (lang === 'no' ? 'Loop aktivert' : 'Loop enabled')
              : (lang === 'no' ? 'Loop deaktivert' : 'Loop disabled')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Live button */}
          <button
            onClick={goLive}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              liveMode
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {liveMode ? '● LIVE' : 'LIVE'}
          </button>

          {/* Save frame */}
          {user?.wasosEnabled ? (
            <ExportMenu
              onSaveToDisk={saveFrame}
              onTransferToWasos={transferFrameToWasos}
              wasosLoggedIn={wasosLoggedIn}
              buttonIcon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
              buttonClassName="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white transition-colors disabled:opacity-50 flex items-center"
              disabled={frames.length === 0}
            />
          ) : (
            <button
              onClick={saveFrame}
              disabled={frames.length === 0}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white transition-colors disabled:opacity-50"
              title={t('timelapse.saveFrame', lang)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Simplified timeline slider for frame-based player
 */
function FrameTimelineSlider({ camera, frames, currentIndex, progress, onSeek, onPause, lang }) {
  const sliderRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  // Use actual frame timestamps for accurate time range (updates in live mode)
  const firstFrame = frames.length > 0 ? frames[0] : null;
  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : null;
  const availableFrom = firstFrame ? new Date(firstFrame.timestamp) : (camera?.availableFrom ? new Date(camera.availableFrom) : null);
  const availableTo = lastFrame ? new Date(lastFrame.timestamp) : (camera?.availableTo ? new Date(camera.availableTo) : null);
  const timeRangeMs = availableFrom && availableTo ? (availableTo - availableFrom) : 0;

  const handleInteraction = useCallback((clientX) => {
    if (!sliderRef.current || frames.length === 0) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    onSeek(percent);
  }, [frames.length, onSeek]);

  const handlePointerDown = useCallback((e) => {
    setIsDragging(true);
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

    if (isDragging) {
      handleInteraction(e.clientX);
    }
  }, [isDragging, handleInteraction]);

  const handlePointerLeave = useCallback(() => {
    setHoverPercent(null);
    if (!isDragging) setIsDragging(false);
  }, [isDragging]);

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

  // Get timestamp at percent
  const getDateAtPercent = (percent) => {
    if (frames.length === 0) return null;
    const index = Math.round(percent * (frames.length - 1));
    const frame = frames[Math.max(0, Math.min(index, frames.length - 1))];
    return frame ? new Date(frame.timestamp) : null;
  };

  // Generate day markers
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

  const formatDateTime = (date) => {
    if (!date) return '--';
    return date.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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
      {timeRangeMs > 0 && (
        <div className="text-center text-xs text-cyan-400 mb-1">
          {lang === 'no' ? 'Varighet' : 'Duration'}: {formatDurationHuman(timeRangeMs)}
        </div>
      )}

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

        {/* Hover tooltip */}
        {hoverPercent !== null && !isDragging && (
          <div
            className="absolute -top-10 transform -translate-x-1/2 px-2 py-1 bg-slate-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-10"
            style={{ left: hoverX }}
          >
            {formatDateTime(getDateAtPercent(hoverPercent))}
          </div>
        )}
      </div>

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

      <div className="flex justify-between text-xs text-slate-500">
        <span>{formatDateTime(availableFrom)}</span>
        <span>{formatDateTime(availableTo)}</span>
      </div>
    </div>
  );
}
