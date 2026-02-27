import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function CameraPicker() {
  const cameras = useTimelapseStore((s) => s.cameras);
  const loading = useTimelapseStore((s) => s.loading);
  const selectedCamera = useTimelapseStore((s) => s.selectedCamera);
  const setSelectedCamera = useTimelapseStore((s) => s.setSelectedCamera);
  const unsubscribe = useTimelapseStore((s) => s.unsubscribe);
  const lang = useMapStore((s) => s.lang);

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
            onUnsubscribe={() => unsubscribe(camera.cameraId)}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
}

function CameraCard({ camera, isSelected, onSelect, onUnsubscribe, lang }) {
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
        <img
          src={`/api/timelapse/frame/${camera.cameraId}/latest.jpg`}
          alt={camera.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />

        {/* Status badge */}
        <div
          className={`absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium ${
            camera.isCapturing
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-600 text-slate-300'
          }`}
        >
          {camera.isCapturing ? 'LIVE' : 'OFFLINE'}
        </div>
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
