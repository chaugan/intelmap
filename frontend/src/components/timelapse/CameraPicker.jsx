import { useState, useEffect, useCallback } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';

export default function CameraPicker() {
  const cameras = useTimelapseStore((s) => s.cameras);
  const loading = useTimelapseStore((s) => s.loading);
  const selectedCamera = useTimelapseStore((s) => s.selectedCamera);
  const setSelectedCamera = useTimelapseStore((s) => s.setSelectedCamera);
  const checkUnsubscribe = useTimelapseStore((s) => s.checkUnsubscribe);
  const unsubscribe = useTimelapseStore((s) => s.unsubscribe);
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

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

    if (check.otherSubscribers > 0 || check.isProtected) {
      // Show warning dialog
      setConfirmDialog({
        camera,
        type: 'warning',
        otherSubscribers: check.otherSubscribers,
        isProtected: check.isProtected,
        willStopCapture: check.willStopCapture,
        isAdmin,
      });
    } else {
      // Just unsubscribe directly
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

function CameraCard({ camera, isSelected, onSelect, onUnsubscribe, lang, isAdmin }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [thumbnailError, setThumbnailError] = useState(false);

  // Load thumbnail with fetch to include credentials (cache bust with timestamp)
  useEffect(() => {
    let cancelled = false;
    const loadThumbnail = async () => {
      try {
        // Add cache-busting param to always get latest frame
        const cacheBust = Date.now();
        const res = await fetch(`/api/timelapse/frame/${camera.cameraId}/latest.jpg?t=${cacheBust}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to load');
        const blob = await res.blob();
        if (!cancelled) {
          // Revoke old URL before setting new one
          if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
          setThumbnailUrl(URL.createObjectURL(blob));
          setThumbnailError(false);
        }
      } catch {
        if (!cancelled) setThumbnailError(true);
      }
    };
    loadThumbnail();
    return () => {
      cancelled = true;
    };
  }, [camera.cameraId, camera.lastFrameAt]); // Refetch when lastFrameAt changes

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  }, [thumbnailUrl]);

  const formatTime = (iso) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString(lang === 'no' ? 'nb-NO' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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
        <h3 className="text-sm font-medium text-white truncate" title={camera.name}>
          {camera.name || camera.cameraId}
        </h3>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-slate-400">
            {camera.lastFrameAt ? formatTime(camera.lastFrameAt) : '--'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnsubscribe();
            }}
            className="text-xs text-red-400 hover:text-red-300 px-1"
            title={lang === 'no' ? 'Avslutt abonnement' : 'Unsubscribe'}
          >
            {'\u2715'}
          </button>
        </div>
      </div>
    </div>
  );
}
