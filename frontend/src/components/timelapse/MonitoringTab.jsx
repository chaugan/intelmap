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
    preselectCamera,
    fetchConfig,
    fetchSubscriptions,
    subscribe,
    clearError,
    clearPreselectCamera,
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

  // Handle preselect camera from map popup
  useEffect(() => {
    if (preselectCamera && enabled) {
      // Check if already subscribed
      const isAlreadySubscribed = subscriptions.some(s => s.cameraId === preselectCamera.id);
      if (!isAlreadySubscribed) {
        setShowAddCamera(true);
        setSelectedCamera({
          id: preselectCamera.id,
          title: preselectCamera.name,
          road: preselectCamera.road,
          lat: preselectCamera.lat,
          lon: preselectCamera.lon,
        });
        setSearchQuery(preselectCamera.name || preselectCamera.id);
      }
      clearPreselectCamera();
    }
  }, [preselectCamera, enabled, subscriptions, clearPreselectCamera]);

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
      // Fetch all webcams (GeoJSON format)
      const res = await fetch('/api/webcams', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // data is GeoJSON: { type: 'FeatureCollection', features: [...] }
        const features = data.features || [];

        // Filter by search query and exclude already subscribed
        const subscribedIds = new Set(subscriptions.map(s => s.cameraId));
        const queryLower = query.toLowerCase();

        const filtered = features
          .filter(f => {
            const id = f.properties?.id;
            const name = f.properties?.name || '';
            const road = f.properties?.road || '';
            // Match against name, id, or road
            const matchesQuery = name.toLowerCase().includes(queryLower) ||
              id?.toLowerCase().includes(queryLower) ||
              road.toLowerCase().includes(queryLower);
            return matchesQuery && !subscribedIds.has(id);
          })
          .map(f => ({
            id: f.properties.id,
            title: f.properties.name,
            road: f.properties.road,
            lat: f.geometry?.coordinates?.[1],
            lon: f.geometry?.coordinates?.[0],
          }))
          .slice(0, 10);

        setSearchResults(filtered);
      }
    } catch {}
    setSearching(false);
  }

  // Add monitor subscription
  async function handleAddMonitor() {
    if (!selectedCamera || newLabels.length === 0) return;
    setAdding(true);
    const success = await subscribe(
      selectedCamera.id,
      newLabels,
      newSnooze,
      selectedCamera.title || selectedCamera.name,
      selectedCamera.lat,
      selectedCamera.lon
    );
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
              ? 'Monitorering er ikke aktivert. Administrator må konfigurere YOLO og ntfy.'
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
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-400">
            {lang === 'no' ? 'Abonner i ntfy-appen:' : 'Subscribe in ntfy app:'}
          </div>
          <a
            href="https://docs.ntfy.sh/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-400 hover:text-cyan-300 underline"
          >
            {lang === 'no' ? 'ntfy-dokumentasjon' : 'ntfy docs'}
          </a>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(ntfyChannel)}
          className="w-full text-sm text-cyan-400 hover:text-cyan-300 font-mono bg-slate-800 rounded px-3 py-2 text-left break-all"
          title={lang === 'no' ? 'Kopier til utklippstavle' : 'Copy to clipboard'}
        >
          {ntfyChannel}
        </button>
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
                placeholder={lang === 'no' ? 'Søk etter kamera...' : 'Search for camera...'}
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
              ? 'Ingen kameraer overvåkes. Klikk "Legg til kamera" for å starte.'
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
