import { useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function ThemeErrorDialog({ error, onClose }) {
  const lang = useMapStore((s) => s.lang);

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

  const isNotFound = error === 'notFound';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isNotFound ? 'bg-slate-700' : 'bg-red-900/50'}`}>
            {isNotFound ? (
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-white text-center mb-2">
          {t(isNotFound ? 'themes.notFound' : 'themes.permissionDenied', lang)}
        </h3>

        {/* Description */}
        <p className="text-sm text-slate-400 text-center mb-6">
          {t(isNotFound ? 'themes.notFoundDesc' : 'themes.permissionDeniedDesc', lang)}
        </p>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white transition-colors"
        >
          {t('general.close', lang)}
        </button>
      </div>
    </div>
  );
}
