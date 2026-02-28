import { useState, useEffect } from 'react';
import { useMonitoringStore, SNOOZE_OPTIONS } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import MonitorCard from './MonitorCard.jsx';
import LabelSelector from './LabelSelector.jsx';

export default function MonitoringTab() {
  const lang = useMapStore((s) => s.lang);
  const {
    enabled,
    ntfyChannel,
    configLoaded,
    subscriptions,
    loading,
    error,
    fetchConfig,
    fetchSubscriptions,
    subscribe,
    clearError,
  } = useMonitoringStore();

  const [showAddCamera, setShowAddCamera] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [newLabels, setNewLabels] = useState([]);
  const [newSnooze, setNewSnooze] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchSubscriptions();
  }, [fetchConfig, fetchSubscriptions]);

  // Auto-clear errors
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // Search webcams
  async function handleSearch(query) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/webcams?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // Filter out already subscribed cameras
        const subscribedIds = new Set(subscriptions.map(s => s.cameraId));
        const filtered = data.filter(cam => !subscribedIds.has(cam.id));
        setSearchResults(filtered.slice(0, 10));
      }
    } catch {}
    setSearching(false);
  }

  // Add monitor subscription
  async function handleAddMonitor() {
    if (!selectedCamera || newLabels.length === 0) return;
    setAdding(true);
    const success = await subscribe(selectedCamera.id, newLabels, newSnooze);
    setAdding(false);
    if (success) {
      setShowAddCamera(false);
      setSelectedCamera(null);
      setNewLabels([]);
      setNewSnooze(0);
      setSearchQuery('');
      setSearchResults([]);
    }
  }

  if (!configLoaded) {
    return (
      <div className="p-4 text-slate-400 text-sm">
        {t('general.loading', lang)}
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="p-4">
        <div className="bg-slate-900 rounded p-4 text-center">
          <p className="text-slate-400 text-sm">
            {lang === 'no'
              ? 'Monitorering er ikke aktivert. Administrator maa konfigurere YOLO og ntfy.'
              : 'Monitoring is not enabled. Administrator must configure YOLO and ntfy.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ntfy channel info */}
      <div className="px-4 py-3 bg-slate-900/50 border-b border-slate-700 shrink-0">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {lang === 'no' ? 'Abonner i ntfy-appen:' : 'Subscribe in ntfy app:'}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(ntfyChannel)}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-mono"
            title={lang === 'no' ? 'Kopier til utklippstavle' : 'Copy to clipboard'}
          >
            {ntfyChannel?.split('/').pop()}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Add camera section */}
      <div className="px-4 py-3 border-b border-slate-700 shrink-0">
        {!showAddCamera ? (
          <button
            onClick={() => setShowAddCamera(true)}
            className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('monitoring.addCamera', lang)}
          </button>
        ) : (
          <div className="space-y-3">
            {/* Camera search */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t('monitoring.searchCamera', lang)}
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={lang === 'no' ? 'Soek etter kamera...' : 'Search for camera...'}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Search results */}
            {searching && (
              <div className="text-xs text-slate-400">{t('general.loading', lang)}</div>
            )}
            {searchResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto bg-slate-800 rounded border border-slate-600">
                {searchResults.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => {
                      setSelectedCamera(cam);
                      setSearchQuery(cam.title || cam.id);
                      setSearchResults([]);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-700 transition-colors border-b border-slate-700 last:border-b-0 ${
                      selectedCamera?.id === cam.id ? 'bg-slate-700' : ''
                    }`}
                  >
                    <div className="text-white">{cam.title || cam.id}</div>
                    {cam.road && (
                      <div className="text-xs text-slate-400">{cam.road}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Selected camera */}
            {selectedCamera && (
              <div className="p-2 bg-cyan-900/30 rounded border border-cyan-700 text-sm">
                <div className="text-cyan-400 font-medium">{selectedCamera.title || selectedCamera.id}</div>
                {selectedCamera.road && (
                  <div className="text-xs text-slate-400">{selectedCamera.road}</div>
                )}
              </div>
            )}

            {/* Label selector */}
            {selectedCamera && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t('monitoring.selectLabels', lang)}
                </label>
                <LabelSelector
                  selected={newLabels}
                  onChange={setNewLabels}
                  lang={lang}
                />
              </div>
            )}

            {/* Snooze selector */}
            {selectedCamera && newLabels.length > 0 && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t('monitoring.snooze', lang)}
                </label>
                <select
                  value={newSnooze}
                  onChange={(e) => setNewSnooze(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  {SNOOZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {lang === 'no' ? opt.labelNo : opt.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAddCamera(false);
                  setSelectedCamera(null);
                  setNewLabels([]);
                  setNewSnooze(0);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
              >
                {t('general.cancel', lang)}
              </button>
              <button
                onClick={handleAddMonitor}
                disabled={!selectedCamera || newLabels.length === 0 || adding}
                className="flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 rounded text-sm transition-colors disabled:opacity-50"
              >
                {adding ? t('general.loading', lang) : t('monitoring.addCamera', lang)}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Subscriptions list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && subscriptions.length === 0 && (
          <div className="text-slate-400 text-sm text-center py-4">
            {t('general.loading', lang)}
          </div>
        )}

        {!loading && subscriptions.length === 0 && (
          <div className="text-slate-400 text-sm text-center py-4">
            {lang === 'no'
              ? 'Ingen kameraer overvakes. Klikk "Legg til kamera" for aa starte.'
              : 'No cameras monitored. Click "Add camera" to start.'}
          </div>
        )}

        {subscriptions.map((sub) => (
          <MonitorCard key={sub.cameraId} subscription={sub} lang={lang} />
        ))}
      </div>
    </div>
  );
}
