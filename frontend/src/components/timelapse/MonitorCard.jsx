import { useState, useEffect, useCallback } from 'react';
import { useMonitoringStore, SNOOZE_OPTIONS } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import LabelSelector from './LabelSelector.jsx';

export default function MonitorCard({ subscription, lang, isHighlighted = false }) {
  const { updateSubscription, unsubscribe, togglePause } = useMonitoringStore();
  const mapRef = useMapStore((s) => s.mapRef);
  const webcamsVisible = useMapStore((s) => s.webcamsVisible);
  const toggleWebcams = useMapStore((s) => s.toggleWebcams);

  const [isEditing, setIsEditing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [editLabels, setEditLabels] = useState(subscription.labels || []);
  const [editSnooze, setEditSnooze] = useState(subscription.snoozeMinutes || 0);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  // Local detection state per card (allows multiple histories open simultaneously)
  const [detections, setDetections] = useState([]);
  const [detectionsPage, setDetectionsPage] = useState(1);
  const [detectionsTotalCount, setDetectionsTotalCount] = useState(0);
  const [detectionsLoading, setDetectionsLoading] = useState(false);

  // Detection summary (total per label, last detection)
  const [summary, setSummary] = useState(null);

  // Fetch detections for this card only
  const fetchDetections = useCallback(async (page = 1) => {
    setDetectionsLoading(true);
    try {
      const res = await fetch(`/api/monitoring/${subscription.cameraId}/detections?page=${page}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDetections(data.detections);
        setDetectionsPage(data.page);
        setDetectionsTotalCount(data.totalCount);
      }
    } catch {
      // Silently fail
    }
    setDetectionsLoading(false);
  }, [subscription.cameraId]);

  // Load detection history when expanded
  useEffect(() => {
    if (showHistory) {
      fetchDetections(1);
    }
  }, [showHistory, fetchDetections]);

  // Fetch detection summary on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch(`/api/monitoring/${subscription.cameraId}/summary`, { credentials: 'include' });
        if (res.ok) {
          setSummary(await res.json());
        }
      } catch {}
    }
    fetchSummary();
  }, [subscription.cameraId]);

  // Clear detection history
  async function handleClearHistory() {
    setClearingHistory(true);
    try {
      const res = await fetch(`/api/monitoring/${subscription.cameraId}/detections`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setDetections([]);
        setDetectionsTotalCount(0);
        setConfirmClearHistory(false);
        setSummary(null); // Clear summary
      }
    } catch {}
    setClearingHistory(false);
  }

  async function handleSave() {
    if (editLabels.length === 0) return;
    setSaving(true);
    const success = await updateSubscription(subscription.cameraId, editLabels, editSnooze);
    setSaving(false);
    if (success) {
      setIsEditing(false);
    }
  }

  async function handleDelete() {
    await unsubscribe(subscription.cameraId);
  }

  async function handleTogglePause() {
    setPausing(true);
    await togglePause(subscription.cameraId);
    setPausing(false);
  }

  function flyToCamera() {
    if (mapRef && subscription.lat && subscription.lon) {
      mapRef.flyTo({
        center: [subscription.lon, subscription.lat],
        zoom: 14,
        duration: 1500,
      });
      // Enable webcams overlay after animation finishes
      mapRef.once('idle', () => {
        if (!webcamsVisible) {
          toggleWebcams();
        }
      });
    }
  }

  const snoozeLabel = SNOOZE_OPTIONS.find(o => o.value === subscription.snoozeMinutes);

  return (
    <div className={`bg-slate-900 rounded border overflow-hidden transition-all duration-300 ${
      isHighlighted
        ? 'border-green-500 ring-2 ring-green-500/50 animate-pulse'
        : 'border-slate-700'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${subscription.isPaused ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`} />
            <h3 className="text-sm font-medium text-white truncate">
              {subscription.cameraName || subscription.cameraId}
            </h3>
            {subscription.isPaused && (
              <span className="px-1.5 py-0.5 bg-amber-900/50 rounded text-xs text-amber-400">
                {lang === 'no' ? 'Pauset' : 'Paused'}
              </span>
            )}
          </div>
          {!isEditing && (
            <div className="mt-1 flex flex-wrap gap-1">
              {subscription.labels.slice(0, 5).map(label => (
                <span key={label} className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                  {label}
                </span>
              ))}
              {subscription.labels.length > 5 && (
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                  +{subscription.labels.length - 5}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Pause/Resume button */}
          <button
            onClick={handleTogglePause}
            disabled={pausing}
            className={`p-1.5 rounded hover:bg-slate-700 ${subscription.isPaused ? 'text-amber-400' : 'text-slate-400 hover:text-white'} disabled:opacity-50`}
            title={subscription.isPaused
              ? (lang === 'no' ? 'Gjenoppta varsler' : 'Resume notifications')
              : (lang === 'no' ? 'Pause varsler' : 'Pause notifications')
            }
          >
            {subscription.isPaused ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
          {subscription.lat && subscription.lon && (
            <button
              onClick={flyToCamera}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700"
              title={lang === 'no' ? 'Vis på kart' : 'Show on map'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => {
              setIsEditing(!isEditing);
              if (!isEditing) {
                setEditLabels(subscription.labels || []);
                setEditSnooze(subscription.snoozeMinutes || 0);
              }
            }}
            className={`p-1.5 rounded hover:bg-slate-700 ${isEditing ? 'text-cyan-400' : 'text-slate-400 hover:text-white'}`}
            title={lang === 'no' ? 'Rediger' : 'Edit'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Edit mode */}
      {isEditing && (
        <div className="p-3 space-y-3 border-b border-slate-700 bg-slate-800/50">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t('monitoring.labels', lang)}
            </label>
            <LabelSelector
              selected={editLabels}
              onChange={setEditLabels}
              lang={lang}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t('monitoring.snooze', lang)}
            </label>
            <select
              value={editSnooze}
              onChange={(e) => setEditSnooze(parseInt(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              {SNOOZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {lang === 'no' ? opt.labelNo : opt.labelEn}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
            >
              {t('general.cancel', lang)}
            </button>
            <button
              onClick={handleSave}
              disabled={editLabels.length === 0 || saving}
              className="flex-1 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-sm transition-colors disabled:opacity-50"
            >
              {saving ? t('general.loading', lang) : t('general.save', lang)}
            </button>
          </div>
        </div>
      )}

      {/* Detection summary */}
      {!isEditing && summary && summary.totalCount > 0 && (
        <div className="px-3 py-2 border-b border-slate-700 bg-slate-800/30">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-400">
              {lang === 'no' ? 'Totalt' : 'Total'}: {summary.totalCount} {lang === 'no' ? 'hendelser' : 'detections'}
            </span>
            <span className="text-slate-500">
              {lang === 'no' ? 'Sist' : 'Last'}: {new Date(summary.lastDetection).toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
              })}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(summary.labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => (
              <span key={label} className="px-1.5 py-0.5 bg-amber-900/40 rounded text-xs text-amber-300">
                {count}x {label}
              </span>
            ))}
            {Object.keys(summary.labelCounts).length > 6 && (
              <span className="px-1.5 py-0.5 text-xs text-slate-500">
                +{Object.keys(summary.labelCounts).length - 6}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Info row */}
      {!isEditing && (
        <div className="px-3 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-700">
          <span>
            {lang === 'no' ? 'Ignorer' : 'Snooze'}: {snoozeLabel ? (lang === 'no' ? snoozeLabel.labelNo : snoozeLabel.labelEn) : '-'}
          </span>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-slate-400 hover:text-white flex items-center gap-1"
          >
            {t('monitoring.history', lang)}
            <svg className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Detection history */}
      {showHistory && !isEditing && (
        <div className="max-h-48 overflow-y-auto">
          {detectionsLoading ? (
            <div className="p-3 text-xs text-slate-400 text-center">
              {t('general.loading', lang)}
            </div>
          ) : detections.length === 0 ? (
            <div className="p-3 text-xs text-slate-400 text-center">
              {t('monitoring.noDetections', lang)}
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {detections.map((det) => (
                <div key={det.id} className="px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      {new Date(det.detected_at).toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      {det.has_image ? (
                        <button
                          onClick={() => setViewingImage(det.id)}
                          className="text-cyan-400 hover:text-cyan-300 underline"
                        >
                          {lang === 'no' ? 'Vis bilde' : 'View image'}
                        </button>
                      ) : null}
                      {det.notified ? (
                        <span className="text-green-400">+</span>
                      ) : (
                        <span className="text-slate-500" title={lang === 'no' ? 'Ignorert (snooze)' : 'Snoozed'}>-</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {det.labelsDetected.map((l, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-amber-900/50 rounded text-xs text-amber-400">
                        {l.count}x {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {detectionsTotalCount > detectionsPage * 20 && (
                <button
                  onClick={() => fetchDetections(detectionsPage + 1)}
                  className="w-full px-3 py-2 text-xs text-cyan-400 hover:bg-slate-800 transition-colors"
                >
                  {lang === 'no' ? 'Last mer...' : 'Load more...'}
                </button>
              )}
              {/* Clear history button */}
              <div className="px-3 py-2 border-t border-slate-700">
                {!confirmClearHistory ? (
                  <button
                    onClick={() => setConfirmClearHistory(true)}
                    className="text-xs text-amber-400 hover:text-amber-300"
                  >
                    {lang === 'no' ? 'Tøm historikk' : 'Clear history'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {lang === 'no' ? 'Slette all historikk og bilder?' : 'Delete all history and images?'}
                    </span>
                    <button
                      onClick={() => setConfirmClearHistory(false)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      {t('general.cancel', lang)}
                    </button>
                    <button
                      onClick={handleClearHistory}
                      disabled={clearingHistory}
                      className="px-2 py-1 text-xs bg-amber-700 hover:bg-amber-600 rounded disabled:opacity-50"
                    >
                      {clearingHistory ? '...' : (lang === 'no' ? 'Slett' : 'Delete')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <div className="px-3 py-2 border-t border-slate-700">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            {t('monitoring.remove', lang)}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {lang === 'no' ? 'Fjerne overvåking?' : 'Remove monitoring?'}
            </span>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
            >
              {t('general.cancel', lang)}
            </button>
            <button
              onClick={handleDelete}
              className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 rounded"
            >
              {t('general.delete', lang)}
            </button>
          </div>
        )}
      </div>

      {/* Fullscreen detection image modal */}
      {viewingImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setViewingImage(null)}
        >
          <button
            onClick={() => setViewingImage(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={`/api/monitoring/detections/${viewingImage}/image`}
            alt="Detection"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
