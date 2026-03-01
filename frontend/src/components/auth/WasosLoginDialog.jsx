import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function WasosLoginDialog() {
  const wasosLoginOpen = useAuthStore((s) => s.wasosLoginOpen);
  const setWasosLoginOpen = useAuthStore((s) => s.setWasosLoginOpen);
  const wasosLogin = useAuthStore((s) => s.wasosLogin);
  const wasosLoading = useAuthStore((s) => s.wasosLoading);
  const lang = useMapStore((s) => s.lang);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!wasosLoginOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await wasosLogin(username, password);
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err.message || t('wasos.loginFailed', lang));
    }
  };

  const handleClose = () => {
    setWasosLoginOpen(false);
    setUsername('');
    setPassword('');
    setError('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{t('wasos.login', lang)}</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t('wasos.username', lang)}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
              disabled={wasosLoading}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t('wasos.password', lang)}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
              disabled={wasosLoading}
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
              disabled={wasosLoading}
            >
              {t('general.cancel', lang)}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
              disabled={wasosLoading || !username || !password}
            >
              {wasosLoading ? t('general.loading', lang) : t('auth.login', lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
