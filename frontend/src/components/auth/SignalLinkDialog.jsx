import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const SIGNAL_API = '/api/signal';

export default function SignalLinkDialog() {
  const signalLinkOpen = useAuthStore((s) => s.signalLinkOpen);
  const setSignalLinkOpen = useAuthStore((s) => s.setSignalLinkOpen);
  const signalLinked = useAuthStore((s) => s.signalLinked);
  const signalPhone = useAuthStore((s) => s.signalPhone);
  const checkSignalStatus = useAuthStore((s) => s.checkSignalStatus);
  const unlinkSignal = useAuthStore((s) => s.unlinkSignal);
  const lang = useMapStore((s) => s.lang);

  const [step, setStep] = useState('warning'); // 'warning' | 'qr' | 'phone' | 'success'
  const [qrCode, setQrCode] = useState(null);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  useEffect(() => {
    if (signalLinkOpen) {
      setError('');
      setConsentChecked(false);
      if (signalLinked) {
        setStep('success');
      } else {
        setStep('warning');
      }
      setQrCode(null);
      setPhone('');
    }
  }, [signalLinkOpen, signalLinked]);

  const handleClose = () => {
    setSignalLinkOpen(false);
  };

  const startLinking = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SIGNAL_API}/link`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('signal.linkFailed', lang));
      }
      const data = await res.json();
      setQrCode(data.qrCode || null);
      setStep('qr');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmLink = async () => {
    if (!phone || !/^\+\d{8,15}$/.test(phone)) {
      setError(lang === 'no' ? 'Ugyldig telefonnummer (f.eks. +4712345678)' : 'Invalid phone number (e.g. +4712345678)');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SIGNAL_API}/confirm-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('signal.linkFailed', lang));
      }
      await checkSignalStatus();
      setStep('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm(t('signal.confirmUnlink', lang))) return;
    await unlinkSignal();
    handleClose();
  };

  if (!signalLinkOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/>
            </svg>
            {t('signal.linkTitle', lang)}
          </h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step: Privacy Warning */}
        {step === 'warning' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('signal.linkDescription', lang)}
            </p>

            {/* Warning box */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <h3 className="text-sm font-semibold text-amber-400">
                  {t('signal.linkWarningTitle', lang)}
                </h3>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {t('signal.linkWarning', lang)}
              </p>

              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">1.</span>
                  {t('signal.linkWarningBullet1', lang)}
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">2.</span>
                  {t('signal.linkWarningBullet2', lang)}
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">3.</span>
                  {t('signal.linkWarningBullet3', lang)}
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">4.</span>
                  {t('signal.linkWarningBullet4', lang)}
                </li>
              </ul>
            </div>

            {/* Consent checkbox */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="w-4 h-4 rounded border-slate-500 text-emerald-600 focus:ring-emerald-500 bg-slate-700"
              />
              <span className="text-sm text-slate-200 font-medium">
                {t('signal.linkConsent', lang)}
              </span>
            </label>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
              >
                {t('signal.cancel', lang)}
              </button>
              <button
                onClick={startLinking}
                disabled={!consentChecked || loading}
                className="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : (lang === 'no' ? 'Fortsett' : 'Continue')}
              </button>
            </div>
          </div>
        )}

        {/* Step: QR Code */}
        {step === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('signal.scanQr', lang)}
            </p>

            {qrCode ? (
              <div className="flex justify-center">
                <img
                  src={qrCode}
                  alt="Signal QR Code"
                  className="w-64 h-64 bg-white rounded-lg p-2"
                />
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <div className="text-slate-400 text-sm">{t('signal.serviceBusy', lang)}</div>
              </div>
            )}

            <div className="bg-slate-700/50 rounded p-3 space-y-1">
              <p className="text-xs text-slate-400">1. {t('signal.scanStep1', lang)}</p>
              <p className="text-xs text-slate-400">2. {t('signal.scanStep2', lang)}</p>
              <p className="text-xs text-slate-400">3. {t('signal.scanStep3', lang)}</p>
              <p className="text-xs text-amber-400 font-medium">4. {t('signal.scanStep4', lang)}</p>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setStep('warning')}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
              >
                {lang === 'no' ? 'Tilbake' : 'Back'}
              </button>
              <button
                onClick={() => setStep('phone')}
                disabled={!qrCode}
                className="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm transition-colors disabled:opacity-50"
              >
                {lang === 'no' ? 'Neste' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {/* Step: Enter Phone Number */}
        {step === 'phone' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('signal.enterPhone', lang)}
            </p>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t('signal.phoneLabel', lang)}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('signal.phonePlaceholder', lang)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setStep('qr'); setError(''); }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
              >
                {lang === 'no' ? 'Tilbake' : 'Back'}
              </button>
              <button
                onClick={confirmLink}
                disabled={loading || !phone}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
              >
                {loading ? '...' : t('signal.confirmLink', lang)}
              </button>
            </div>
          </div>
        )}

        {/* Step: Success / Already Linked */}
        {step === 'success' && (
          <div className="text-center py-4 space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-emerald-400">
              {t('signal.linkSuccess', lang)}
            </h3>
            {signalPhone && (
              <p className="text-sm text-slate-400">{signalPhone}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleUnlink}
                className="flex-1 px-4 py-2 bg-red-700/30 hover:bg-red-700/50 text-red-400 rounded text-sm transition-colors"
              >
                {t('signal.unlink', lang)}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors"
              >
                {lang === 'no' ? 'Lukk' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
