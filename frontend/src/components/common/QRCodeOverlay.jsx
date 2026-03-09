import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';
import ExportMenu from './ExportMenu.jsx';

const EXPIRY_OPTIONS = [
  { value: '24h', labelKey: 'share.expiry24h' },
  { value: '7d', labelKey: 'share.expiry7d' },
  { value: '30d', labelKey: 'share.expiry30d' },
  { value: 'never', labelKey: 'share.expiryNever' },
];

const QR_SIZE = 256;
const LOGO_SIZE = 32;
const BOTTOM_HEIGHT = 48; // space for logo + text below QR
const CANVAS_WIDTH = QR_SIZE + 8; // QR margin (4px each side)
const CANVAS_HEIGHT = QR_SIZE + 8 + BOTTOM_HEIGHT;

export default function QRCodeOverlay({ resourceType = 'theme', resourceId, resourceName, layerId, layerName, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const signalLinked = useAuthStore((s) => s.signalLinked);
  const prepareSignalUpload = useAuthStore((s) => s.prepareSignalUpload);
  const prepareSignalLinkShare = useAuthStore((s) => s.prepareSignalLinkShare);
  const user = useAuthStore((s) => s.user);
  const displayCanvasRef = useRef(null);
  const qrCanvasRef = useRef(null);
  const logoRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [accessMode, setAccessMode] = useState('current');
  const [expiresIn, setExpiresIn] = useState('7d');
  const [shareToken, setShareToken] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Build URL based on access mode
  const currentUrl = resourceType === 'theme'
    ? `${window.location.origin}/?theme=${resourceId}`
    : layerId
      ? `${window.location.origin}/?project=${resourceId}&layer=${layerId}`
      : `${window.location.origin}/?project=${resourceId}`;

  const activeUrl = accessMode === 'directLink' && shareToken
    ? `${window.location.origin}/?share=${shareToken}${layerId ? `&layer=${layerId}` : ''}`
    : currentUrl;

  // Load logo image once
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      logoRef.current = img;
      setLogoLoaded(true);
    };
    img.src = '/android-chrome-192x192.png';
  }, []);

  // Composite QR + logo + text onto display canvas
  const compositeCanvas = () => {
    const display = displayCanvasRef.current;
    const qr = qrCanvasRef.current;
    if (!display || !qr) return;

    display.width = CANVAS_WIDTH;
    display.height = CANVAS_HEIGHT;
    const ctx = display.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw QR code centered
    const qrX = (CANVAS_WIDTH - qr.width) / 2;
    ctx.drawImage(qr, qrX, 4);

    // Draw logo + text below
    const bottomY = QR_SIZE + 12;
    const logo = logoRef.current;

    if (logo) {
      const logoX = (CANVAS_WIDTH - LOGO_SIZE - 8 - 80) / 2; // approx center logo+text
      ctx.drawImage(logo, logoX, bottomY, LOGO_SIZE, LOGO_SIZE);

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('IntelMap', logoX + LOGO_SIZE + 8, bottomY + LOGO_SIZE / 2);
    } else {
      // Fallback: text only
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('IntelMap', CANVAS_WIDTH / 2, bottomY + 16);
    }

    setQrDataUrl(display.toDataURL('image/png'));
  };

  // Generate QR code whenever URL changes (only after confirmed)
  useEffect(() => {
    if (!confirmed) return;
    if (!qrCanvasRef.current || !activeUrl) return;
    QRCode.toCanvas(qrCanvasRef.current, activeUrl, {
      width: QR_SIZE,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(() => compositeCanvas());
  }, [confirmed, activeUrl, logoLoaded]);

  // Create share token only after confirmed and in directLink mode
  useEffect(() => {
    if (!confirmed) return;
    if (accessMode !== 'directLink') {
      setShareToken(null);
      return;
    }

    setGenerating(true);
    const endpoint = `/api/${resourceType === 'theme' ? 'themes' : 'projects'}/${resourceId}/share-token`;

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ expiresIn, layerId: layerId || undefined }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.token) {
          setShareToken(data.token);
        }
      })
      .catch(() => {})
      .finally(() => setGenerating(false));
  }, [confirmed, accessMode, expiresIn, resourceId, resourceType]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSaveToDisk = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `${resourceType}-${resourceName.replace(/[^a-zA-Z0-9]/g, '_')}-qr.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const handleWasosTransfer = () => {
    if (!qrDataUrl) return;
    prepareWasosUpload(qrDataUrl, null, `${resourceType}-${resourceName.replace(/[^a-zA-Z0-9]/g, '_')}-qr.png`);
    onClose();
  };

  const handleSignalTransfer = () => {
    if (!qrDataUrl) return;
    prepareSignalUpload(qrDataUrl, null, `${resourceType}-${resourceName.replace(/[^a-zA-Z0-9]/g, '_')}-qr.png`);
    onClose();
  };

  const handleSignalLink = () => {
    const label = `${resourceName}${layerName ? ` \u2192 ${layerName}` : ''}`;
    prepareSignalLinkShare(activeUrl, label);
    onClose();
  };

  const title = resourceType === 'theme'
    ? t('themes.qrTitle', lang)
    : t('share.projectQr', lang);

  const canCreateTokens = !!user;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Resource name */}
        <p className="text-sm text-slate-400 mb-4">
          {resourceType === 'theme' ? t('themes.qrLinkTo', lang) : t('share.qrLinkTo', lang)}{' '}
          <span className="text-emerald-400 font-medium">{resourceName}</span>
          {layerName && (
            <span className="text-cyan-400"> &rarr; {layerName}</span>
          )}
        </p>

        {!confirmed ? (
          <>
            {/* Step 1: Choose share options */}
            {canCreateTokens && (
              <div className="mb-4 space-y-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="accessMode"
                    checked={accessMode === 'current'}
                    onChange={() => setAccessMode('current')}
                    className="accent-emerald-500 mt-0.5"
                  />
                  <div>
                    <span className={accessMode === 'current' ? 'text-emerald-400' : 'text-slate-300'}>
                      {t('share.currentAccess', lang)}
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'no' ? 'Mottaker må logge inn — begrenset til egne rettigheter' : 'Receiver must log in — restricted to their own rights'}
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="accessMode"
                    checked={accessMode === 'directLink'}
                    onChange={() => setAccessMode('directLink')}
                    className="accent-emerald-500 mt-0.5"
                  />
                  <div>
                    <span className={accessMode === 'directLink' ? 'text-emerald-400' : 'text-slate-300'}>
                      {t('share.directLink', lang)}
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'no' ? 'Alle med lenken har tilgang — ingen innlogging' : 'Anyone with the link has access — no login required'}
                    </p>
                  </div>
                </label>

                {accessMode === 'directLink' && (
                  <div className="ml-6 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{t('share.expiry', lang)}:</span>
                      <select
                        value={expiresIn}
                        onChange={(e) => setExpiresIn(e.target.value)}
                        className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200"
                      >
                        {EXPIRY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey, lang)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-amber-400/80">
                      {t('share.directLinkNote', lang)}
                    </p>
                    <p className="text-xs text-red-400/80 font-bold">
                      {t('share.securityWarning', lang)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Confirm / Cancel */}
            <div className="flex justify-between items-center">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300 transition-colors"
              >
                {lang === 'no' ? 'Avbryt' : 'Cancel'}
              </button>
              <button
                onClick={() => setConfirmed(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white font-medium transition-colors"
              >
                {lang === 'no' ? 'Ok, del' : 'Ok, share'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: QR code + export */}
            {/* QR Code with logo */}
            <div className="flex justify-center mb-4 bg-white p-4 rounded relative">
              {/* Hidden canvas for QR generation */}
              <canvas ref={qrCanvasRef} style={{ display: 'none' }} />
              {/* Display canvas with QR + logo + text */}
              <canvas ref={displayCanvasRef} />
              {generating && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded">
                  <span className="text-sm text-slate-600">{t('share.generating', lang)}</span>
                </div>
              )}
            </div>

            {/* URL display + copy */}
            <div className="mb-4 flex items-center gap-2 p-2 bg-slate-900 rounded">
              <span className="flex-1 text-xs text-slate-400 break-all font-mono select-all cursor-text">{activeUrl}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(activeUrl); }}
                className="shrink-0 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300 transition-colors"
                title={lang === 'no' ? 'Kopier lenke' : 'Copy link'}
              >
                {lang === 'no' ? 'Kopier' : 'Copy'}
              </button>
            </div>

            {/* Export buttons */}
            <div className="flex justify-between items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300 transition-colors"
              >
                {lang === 'no' ? 'Lukk' : 'Close'}
              </button>
              <div className="flex items-center gap-2">
                {user?.signalEnabled && signalLinked && (
                  <button
                    onClick={handleSignalLink}
                    className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm text-white transition-colors flex items-center gap-2"
                    title={lang === 'no' ? 'Del lenke via Signal' : 'Share link via Signal'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                    Signal
                  </button>
                )}
                <ExportMenu
                  onSaveToDisk={handleSaveToDisk}
                  onTransferToWasos={handleWasosTransfer}
                  wasosLoggedIn={wasosLoggedIn}
                  onSendToSignal={user?.signalEnabled ? handleSignalTransfer : undefined}
                  signalLinked={signalLinked}
                  buttonLabel={t('themes.exportQr', lang)}
                  buttonClassName="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm text-white transition-colors flex items-center gap-2"
                  buttonIcon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
