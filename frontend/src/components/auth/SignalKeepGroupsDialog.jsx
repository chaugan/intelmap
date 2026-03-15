import { useState, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function SignalKeepGroupsDialog({ open, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const [groups, setGroups] = useState([]);
  const [keepIds, setKeepIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setError('');
    setLoading(true);
    fetch('/api/signal/keep-groups', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setGroups(data.groups || []);
        setKeepIds(new Set(data.keepIds || []));
      })
      .catch(() => setError('Failed to load groups'))
      .finally(() => setLoading(false));
  }, [open]);

  const toggleGroup = (id) => {
    setKeepIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/signal/keep-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ groupIds: [...keepIds] }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaved(true);
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {t('signal.keepGroups', lang)}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          {t('signal.keepGroupsDesc', lang)}
        </p>

        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">{t('signal.loadingGroups', lang)}</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">{t('signal.noGroups', lang)}</div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
            {groups.map(g => {
              const kept = keepIds.has(g.id);
              return (
                <label
                  key={g.id}
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                    kept ? 'bg-emerald-500/10 hover:bg-emerald-500/20' : 'bg-red-500/10 hover:bg-red-500/20'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={kept}
                    onChange={() => toggleGroup(g.id)}
                    className="w-4 h-4 rounded border-slate-500 text-emerald-600 focus:ring-emerald-500 bg-slate-700"
                  />
                  <span className={`flex-1 text-sm ${kept ? 'text-emerald-300' : 'text-red-300'}`}>
                    {kept ? (
                      <svg className="w-4 h-4 inline mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 inline mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {g.name}
                  </span>
                  <span className="text-xs text-slate-500">{g.membersCount} {t('signal.members', lang)}</span>
                </label>
              );
            })}
          </div>
        )}

        {keepIds.size === 0 && groups.length > 0 && (
          <p className="text-amber-400 text-xs mb-3">{t('signal.noKeepGroupsWarning', lang)}</p>
        )}

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
          >
            {t('signal.cancel', lang)}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || groups.length === 0}
            className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            {saving ? '...' : saved ? t('signal.keepGroupsSaved', lang) : (lang === 'no' ? 'Lagre' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
