import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { startRegistration } from '@simplewebauthn/browser';
import { t } from '../../lib/i18n.js';

const API = '/api/auth';

export default function SecurityDialog() {
  const open = useAuthStore((s) => s.securityDialogOpen);
  const setOpen = useAuthStore((s) => s.setSecurityDialogOpen);
  const mfaSetupRequired = useAuthStore((s) => s.mfaSetupRequired);
  const changePassword = useAuthStore((s) => s.changePassword);
  const dismissPasswordChange = useAuthStore((s) => s.dismissPasswordChange);
  const user = useAuthStore((s) => s.user);
  const lang = useMapStore((s) => s.lang);

  const [activeSection, setActiveSection] = useState('password'); // 'password' | 'mfa'
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // MFA status
  const [mfaStatus, setMfaStatus] = useState(null);
  const [mfaLoading, setMfaLoading] = useState(false);

  // TOTP setup
  const [totpSetup, setTotpSetup] = useState(null); // { secret, qrDataUrl }
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);

  // WebAuthn
  const [webauthnName, setWebauthnName] = useState('');
  const [showWebauthnSetup, setShowWebauthnSetup] = useState(false);

  // Password prompt for destructive actions
  const [confirmAction, setConfirmAction] = useState(null); // { type, id?, callback }
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    if (open && user?.orgFeatureMfa) {
      fetchMfaStatus();
      if (mfaSetupRequired) setActiveSection('mfa');
    }
  }, [open]);

  async function fetchMfaStatus() {
    try {
      const res = await fetch(`${API}/mfa/status`, { credentials: 'include' });
      if (res.ok) setMfaStatus(await res.json());
    } catch {}
  }

  if (!open) return null;

  const isForced = user?.mustChangePassword;
  const showMfa = user?.orgFeatureMfa;

  const handleClose = () => {
    if (mfaSetupRequired) return; // Can't dismiss
    if (isForced) {
      dismissPasswordChange();
      return;
    }
    setOpen(false);
    resetState();
  };

  function resetState() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setTotpSetup(null);
    setTotpCode('');
    setBackupCodes(null);
    setShowWebauthnSetup(false);
    setWebauthnName('');
    setConfirmAction(null);
    setConfirmPw('');
  }

  // --- Password change ---
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) { setError(t('auth.passwordMismatch', lang)); return; }
    if (newPassword.length < 6) { setError(t('auth.passwordTooShort', lang)); return; }
    setPwLoading(true);
    try {
      await changePassword(isForced ? null : currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setSuccess(lang === 'no' ? 'Passord endret' : 'Password changed');
    } catch (err) { setError(err.message); }
    finally { setPwLoading(false); }
  };

  // --- TOTP setup ---
  const handleTotpSetup = async () => {
    setError('');
    setMfaLoading(true);
    try {
      const res = await fetch(`${API}/mfa/totp/setup`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setTotpSetup(await res.json());
    } catch (err) { setError(err.message); }
    finally { setMfaLoading(false); }
  };

  const handleTotpConfirm = async (e) => {
    e.preventDefault();
    setError('');
    setMfaLoading(true);
    try {
      const res = await fetch(`${API}/mfa/totp/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: totpCode }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      setBackupCodes(data.backupCodes);
      setTotpSetup(null);
      setTotpCode('');
      fetchMfaStatus();
      // If MFA setup was required, clear the requirement
      if (mfaSetupRequired) {
        useAuthStore.setState({ mfaSetupRequired: false });
        // Re-check session to get updated user
        useAuthStore.getState().checkSession();
      }
    } catch (err) { setError(err.message); }
    finally { setMfaLoading(false); }
  };

  // --- TOTP disable ---
  const handleTotpDisable = async () => {
    if (!confirmPw) { setError(lang === 'no' ? 'Passord påkrevd' : 'Password required'); return; }
    setMfaLoading(true);
    try {
      const res = await fetch(`${API}/mfa/totp`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: confirmPw }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setConfirmAction(null); setConfirmPw('');
      fetchMfaStatus();
    } catch (err) { setError(err.message); }
    finally { setMfaLoading(false); }
  };

  // --- WebAuthn ---
  const handleWebAuthnRegister = async () => {
    setError('');
    setMfaLoading(true);
    try {
      const optRes = await fetch(`${API}/mfa/webauthn/register-options`, {
        method: 'POST', credentials: 'include',
      });
      if (!optRes.ok) { const d = await optRes.json(); throw new Error(d.error); }
      const options = await optRes.json();

      const credential = await startRegistration({ optionsJSON: options });

      const regRes = await fetch(`${API}/mfa/webauthn/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential, name: webauthnName || 'Security Key' }),
      });
      if (!regRes.ok) { const d = await regRes.json(); throw new Error(d.error); }
      const data = await regRes.json();
      if (data.backupCodes) setBackupCodes(data.backupCodes);
      setShowWebauthnSetup(false);
      setWebauthnName('');
      fetchMfaStatus();
      if (mfaSetupRequired) {
        useAuthStore.setState({ mfaSetupRequired: false });
        useAuthStore.getState().checkSession();
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') setError(err.message);
    }
    finally { setMfaLoading(false); }
  };

  const handleWebAuthnRemove = async (credId) => {
    if (!confirmPw) { setError(lang === 'no' ? 'Passord påkrevd' : 'Password required'); return; }
    setMfaLoading(true);
    try {
      const res = await fetch(`${API}/mfa/webauthn/${credId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: confirmPw }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setConfirmAction(null); setConfirmPw('');
      fetchMfaStatus();
    } catch (err) { setError(err.message); }
    finally { setMfaLoading(false); }
  };

  // --- Backup codes ---
  const handleRegenerateCodes = async () => {
    if (!confirmPw) { setError(lang === 'no' ? 'Passord påkrevd' : 'Password required'); return; }
    setMfaLoading(true);
    try {
      const res = await fetch(`${API}/mfa/backup-codes/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: confirmPw }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      setBackupCodes(data.backupCodes);
      setConfirmAction(null); setConfirmPw('');
      fetchMfaStatus();
    } catch (err) { setError(err.message); }
    finally { setMfaLoading(false); }
  };

  const handleConfirmSubmit = () => {
    if (confirmAction?.type === 'disable-totp') handleTotpDisable();
    else if (confirmAction?.type === 'remove-webauthn') handleWebAuthnRemove(confirmAction.id);
    else if (confirmAction?.type === 'regenerate-codes') handleRegenerateCodes();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-emerald-400">{t('security.title', lang)}</h2>
            {showMfa && (
              <div className="flex gap-1">
                <button onClick={() => setActiveSection('password')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${activeSection === 'password' ? 'bg-slate-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  {t('security.changePassword', lang)}
                </button>
                <button onClick={() => setActiveSection('mfa')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${activeSection === 'mfa' ? 'bg-slate-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  {t('mfa.title', lang)}
                </button>
              </div>
            )}
          </div>
          {!mfaSetupRequired && (
            <button onClick={handleClose} className="text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <p className="text-red-400 text-sm">{error}<button onClick={() => setError('')} className="ml-2 text-red-300">&times;</button></p>}
          {success && <p className="text-emerald-400 text-sm">{success}</p>}

          {mfaSetupRequired && activeSection === 'mfa' && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3">
              <p className="text-amber-400 text-sm">{t('mfa.required', lang)}</p>
            </div>
          )}

          {/* Backup codes display (shown after setup) */}
          {backupCodes && (
            <div className="bg-slate-700/50 border border-amber-500/30 rounded p-4 space-y-3">
              <h3 className="text-sm font-bold text-amber-400">{t('mfa.backup.title', lang)}</h3>
              <p className="text-xs text-slate-400">{t('mfa.backup.warning', lang)}</p>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <code key={i} className="text-sm text-white bg-slate-900 px-3 py-1.5 rounded text-center font-mono">{code}</code>
                ))}
              </div>
              <button onClick={() => setBackupCodes(null)}
                className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded transition-colors">
                {lang === 'no' ? 'Jeg har lagret kodene' : "I've saved these codes"}
              </button>
            </div>
          )}

          {/* Password change section */}
          {activeSection === 'password' && !backupCodes && (
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              {!isForced && (
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('auth.currentPassword', lang)}</label>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
                    autoComplete="current-password" />
                </div>
              )}
              <div>
                <label className="block text-sm text-slate-300 mb-1">{t('auth.newPassword', lang)}</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
                  autoFocus autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">{t('auth.confirmPassword', lang)}</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500"
                  autoComplete="new-password" />
              </div>
              <div className="flex justify-end">
                <button type="submit" disabled={pwLoading || !newPassword || !confirmPassword}
                  className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50">
                  {pwLoading ? t('general.loading', lang) : t('auth.changePassword', lang)}
                </button>
              </div>
            </form>
          )}

          {/* MFA section */}
          {activeSection === 'mfa' && !backupCodes && showMfa && (
            <div className="space-y-4">
              {/* TOTP setup flow */}
              {totpSetup && (
                <div className="space-y-3 bg-slate-700/50 rounded p-4">
                  <h3 className="text-sm font-bold text-emerald-400">{t('mfa.totp.setup', lang)}</h3>
                  <p className="text-xs text-slate-400">{t('mfa.totp.scanQr', lang)}</p>
                  <div className="flex justify-center">
                    <img src={totpSetup.qrDataUrl} alt="QR Code" className="w-48 h-48 rounded" />
                  </div>
                  <p className="text-xs text-slate-500 break-all text-center font-mono">{totpSetup.secret}</p>
                  <form onSubmit={handleTotpConfirm} className="flex gap-2">
                    <input type="text" inputMode="numeric" maxLength={6}
                      value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder={t('mfa.totp.enterCode', lang)}
                      className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-center font-mono focus:outline-none focus:border-emerald-500"
                      autoFocus />
                    <button type="submit" disabled={mfaLoading || totpCode.length !== 6}
                      className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50">
                      {t('mfa.verify', lang)}
                    </button>
                  </form>
                  <button onClick={() => setTotpSetup(null)} className="text-xs text-slate-400 hover:text-white">
                    {t('general.cancel', lang)}
                  </button>
                </div>
              )}

              {/* WebAuthn setup */}
              {showWebauthnSetup && (
                <div className="space-y-3 bg-slate-700/50 rounded p-4">
                  <h3 className="text-sm font-bold text-emerald-400">{t('mfa.webauthn.setup', lang)}</h3>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('mfa.webauthn.name', lang)}</label>
                    <input type="text" value={webauthnName} onChange={(e) => setWebauthnName(e.target.value)}
                      placeholder="YubiKey 5"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500" />
                  </div>
                  <button onClick={handleWebAuthnRegister} disabled={mfaLoading}
                    className="w-full px-4 py-3 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    {mfaLoading ? t('general.loading', lang) : t('mfa.webauthn.tap', lang)}
                  </button>
                  <button onClick={() => setShowWebauthnSetup(false)} className="text-xs text-slate-400 hover:text-white">
                    {t('general.cancel', lang)}
                  </button>
                </div>
              )}

              {/* Setup buttons when no MFA flow is active */}
              {!totpSetup && !showWebauthnSetup && (
                <>
                  {/* TOTP status */}
                  {mfaStatus?.totpEnabled ? (
                    <div className="flex items-center justify-between bg-slate-700/50 rounded p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm text-slate-200">{t('mfa.totp.enabled', lang)}</span>
                      </div>
                      <button onClick={() => setConfirmAction({ type: 'disable-totp' })}
                        className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 rounded transition-colors">
                        {t('mfa.totp.disable', lang)}
                      </button>
                    </div>
                  ) : (
                    <button onClick={handleTotpSetup} disabled={mfaLoading}
                      className="w-full p-3 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors text-left flex items-center gap-3">
                      <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <div>
                        <span className="text-sm text-slate-200">{t('mfa.totp.setup', lang)}</span>
                        <p className="text-xs text-slate-400">Google Authenticator, Authy, etc.</p>
                      </div>
                    </button>
                  )}

                  {/* WebAuthn credentials */}
                  {mfaStatus?.webauthnCredentials?.length > 0 && (
                    <div className="space-y-2">
                      {mfaStatus.webauthnCredentials.map((cred) => (
                        <div key={cred.id} className="flex items-center justify-between bg-slate-700/50 rounded p-3">
                          <div>
                            <span className="text-sm text-slate-200">{cred.name}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {t('mfa.webauthn.registered', lang)} {new Date(cred.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <button onClick={() => setConfirmAction({ type: 'remove-webauthn', id: cred.id })}
                            className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 rounded transition-colors">
                            {t('mfa.webauthn.remove', lang)}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button onClick={() => setShowWebauthnSetup(true)}
                    className="w-full p-3 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors text-left flex items-center gap-3">
                    <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    <div>
                      <span className="text-sm text-slate-200">{t('mfa.webauthn.setup', lang)}</span>
                      <p className="text-xs text-slate-400">YubiKey, passkey, etc.</p>
                    </div>
                  </button>

                  {/* Backup codes */}
                  {mfaStatus && (mfaStatus.totpEnabled || mfaStatus.webauthnCredentials?.length > 0) && (
                    <div className="flex items-center justify-between bg-slate-700/50 rounded p-3">
                      <div>
                        <span className="text-sm text-slate-200">{t('mfa.backup.title', lang)}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          {mfaStatus.backupCodesRemaining} {t('mfa.backup.remaining', lang)}
                        </span>
                      </div>
                      <button onClick={() => setConfirmAction({ type: 'regenerate-codes' })}
                        className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded transition-colors">
                        {t('mfa.backup.regenerate', lang)}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Password confirmation modal */}
        {confirmAction && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
            <div className="bg-slate-800 border border-slate-600 rounded p-4 w-72 space-y-3">
              <p className="text-sm text-slate-200">{lang === 'no' ? 'Bekreft med passord' : 'Confirm with password'}</p>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
                autoFocus placeholder={t('auth.password', lang)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirmSubmit()} />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setConfirmAction(null); setConfirmPw(''); setError(''); }}
                  className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded">{t('general.cancel', lang)}</button>
                <button onClick={handleConfirmSubmit} disabled={!confirmPw || mfaLoading}
                  className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 rounded disabled:opacity-50">
                  {lang === 'no' ? 'Bekreft' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
