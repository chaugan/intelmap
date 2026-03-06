import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { startAuthentication } from '@simplewebauthn/browser';
import { t } from '../../lib/i18n.js';

export default function LoginDialog() {
  const loginOpen = useAuthStore((s) => s.loginOpen);
  const setLoginOpen = useAuthStore((s) => s.setLoginOpen);
  const login = useAuthStore((s) => s.login);
  const mfaPending = useAuthStore((s) => s.mfaPending);
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const lang = useMapStore((s) => s.lang);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA state
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [mfaCode, setMfaCode] = useState('');

  if (!loginOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      if (!result.mfaRequired) {
        setUsername('');
        setPassword('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyMfa(mfaMethod, mfaCode);
      setUsername('');
      setPassword('');
      setMfaCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWebAuthn = async () => {
    setError('');
    setLoading(true);
    try {
      // Get auth options from server
      const optRes = await fetch('/api/auth/mfa/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mfaToken: mfaPending.mfaToken }),
      });
      if (!optRes.ok) {
        const data = await optRes.json();
        throw new Error(data.error || 'Failed to get options');
      }
      const options = await optRes.json();

      // Browser prompts user
      const credential = await startAuthentication({ optionsJSON: options });

      // Verify on server
      await verifyMfa('webauthn', null, credential);
      setUsername('');
      setPassword('');
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setLoginOpen(false);
    setUsername('');
    setPassword('');
    setMfaCode('');
    setError('');
    useAuthStore.setState({ mfaPending: null });
  };

  const handleBackToLogin = () => {
    useAuthStore.setState({ mfaPending: null });
    setMfaCode('');
    setError('');
  };

  // MFA verification step
  if (mfaPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
        <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-emerald-400 mb-2">{t('mfa.title', lang)}</h2>
          <p className="text-sm text-slate-400 mb-4">{t('mfa.enterCode', lang)}</p>

          {/* Method tabs */}
          {mfaPending.methods.length > 1 && (
            <div className="flex gap-1 mb-4">
              {mfaPending.methods.includes('totp') && (
                <button onClick={() => setMfaMethod('totp')}
                  className={`px-3 py-1 rounded text-xs transition-colors ${mfaMethod === 'totp' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  {t('mfa.totp.title', lang)}
                </button>
              )}
              {mfaPending.methods.includes('webauthn') && (
                <button onClick={() => setMfaMethod('webauthn')}
                  className={`px-3 py-1 rounded text-xs transition-colors ${mfaMethod === 'webauthn' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  {t('mfa.webauthn.title', lang)}
                </button>
              )}
              {mfaPending.methods.includes('backup') && (
                <button onClick={() => setMfaMethod('backup')}
                  className={`px-3 py-1 rounded text-xs transition-colors ${mfaMethod === 'backup' ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  {t('mfa.backup.title', lang)}
                </button>
              )}
            </div>
          )}

          {mfaMethod === 'totp' && (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">{t('mfa.totp.enterCode', lang)}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setMfaCode(val);
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex justify-between">
                <button type="button" onClick={handleBackToLogin}
                  className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors">
                  {lang === 'no' ? 'Tilbake' : 'Back'}
                </button>
                <button type="submit" disabled={loading || mfaCode.length !== 6}
                  className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50">
                  {loading ? t('general.loading', lang) : t('mfa.verify', lang)}
                </button>
              </div>
            </form>
          )}

          {mfaMethod === 'webauthn' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">{t('mfa.webauthn.tap', lang)}</p>
              <button onClick={handleWebAuthn} disabled={loading}
                className="w-full px-4 py-3 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {loading ? t('general.loading', lang) : t('mfa.webauthn.use', lang)}
              </button>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="button" onClick={handleBackToLogin}
                className="w-full px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors">
                {lang === 'no' ? 'Tilbake' : 'Back'}
              </button>
            </div>
          )}

          {mfaMethod === 'backup' && (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">{t('mfa.backup.enter', lang)}</label>
                <input
                  type="text"
                  maxLength={8}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ''))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-center font-mono focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex justify-between">
                <button type="button" onClick={handleBackToLogin}
                  className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors">
                  {lang === 'no' ? 'Tilbake' : 'Back'}
                </button>
                <button type="submit" disabled={loading || mfaCode.length < 8}
                  className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50">
                  {loading ? t('general.loading', lang) : t('mfa.verify', lang)}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Normal login form
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
