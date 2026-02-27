import { useState, useEffect } from 'react';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function ExportPanel() {
  const cameras = useTimelapseStore((s) => s.cameras);
  const exports = useTimelapseStore((s) => s.exports);
  const exportsLoading = useTimelapseStore((s) => s.exportsLoading);
  const fetchExports = useTimelapseStore((s) => s.fetchExports);
  const createExport = useTimelapseStore((s) => s.createExport);
  const deleteExport = useTimelapseStore((s) => s.deleteExport);
  const getExportDownloadUrl = useTimelapseStore((s) => s.getExportDownloadUrl);
  const lang = useMapStore((s) => s.lang);

  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);

  // Set default dates (last 24 hours) in local time
  useEffect(() => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Format as local datetime string for datetime-local input
    const toLocalDatetime = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    setEndDate(toLocalDatetime(now));
    setStartDate(toLocalDatetime(yesterday));
  }, []);

  // Refresh exports periodically while any are processing
  useEffect(() => {
    const hasProcessing = exports.some((e) => e.status === 'pending' || e.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(fetchExports, 3000);
    return () => clearInterval(interval);
  }, [exports, fetchExports]);

  const handleCreateExport = async () => {
    if (!selectedCameraId || !startDate || !endDate) return;

    setCreating(true);
    await createExport(
      selectedCameraId,
      new Date(startDate).toISOString(),
      new Date(endDate).toISOString()
    );
    setCreating(false);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso) => {
    if (!iso) return '--';
    return new Date(iso).toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusColors = {
    pending: 'bg-yellow-600',
    processing: 'bg-blue-600',
    completed: 'bg-emerald-600',
    failed: 'bg-red-600',
    expired: 'bg-slate-600',
  };

  const statusLabels = {
    pending: lang === 'no' ? 'Venter' : 'Pending',
    processing: lang === 'no' ? 'Behandler' : 'Processing',
    completed: lang === 'no' ? 'Ferdig' : 'Completed',
    failed: lang === 'no' ? 'Feilet' : 'Failed',
    expired: lang === 'no' ? 'Utløpt' : 'Expired',
  };

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      {/* Create new export */}
      <div className="bg-slate-900 rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white">
          {t('timelapse.exportMp4', lang)}
        </h3>

        {cameras.length === 0 ? (
          <p className="text-slate-500 text-sm">
            {lang === 'no'
              ? 'Du må abonnere på et kamera først'
              : 'You need to subscribe to a camera first'}
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {lang === 'no' ? 'Kamera' : 'Camera'}
              </label>
              <select
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="">
                  {lang === 'no' ? '-- Velg kamera --' : '-- Select camera --'}
                </option>
                {cameras.map((cam) => (
                  <option key={cam.cameraId} value={cam.cameraId}>
                    {cam.name || cam.cameraId}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {lang === 'no' ? 'Fra' : 'From'}
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {lang === 'no' ? 'Til' : 'To'}
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <button
              onClick={handleCreateExport}
              disabled={!selectedCameraId || !startDate || !endDate || creating}
              className="w-full px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-white text-sm font-medium transition-colors"
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {lang === 'no' ? 'Oppretter...' : 'Creating...'}
                </span>
              ) : (
                t('timelapse.exportMp4', lang)
              )}
            </button>
          </>
        )}
      </div>

      {/* Export list */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">
          {lang === 'no' ? 'Dine eksporter' : 'Your exports'}
        </h3>

        {exportsLoading && exports.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <svg className="w-6 h-6 animate-spin mx-auto mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            {t('general.loading', lang)}
          </div>
        ) : exports.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            {lang === 'no' ? 'Ingen eksporter ennå' : 'No exports yet'}
          </p>
        ) : (
          <div className="space-y-2">
            {exports.map((exp) => (
              <div
                key={exp.id}
                className="bg-slate-900 rounded-lg p-3 flex items-center gap-3"
              >
                {/* Status */}
                <div className="shrink-0">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs text-white ${statusColors[exp.status]}`}
                  >
                    {exp.status === 'processing' && exp.progress > 0
                      ? `${exp.progress}%`
                      : statusLabels[exp.status]}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {cameras.find((c) => c.cameraId === exp.cameraId)?.name || exp.cameraId}
                  </div>
                  <div className="text-xs text-slate-400">
                    {formatDate(exp.startTime)} - {formatDate(exp.endTime)}
                  </div>
                  {exp.fileSize && (
                    <div className="text-xs text-slate-500">{formatFileSize(exp.fileSize)}</div>
                  )}
                  {exp.errorMessage && (
                    <div className="text-xs text-red-400 truncate" title={exp.errorMessage}>
                      {exp.errorMessage}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="shrink-0 flex gap-1">
                  {exp.status === 'completed' && (
                    <a
                      href={getExportDownloadUrl(exp.id)}
                      className="p-2 bg-emerald-700 hover:bg-emerald-600 rounded text-white transition-colors"
                      title={lang === 'no' ? 'Last ned' : 'Download'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  )}
                  <button
                    onClick={() => deleteExport(exp.id)}
                    className="p-2 bg-slate-700 hover:bg-red-700 rounded text-slate-400 hover:text-white transition-colors"
                    title={lang === 'no' ? 'Slett' : 'Delete'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
