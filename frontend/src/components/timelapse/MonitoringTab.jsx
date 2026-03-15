import { useState, useEffect, useRef } from 'react';
import { useMonitoringStore, SNOOZE_OPTIONS } from '../../stores/useMonitoringStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import MonitorCard from './MonitorCard.jsx';
import TagInput from './TagInput.jsx';

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
    highlightCameraId,
    fetchConfig,
    fetchSubscriptions,
    subscribe,
    clearError,
    clearPreselectCamera,
    clearHighlightCamera,
  } = useMonitoringStore();

  // Refs for scrolling to highlighted camera
  const cardRefs = useRef({});

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

  // Handle highlight camera - scroll to it and clear after animation
  useEffect(() => {
    if (highlightCameraId && cardRefs.current[highlightCameraId]) {
      // Scroll to the camera card
      cardRefs.current[highlightCameraId].scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear highlight after 5 seconds
      const timer = setTimeout(clearHighlightCamera, 5000);
      return () => clearTimeout(timer);
    }
  }, [highlightCameraId, clearHighlightCamera]);

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

        // Expand grouped cameras (same location, multiple directions) into separate entries
        const expanded = [];
        for (const f of features) {
          const groupName = f.properties?.name || '';
          const road = f.properties?.road || '';
          const lat = f.geometry?.coordinates?.[1];
          const lon = f.geometry?.coordinates?.[0];

          if (f.properties.directions && f.properties.directions.length > 1) {
            // Multiple cameras at same location — one entry per direction
            for (const dir of f.properties.directions) {
              const dirLabel = dir.direction || '';
              const displayName = dirLabel && dirLabel.toLowerCase() !== groupName.toLowerCase()
                ? `${groupName} — ${dirLabel}`
                : (dir.name || groupName);
              const matchesQuery = displayName.toLowerCase().includes(queryLower) ||
                groupName.toLowerCase().includes(queryLower) ||
                dir.id?.toLowerCase().includes(queryLower) ||
                dirLabel.toLowerCase().includes(queryLower) ||
                road.toLowerCase().includes(queryLower);
              if (matchesQuery && !subscribedIds.has(dir.id)) {
                expanded.push({
                  id: dir.id,
                  title: displayName,
                  road,
                  direction: dirLabel || null,
                  lat,
                  lon,
                });
              }
            }
          } else {
            const matchesQuery = groupName.toLowerCase().includes(queryLower) ||
              f.properties?.id?.toLowerCase().includes(queryLower) ||
              road.toLowerCase().includes(queryLower);
            if (matchesQuery && !subscribedIds.has(f.properties.id)) {
              expanded.push({
                id: f.properties.id,
                title: groupName,
                road,
                direction: f.properties.direction || null,
                lat,
                lon,
              });
            }
          }
        }
        const filtered = expanded.slice(0, 10);

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
              ? 'Monitorering er ikke aktivert. Administrator må konfigurere VLM og ntfy.'
              : 'Monitoring is not enabled. Administrator must configure VLM and ntfy.'}
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
        <div className="flex items-center gap-2 bg-slate-800 rounded px-3 py-2">
          <span className="flex-1 text-sm text-cyan-400 font-mono break-all select-all cursor-text">{ntfyChannel}</span>
          <button
            onClick={() => navigator.clipboard.writeText(ntfyChannel)}
            className="shrink-0 text-slate-400 hover:text-white transition-colors"
            title={lang === 'no' ? 'Kopier til utklippstavle' : 'Copy to clipboard'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        <TestNotificationButton lang={lang} />
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
                    <div className="text-white">
                      {cam.title || cam.id}
                      {cam.direction && (
                        <span className="ml-1.5 text-[10px] text-cyan-400 font-medium">({cam.direction})</span>
                      )}
                    </div>
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
                <div className="text-cyan-400 font-medium">
                  {selectedCamera.title || selectedCamera.id}
                  {selectedCamera.direction && (
                    <span className="ml-1.5 text-[10px] text-cyan-300 font-medium">({selectedCamera.direction})</span>
                  )}
                </div>
                {selectedCamera.road && (
                  <div className="text-xs text-slate-400">{selectedCamera.road}</div>
                )}
              </div>
            )}

            {/* Tag input for labels */}
            {selectedCamera && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t('monitoring.selectLabels', lang)}
                </label>
                <TagInput
                  value={newLabels}
                  onChange={setNewLabels}
                  placeholder={t('monitoring.tagsPlaceholder', lang)}
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
          <div key={sub.cameraId} ref={(el) => (cardRefs.current[sub.cameraId] = el)}>
            <MonitorCard
              subscription={sub}
              lang={lang}
              isHighlighted={highlightCameraId === sub.cameraId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TestNotificationButton({ lang }) {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error' | null

  async function sendTest() {
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch('/api/monitoring/test-notification', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
    setSending(false);
    // Clear status after 3 seconds
    setTimeout(() => setStatus(null), 3000);
  }

  return (
    <button
      onClick={sendTest}
      disabled={sending}
      className={`mt-2 w-full px-3 py-2 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
        status === 'success'
          ? 'bg-green-700 text-white'
          : status === 'error'
            ? 'bg-red-700 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-white'
      }`}
    >
      {sending ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {lang === 'no' ? 'Sender...' : 'Sending...'}
        </>
      ) : status === 'success' ? (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {lang === 'no' ? 'Sendt!' : 'Sent!'}
        </>
      ) : status === 'error' ? (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          {lang === 'no' ? 'Feil ved sending' : 'Failed to send'}
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {lang === 'no' ? 'Send testvarsel' : 'Send test notification'}
        </>
      )}
    </button>
  );
}
