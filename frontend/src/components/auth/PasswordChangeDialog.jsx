import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function PasswordChangeDialog() {
  const passwordChangeOpen = useAuthStore((s) => s.passwordChangeOpen);
  const setPasswordChangeOpen = useAuthStore((s) => s.setPasswordChangeOpen);
  const changePassword = useAuthStore((s) => s.changePassword);
  const dismissPasswordChange = useAuthStore((s) => s.dismissPasswordChange);
  const user = useAuthStore((s) => s.user);
  const lang = useMapStore((s) => s.lang);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!passwordChangeOpen) return null;

  const isForced = user?.mustChangePassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch', lang));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('auth.passwordTooShort', lang));
      return;
    }

    setLoading(true);
    try {
      await changePassword(isForced ? null : currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (isForced) {
      // Esc on forced change = lock account
      dismissPasswordChange();
    } else {
      setPasswordChangeOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-emerald-400 mb-2">{t('auth.changePassword', lang)}</h2>
        {isForced && (
          <p className="text-amber-400 text-sm mb-4">{t('auth.mustChangePassword', lang)}</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isForced && (
            <div>
              <label className="block text-sm text-slate-300 mb-1">{t('auth.currentPassword', lang)}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
                autoComplete="current-password"
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-300 mb-1">{t('auth.newPassword', lang)}</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
              autoFocus
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">{t('auth.confirmPassword', lang)}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              {isForced ? t('auth.dismissLock', lang) : t('general.cancel', lang)}
            </button>
            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50"
            >
              {loading ? t('general.loading', lang) : t('auth.changePassword', lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
