import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import TimelineSlider from './TimelineSlider.jsx';

export default function TimelapsePlayer() {
  const selectedCamera = useTimelapseStore((s) => s.selectedCamera);
  const playbackSpeed = useTimelapseStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useTimelapseStore((s) => s.setPlaybackSpeed);
  const isPlaying = useTimelapseStore((s) => s.isPlaying);
  const setIsPlaying = useTimelapseStore((s) => s.setIsPlaying);
  const isLive = useTimelapseStore((s) => s.isLive);
  const goLive = useTimelapseStore((s) => s.goLive);
  const getPlaylistUrl = useTimelapseStore((s) => s.getPlaylistUrl);
  const getFrameUrl = useTimelapseStore((s) => s.getFrameUrl);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const lang = useMapStore((s) => s.lang);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loop, setLoop] = useState(true); // Loop enabled by default

  // Initialize HLS.js
  useEffect(() => {
    if (!selectedCamera || !videoRef.current) return;

    const video = videoRef.current;
    const playlistUrl = getPlaylistUrl(selectedCamera.cameraId);

    setLoading(true);
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        if (isPlaying) video.play();
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          setError(lang === 'no' ? 'Kunne ikke laste video' : 'Failed to load video');
          setLoading(false);
        }
      });

      hlsRef.current = hls;

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = playlistUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        if (isPlaying) video.play();
      });
    } else {
      setError(lang === 'no' ? 'HLS ikke støttet i denne nettleseren' : 'HLS not supported in this browser');
      setLoading(false);
    }
  }, [selectedCamera, getPlaylistUrl, lang]);

  // Update playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Handle play/pause state
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Handle loop state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.loop = loop;
    }
  }, [loop]);

  // Track video time
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
    setDuration(videoRef.current.duration || 0);
  }, []);

  // Get duration as soon as metadata loads (before play)
  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
    setLoading(false);
  }, []);

  // Seek to time
  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }, []);

  // Pause video (called when user interacts with timeline)
  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  // Save current frame (captures from video canvas, not server)
  const saveFrame = useCallback(() => {
    if (!selectedCamera || !videoRef.current) return;

    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('Video not ready');
      return;
    }

    // Create canvas and draw current video frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Generate timestamp for filename based on video position
    const videoTime = video.currentTime || 0;
    const availableFrom = selectedCamera.availableFrom ? new Date(selectedCamera.availableFrom) : null;
    let frameDate;
    if (availableFrom && duration > 0) {
      // Calculate actual timestamp of this frame
      const msPerSecond = (new Date(selectedCamera.availableTo) - availableFrom) / duration;
      frameDate = new Date(availableFrom.getTime() + videoTime * msPerSecond);
    } else {
      frameDate = new Date();
    }
    const timestamp = `${frameDate.getFullYear()}-${String(frameDate.getMonth() + 1).padStart(2, '0')}-${String(frameDate.getDate()).padStart(2, '0')}_${String(frameDate.getHours()).padStart(2, '0')}-${String(frameDate.getMinutes()).padStart(2, '0')}-${String(frameDate.getSeconds()).padStart(2, '0')}`;

    // Download as JPEG
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${selectedCamera.name || selectedCamera.cameraId}_${timestamp}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/jpeg', 0.95);
  }, [selectedCamera, duration]);

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

  const speeds = [0.5, 1, 2, 4, 8];

  return (
    <div className="flex flex-col h-full">
      {/* Video */}
      <div className="relative bg-black flex-shrink-0">
        <div className="aspect-video relative">
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
                <p className="text-sm text-slate-500 mt-2">
                  {lang === 'no'
                    ? 'Tidslapse-data genereres kanskje fortsatt...'
                    : 'Timelapse data may still be generating...'}
                </p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            className="w-full h-full"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            playsInline
            muted
            loop={loop}
          />
        </div>

        {/* Camera name overlay */}
        <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-white text-sm">
          {selectedCamera.name || selectedCamera.cameraId}
        </div>
      </div>

      {/* Timeline */}
      <div className="p-4 bg-slate-850 border-t border-slate-700">
        <TimelineSlider
          camera={selectedCamera}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          onPause={handlePause}
        />
      </div>

      {/* Controls */}
      <div className="px-4 py-3 bg-slate-900 border-t border-slate-700 shrink-0">
        <div className="flex items-center justify-between">
          {/* Play/Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
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
              isLive
                ? 'bg-red-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            LIVE
          </button>

          {/* Save frame */}
          <button
            onClick={saveFrame}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white transition-colors"
            title={t('timelapse.saveFrame', lang)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        {/* Current time display */}
        <div className="mt-2 text-center text-xs text-slate-400">
          {currentTime !== null && duration > 0 && (
            <span>
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
