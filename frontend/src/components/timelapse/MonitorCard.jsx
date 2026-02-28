import { useState, useEffect } from 'react';
import { useMonitoringStore, SNOOZE_OPTIONS } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import LabelSelector from './LabelSelector.jsx';

export default function MonitorCard({ subscription, lang }) {
  const { updateSubscription, unsubscribe, fetchDetections, detections, detectionsPage, detectionsTotalCount, detectionsLoading, selectedCameraId } = useMonitoringStore();
  const mapRef = useMapStore((s) => s.mapRef);

  const [isEditing, setIsEditing] = useState(false);
  const [editLabels, setEditLabels] = useState(subscription.labels || []);
  const [editSnooze, setEditSnooze] = useState(subscription.snoozeMinutes || 0);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load detection history when expanded
  useEffect(() => {
    if (showHistory && selectedCameraId !== subscription.cameraId) {
      fetchDetections(subscription.cameraId, 1);
    }
  }, [showHistory, subscription.cameraId, selectedCameraId, fetchDetections]);

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

  function flyToCamera() {
    if (mapRef && subscription.lat && subscription.lon) {
      mapRef.flyTo({
        center: [subscription.lon, subscription.lat],
        zoom: 14,
        duration: 1500,
      });
    }
  }

  const snoozeLabel = SNOOZE_OPTIONS.find(o => o.value === subscription.snoozeMinutes);

  return (
    <div className="bg-slate-900 rounded border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <h3 className="text-sm font-medium text-white truncate">
              {subscription.cameraName || subscription.cameraId}
            </h3>
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
          {subscription.lat && subscription.lon && (
            <button
              onClick={flyToCamera}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700"
              title={lang === 'no' ? 'Vis paa kart' : 'Show on map'}
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
          {detectionsLoading && selectedCameraId === subscription.cameraId ? (
            <div className="p-3 text-xs text-slate-400 text-center">
              {t('general.loading', lang)}
            </div>
          ) : selectedCameraId === subscription.cameraId && detections.length === 0 ? (
            <div className="p-3 text-xs text-slate-400 text-center">
              {t('monitoring.noDetections', lang)}
            </div>
          ) : selectedCameraId === subscription.cameraId ? (
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
                    {det.notified ? (
                      <span className="text-green-400">+</span>
                    ) : (
                      <span className="text-slate-500" title={lang === 'no' ? 'Ignorert (snooze)' : 'Snoozed'}>-</span>
                    )}
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
                  onClick={() => fetchDetections(subscription.cameraId, detectionsPage + 1)}
                  className="w-full px-3 py-2 text-xs text-cyan-400 hover:bg-slate-800 transition-colors"
                >
                  {lang === 'no' ? 'Last mer...' : 'Load more...'}
                </button>
              )}
            </div>
          ) : null}
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
              {lang === 'no' ? 'Fjerne overvaking?' : 'Remove monitoring?'}
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
    </div>
  );
}
