import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';

export default function QRCodeOverlay({ themeId, themeName, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const canvasRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);

  const themeUrl = `${window.location.origin}/?theme=${themeId}`;

  // Generate QR code on mount
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, themeUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then(() => {
        setQrDataUrl(canvasRef.current.toDataURL('image/png'));
      });
    }
  }, [themeUrl]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSaveToDisk = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `theme-${themeName.replace(/[^a-zA-Z0-9]/g, '_')}-qr.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const handleWasosTransfer = () => {
    if (!qrDataUrl) return;
    prepareWasosUpload(qrDataUrl, null, `theme-${themeName.replace(/[^a-zA-Z0-9]/g, '_')}-qr.png`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            {t('themes.generateQr', lang)}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Theme name */}
        <p className="text-sm text-slate-400 mb-4 truncate">
          {themeName}
        </p>

        {/* QR Code */}
        <div className="flex justify-center mb-4 bg-white p-4 rounded">
          <canvas ref={canvasRef} />
        </div>

        {/* URL display */}
        <div className="mb-4 p-2 bg-slate-900 rounded text-xs text-slate-400 break-all font-mono">
          {themeUrl}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSaveToDisk}
            className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm text-white transition-colors"
          >
            {t('themes.saveQr', lang)}
          </button>
          {wasosLoggedIn && (
            <button
              onClick={handleWasosTransfer}
              className="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm text-white transition-colors"
            >
              {t('wasos.transfer', lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
