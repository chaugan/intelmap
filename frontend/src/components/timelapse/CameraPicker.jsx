import { useState, useEffect, useCallback } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMonitoringStore } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';

export default function CameraPicker() {
  const cameras = useTimelapseStore((s) => s.cameras);
  const loading = useTimelapseStore((s) => s.loading);
  const selectedCamera = useTimelapseStore((s) => s.selectedCamera);
  const setSelectedCamera = useTimelapseStore((s) => s.setSelectedCamera);
  const setActiveTab = useTimelapseStore((s) => s.setActiveTab);
  const checkUnsubscribe = useTimelapseStore((s) => s.checkUnsubscribe);
  const unsubscribe = useTimelapseStore((s) => s.unsubscribe);
  const lang = useMapStore((s) => s.lang);
  const mapRef = useMapStore((s) => s.mapRef);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const toggleWebcams = useMapStore((s) => s.toggleWebcams);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  // Get monitored camera IDs and highlight function
  const monitoredCameraIds = useMonitoringStore((s) => s.monitoredCameraIds);
  const setHighlightCamera = useMonitoringStore((s) => s.setHighlightCamera);
  const monitoringEnabled = useMonitoringStore((s) => s.enabled);
  const fetchMonitoredCameras = useMonitoringStore((s) => s.fetchMonitoredCameras);

  // Fetch monitored cameras on mount
  useEffect(() => {
    fetchMonitoredCameras();
  }, [fetchMonitoredCameras]);

  const zoomToCamera = useCallback((camera) => {
    if (!mapRef || !camera.lat || !camera.lon) return;
    mapRef.flyTo({
      center: [camera.lon, camera.lat],
      zoom: 14,
      duration: 1500,
    });
    // Enable webcams overlay after animation finishes
    mapRef.once('idle', () => {
      if (!webcamsVisible) {
        toggleWebcams();
      }
    });
  }, [mapRef, webcamsVisible, toggleWebcams]);

  // Handle clicking on monitor icon - switch to monitoring tab and highlight the camera
  const handleMonitorClick = useCallback((cameraId) => {
    setHighlightCamera(cameraId);
    setActiveTab('monitoring');
  }, [setHighlightCamera, setActiveTab]);

  const [confirmDialog, setConfirmDialog] = useState(null);

  const handleUnsubscribe = useCallback(async (camera) => {
    // Check what happens if we unsubscribe
    const check = await checkUnsubscribe(camera.cameraId);

    if (!check.canUnsubscribe) {
      // Show error - can't unsubscribe
      setConfirmDialog({
        camera,
        type: 'blocked',
        message: check.error || (lang === 'no' ? 'Kan ikke avslutte abonnement' : 'Cannot unsubscribe'),
      });
      return;
    }

    // Only show warning if capture will actually stop (user is last subscriber and not protected)
    if (check.willStopCapture) {
      setConfirmDialog({
        camera,
        type: 'warning',
        otherSubscribers: check.otherSubscribers,
        isProtected: check.isProtected,
        willStopCapture: check.willStopCapture,
        isAdmin,
      });
    } else {
      // Others are subscribed or camera is protected - just unsubscribe, recording continues
      await unsubscribe(camera.cameraId);
    }
  }, [checkUnsubscribe, unsubscribe, lang, isAdmin]);

  const confirmUnsubscribe = useCallback(async () => {
    if (confirmDialog?.camera) {
      await unsubscribe(confirmDialog.camera.cameraId, true);
    }
    setConfirmDialog(null);
  }, [confirmDialog, unsubscribe]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        {t('general.loading', lang)}
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
        <svg className="w-16 h-16 mb-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-lg mb-2">{t('timelapse.noSubs', lang)}</p>
        <p className="text-sm text-slate-500">
          {lang === 'no'
            ? 'Klikk på et webkamera på kartet og velg "Start tidslapse"'
            : 'Click a webcam on the map and select "Start timelapse"'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="grid grid-cols-2 gap-3">
        {cameras.map((camera) => (
          <CameraCard
            key={camera.cameraId}
            camera={camera}
            isSelected={selectedCamera?.cameraId === camera.cameraId}
            onSelect={() => setSelectedCamera(camera)}
            onUnsubscribe={() => handleUnsubscribe(camera)}
            onZoom={() => zoomToCamera(camera)}
            isMonitored={monitoringEnabled && monitoredCameraIds.includes(camera.cameraId)}
            onMonitorClick={() => handleMonitorClick(camera.cameraId)}
            lang={lang}
            isAdmin={isAdmin}
          />
        ))}
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmDialog(null)}>
          <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-4 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-3">
              {confirmDialog.type === 'blocked'
                ? (lang === 'no' ? 'Kan ikke avslutte' : 'Cannot Unsubscribe')
                : (lang === 'no' ? 'Bekreft avslutning' : 'Confirm Unsubscribe')}
            </h3>

            {confirmDialog.type === 'blocked' ? (
              <p className="text-slate-300 mb-4">{confirmDialog.message}</p>
            ) : (
              <div className="space-y-2 text-slate-300 mb-4">
                {confirmDialog.otherSubscribers > 0 && (
                  <p className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {lang === 'no'
                      ? `${confirmDialog.otherSubscribers} andre bruker(e) abonnerer på dette kameraet`
                      : `${confirmDialog.otherSubscribers} other user(s) subscribe to this camera`}
                  </p>
                )}
                {confirmDialog.isProtected && (
                  <p className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    {lang === 'no'
                      ? 'Dette kameraet er beskyttet av admin'
                      : 'This camera is protected by admin'}
                  </p>
                )}
                {confirmDialog.willStopCapture && (
                  <p className="text-amber-400 text-sm mt-2">
                    {lang === 'no'
                      ? 'Opptak vil stoppe for alle brukere!'
                      : 'Recording will stop for all users!'}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm transition-colors"
              >
                {t('general.cancel', lang)}
              </button>
              {confirmDialog.type !== 'blocked' && (
                <button
                  onClick={confirmUnsubscribe}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-white text-sm transition-colors"
                >
                  {lang === 'no' ? 'Avslutt likevel' : 'Unsubscribe anyway'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CameraCard({ camera, isSelected, onSelect, onUnsubscribe, onZoom, isMonitored, onMonitorClick, lang, isAdmin }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [thumbnailError, setThumbnailError] = useState(false);

  // Load thumbnail with fetch to include credentials
  const loadThumbnail = useCallback(async () => {
    try {
      // Add cache-busting param to always get latest frame
      const cacheBust = Date.now();
      const res = await fetch(`/api/timelapse/frame/${camera.cameraId}/latest.jpg?t=${cacheBust}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load');
      const blob = await res.blob();
      // Revoke old URL before setting new one
      setThumbnailUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setThumbnailError(false);
    } catch {
      setThumbnailError(true);
    }
  }, [camera.cameraId]);

  // Initial load
  useEffect(() => {
    loadThumbnail();
  }, [loadThumbnail]);

  // Auto-refresh thumbnail every 60s for LIVE cameras
  useEffect(() => {
    if (!camera.isCapturing) return;

    const interval = setInterval(() => {
      loadThumbnail();
    }, 60000); // Refresh every 60 seconds (frames are captured every minute)

    return () => clearInterval(interval);
  }, [camera.isCapturing, loadThumbnail]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  }, []);

  const formatTime = (iso) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString(lang === 'no' ? 'nb-NO' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateTime = (iso) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Human-friendly duration
  const formatDuration = () => {
    if (!camera.availableFrom || !camera.availableTo) return null;
    const from = new Date(camera.availableFrom);
    const to = new Date(camera.availableTo);
    const ms = to - from;
    if (ms <= 0) return null;

    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}${lang === 'no' ? 'd' : 'd'}`);
    if (hours > 0) parts.push(`${hours}${lang === 'no' ? 't' : 'h'}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
  };

  const duration = formatDuration();

  return (
    <div
      className={`relative bg-slate-900 rounded-lg overflow-hidden border transition-all cursor-pointer ${
        isSelected
          ? 'border-cyan-500 ring-2 ring-cyan-500/30'
          : 'border-slate-700 hover:border-slate-600'
      }`}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-slate-800">
        {thumbnailUrl && !thumbnailError ? (
          <img
            src={thumbnailUrl}
            alt={camera.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-2 right-2 flex gap-1">
          {camera.isProtected && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-cyan-600 text-white" title={lang === 'no' ? 'Beskyttet' : 'Protected'}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              camera.isCapturing
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-600 text-slate-300'
            }`}
          >
            {camera.isCapturing ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/* Subscriber count (for admin) */}
        {isAdmin && camera.subscriberCount > 1 && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-xs bg-slate-900/80 text-slate-300">
            {camera.subscriberCount} {lang === 'no' ? 'abonnenter' : 'subscribers'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white truncate flex-1" title={camera.name}>
            {camera.name || camera.cameraId}
          </h3>
          <div className="flex items-center gap-2 ml-2">
            {/* Monitoring indicator - click to go to monitor */}
            {isMonitored && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMonitorClick();
                }}
                className="text-green-400 hover:text-green-300 p-1 cursor-pointer hover:bg-slate-700 rounded transition-colors"
                title={lang === 'no' ? 'Vis monitorering' : 'View monitoring'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            )}
            {/* Zoom to camera button */}
            {camera.lat && camera.lon && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onZoom();
                }}
                className="text-cyan-400 hover:text-cyan-300 p-1 cursor-pointer hover:bg-slate-700 rounded transition-colors"
                title={lang === 'no' ? 'Zoom til kamera' : 'Zoom to camera'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            {/* Unsubscribe button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="text-red-400 hover:text-red-300 p-1 cursor-pointer hover:bg-slate-700 rounded transition-colors"
              title={lang === 'no' ? 'Avslutt abonnement' : 'Unsubscribe'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Time range info */}
        {camera.availableFrom && camera.availableTo && (
          <div className="text-[10px] text-slate-500 mt-1">
            <span>{formatDateTime(camera.availableFrom)}</span>
            <span className="mx-1">-</span>
            <span>{formatDateTime(camera.availableTo)}</span>
          </div>
        )}
        {/* Duration badge */}
        {duration && (
          <div className="mt-1">
            <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/50 text-cyan-300 rounded">
              {lang === 'no' ? 'Opptak' : 'Recording'}: {duration}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
