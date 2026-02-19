import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

const API = '/api/projects';

export default function ProjectManager() {
  const projectManagerOpen = useAuthStore((s) => s.projectManagerOpen);
  const setProjectManagerOpen = useAuthStore((s) => s.setProjectManagerOpen);
  const lang = useMapStore((s) => s.lang);

  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(null);

  useEffect(() => {
    if (projectManagerOpen) fetchProjects();
  }, [projectManagerOpen]);

  if (!projectManagerOpen) return null;

  async function fetchProjects() {
    try {
      const res = await fetch(API, { credentials: 'include' });
      if (res.ok) setProjects(await res.json());
    } catch {}
  }

  function getCurrentSnapshot() {
    const store = useMapStore.getState();
    return {
      viewport: {
        longitude: store.longitude,
        latitude: store.latitude,
        zoom: store.zoom,
      },
      baseLayer: store.baseLayer,
      overlays: {
        windVisible: store.windVisible,
        webcamsVisible: store.webcamsVisible,
        avalancheVisible: store.avalancheVisible,
      },
    };
  }

  async function saveProject(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    setLoading(true);
    try {
      const snapshot = getCurrentSnapshot();
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName.trim(), ...snapshot }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        return;
      }
      setNewName('');
      fetchProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function overwriteProject(id) {
    setError('');
    const snapshot = getCurrentSnapshot();
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(snapshot),
    });
    if (res.ok) fetchProjects();
    else {
      const data = await res.json();
      setError(data.error);
    }
  }

  async function loadProject(id) {
    setError('');
    try {
      const res = await fetch(`${API}/${id}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        return;
      }
      const { snapshot } = await res.json();
      const store = useMapStore.getState();

      // Apply viewport
      if (snapshot.viewport) {
        store.flyTo(snapshot.viewport.longitude, snapshot.viewport.latitude, snapshot.viewport.zoom);
      }

      // Apply base layer
      if (snapshot.baseLayer) {
        store.setBaseLayer(snapshot.baseLayer);
      }

      // Apply overlays
      if (snapshot.overlays) {
        const s = useMapStore.getState();
        if (snapshot.overlays.windVisible !== undefined && s.windVisible !== snapshot.overlays.windVisible) store.toggleWind();
        if (snapshot.overlays.webcamsVisible !== undefined && s.webcamsVisible !== snapshot.overlays.webcamsVisible) store.toggleWebcams();
        if (snapshot.overlays.avalancheVisible !== undefined && s.avalancheVisible !== snapshot.overlays.avalancheVisible) store.toggleAvalanche();
      }

      // Load tactical state via socket (replaces shared state for other clients)
      const tacticalData = {
        markers: snapshot.markers || [],
        drawings: snapshot.drawings || [],
        layers: snapshot.layers || [],
      };
      socket.emit('client:state:load', tacticalData);

      // Also update local store directly (avoids socket round-trip reliability issues)
      useTacticalStore.getState().setState(tacticalData);

      setConfirmLoad(null);
      setProjectManagerOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProject(id) {
    if (!confirm(t('projects.confirmDelete', lang))) return;
    await fetch(`${API}/${id}`, { method: 'DELETE', credentials: 'include' });
    fetchProjects();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setProjectManagerOpen(false)}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-emerald-400">{t('projects.title', lang)}</h2>
          <button onClick={() => setProjectManagerOpen(false)} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Save new project */}
          <form onSubmit={saveProject} className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('projects.namePlaceholder', lang)}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={loading || !newName.trim()}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
            >
              {t('projects.save', lang)}
            </button>
          </form>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Project list */}
          {projects.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">{t('projects.noProjects', lang)}</p>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => (
                <div key={p.id} className="bg-slate-900 rounded p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-slate-500">{new Date(p.updated_at).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-1">
                    {confirmLoad === p.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-amber-400 mr-1">{t('projects.confirmLoad', lang)}</span>
                        <button onClick={() => loadProject(p.id)} className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors">
                          {t('projects.yes', lang)}
                        </button>
                        <button onClick={() => setConfirmLoad(null)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors">
                          {t('general.cancel', lang)}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => setConfirmLoad(p.id)} className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors">
                          {t('projects.load', lang)}
                        </button>
                        <button onClick={() => overwriteProject(p.id)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors">
                          {t('projects.overwrite', lang)}
                        </button>
                        <button onClick={() => deleteProject(p.id)} className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors">
                          {t('general.delete', lang)}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
