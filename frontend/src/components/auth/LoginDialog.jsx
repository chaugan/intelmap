import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function LoginDialog() {
  const loginOpen = useAuthStore((s) => s.loginOpen);
  const setLoginOpen = useAuthStore((s) => s.setLoginOpen);
  const login = useAuthStore((s) => s.login);
  const lang = useMapStore((s) => s.lang);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!loginOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setLoginOpen(false);
    setUsername('');
    setPassword('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-emerald-400 mb-4">{t('auth.login', lang)}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">{t('auth.username', lang)}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">{t('auth.password', lang)}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              {t('general.cancel', lang)}
            </button>
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50"
            >
              {loading ? t('general.loading', lang) : t('auth.login', lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
