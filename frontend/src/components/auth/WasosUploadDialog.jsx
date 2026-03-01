import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

/**
 * Dialog for entering description before uploading to WaSOS.
 * Opens when user clicks "Transfer to WaSOS" in export menu.
 */
export default function WasosUploadDialog() {
  const wasosUploadOpen = useAuthStore((s) => s.wasosUploadOpen);
  const wasosUploadData = useAuthStore((s) => s.wasosUploadData);
  const setWasosUploadOpen = useAuthStore((s) => s.setWasosUploadOpen);
  const uploadToWasos = useAuthStore((s) => s.uploadToWasos);
  const wasosUploading = useAuthStore((s) => s.wasosUploading);
  const lang = useMapStore((s) => s.lang);

  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (wasosUploadOpen) {
      setDescription('');
      setError('');
    }
  }, [wasosUploadOpen]);

  if (!wasosUploadOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await uploadToWasos(description);
      handleClose();
    } catch (err) {
      setError(err.message || t('wasos.uploadFailed', lang));
    }
  };

  const handleClose = () => {
    setWasosUploadOpen(false);
    setDescription('');
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
          <h2 className="text-lg font-bold">{t('wasos.transfer', lang)}</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview of what's being uploaded */}
        {wasosUploadData?.preview && (
          <div className="mb-4">
            <img
              src={wasosUploadData.preview}
              alt="Upload preview"
              className="w-full h-32 object-cover rounded border border-slate-600"
            />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t('wasos.uploadText', lang)}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('wasos.defaultDescription', lang)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
              disabled={wasosUploading}
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
              disabled={wasosUploading}
            >
              {t('wasos.cancel', lang)}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
              disabled={wasosUploading}
            >
              {wasosUploading ? t('wasos.uploading', lang) : t('wasos.upload', lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
