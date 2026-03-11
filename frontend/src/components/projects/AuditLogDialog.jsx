import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n.js';

const ACTION_COLORS = {
  add: 'text-emerald-400',
  update: 'text-amber-400',
  delete: 'text-red-400',
  delete_all: 'text-red-400',
};

const ACTION_BG = {
  add: 'bg-emerald-400/10',
  update: 'bg-amber-400/10',
  delete: 'bg-red-400/10',
  delete_all: 'bg-red-400/10',
};

function actionLabel(action, lang) {
  switch (action) {
    case 'add': return t('audit.added', lang);
    case 'update': return t('audit.updated', lang);
    case 'delete': return t('audit.deleted', lang);
    case 'delete_all': return t('audit.deletedAll', lang);
    default: return action;
  }
}

function relativeTime(dateStr, lang) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const diffMs = now - then;
  if (diffMs < 60000) return t('audit.justNow', lang);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} ${t('audit.minutesAgo', lang)}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${t('audit.minutesAgo', lang).replace('min', '').trim() || 'ago'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return dateStr.slice(0, 10);
}

export default function AuditLogDialog({ projectId, projectName, lang, onClose }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [newIds, setNewIds] = useState(new Set());
  const scrollRef = useRef(null);

  const fetchEntries = useCallback(async (off = 0, append = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/audit-log?limit=50&offset=${off}`);
      if (!res.ok) return;
      const data = await res.json();
      setEntries(prev => append ? [...prev, ...data.entries] : data.entries);
      setTotal(data.total);
      setOffset(off + data.entries.length);
    } catch {}
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchEntries(0);
  }, [fetchEntries]);

  // Listen for real-time audit entries
  useEffect(() => {
    const handler = (e) => {
      const entry = e.detail;
      if (entry.project_id !== projectId) return;
      setEntries(prev => [entry, ...prev]);
      setTotal(prev => prev + 1);
      setNewIds(prev => new Set(prev).add(entry.id));
      // Remove highlight after 3s
      setTimeout(() => {
        setNewIds(prev => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }, 3000);
    };
    window.addEventListener('audit-entry', handler);
    return () => window.removeEventListener('audit-entry', handler);
  }, [projectId]);

  const handleLoadMore = () => {
    fetchEntries(offset, true);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 w-full max-w-xl max-h-[80vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span className="text-sm font-medium text-slate-200 truncate">{t('audit.title', lang)}</span>
            <span className="text-xs text-slate-500">{projectName}</span>
            <span className="text-xs text-slate-600">({total} {t('audit.entries', lang)})</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">&times;</button>
        </div>

        {/* Entry list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          {entries.length === 0 && !loading && (
            <div className="text-center text-slate-500 text-sm py-12">{t('audit.empty', lang)}</div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-3 px-4 py-2.5 border-b border-slate-700/50 transition-colors duration-1000 ${
                newIds.has(entry.id) ? 'bg-emerald-900/20' : ''
              }`}
            >
              {/* Action icon */}
              <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${ACTION_BG[entry.action] || 'bg-slate-700'}`}>
                {entry.action === 'add' && (
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path d="M12 5v14m-7-7h14" />
                  </svg>
                )}
                {entry.action === 'update' && (
                  <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                )}
                {(entry.action === 'delete' || entry.action === 'delete_all') && (
                  <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-slate-200">{entry.username}</span>
                  <span className={`text-xs ${ACTION_COLORS[entry.action] || 'text-slate-400'}`}>
                    {actionLabel(entry.action, lang)}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{entry.summary}</div>
              </div>

              {/* Timestamp */}
              <div className="text-xs text-slate-600 shrink-0 mt-0.5">
                {newIds.has(entry.id) ? (
                  <span className="text-emerald-400 font-medium">{t('audit.new', lang)}</span>
                ) : (
                  relativeTime(entry.created_at, lang)
                )}
              </div>
            </div>
          ))}

          {/* Load more */}
          {entries.length < total && (
            <div className="flex justify-center py-3">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="text-xs text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50"
              >
                {loading ? t('audit.loading', lang) : t('audit.loadMore', lang)}
              </button>
            </div>
          )}

          {loading && entries.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-12">{t('audit.loading', lang)}</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
