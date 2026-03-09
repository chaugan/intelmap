import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { drawSecurityMarking } from '../../lib/export-marking.js';
import { t } from '../../lib/i18n.js';

const SIGNAL_API = '/api/signal';

export default function SignalUploadDialog() {
  const signalUploadOpen = useAuthStore((s) => s.signalUploadOpen);
  const signalUploadData = useAuthStore((s) => s.signalUploadData);
  const setSignalUploadOpen = useAuthStore((s) => s.setSignalUploadOpen);
  const uploadToSignal = useAuthStore((s) => s.uploadToSignal);
  const signalUploading = useAuthStore((s) => s.signalUploading);
  const user = useAuthStore((s) => s.user);
  const lang = useMapStore((s) => s.lang);

  const [description, setDescription] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const isLinkMode = signalUploadData?.linkUrl && !signalUploadData?.image;

  useEffect(() => {
    if (signalUploadOpen) {
      setDescription(signalUploadData?.linkUrl || '');
      setError('');
      setSuccess(false);
      setSelectedGroup('');
      fetchGroups();
    }
  }, [signalUploadOpen]);

  async function fetchGroups() {
    setLoadingGroups(true);
    try {
      const res = await fetch(`${SIGNAL_API}/groups`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        if (data.length === 1) setSelectedGroup(data[0].id);
      } else {
        setGroups([]);
      }
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }

  function applySecurityMarking(imageDataUrl) {
    return new Promise((resolve) => {
      if (!user?.exportMarking || user.exportMarking === 'none') {
        resolve(imageDataUrl);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        drawSecurityMarking(ctx, canvas.width, canvas.height, user.exportMarking, user.exportMarkingCorner, user.exportMarkingText);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(imageDataUrl);
      img.src = imageDataUrl;
    });
  }

  const handleClose = () => {
    setSignalUploadOpen(false);
    setDescription('');
    setError('');
    setSuccess(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedGroup) {
      setError(t('signal.selectGroup', lang));
      return;
    }
    setError('');
    try {
      if (isLinkMode) {
        // Link-only mode: send link text as caption
        await uploadToSignal(selectedGroup, description);
      } else {
        // Apply security marking to image before sending
        const markedImage = await applySecurityMarking(signalUploadData.image);
        // Temporarily swap image data with marked version
        const origImage = signalUploadData.image;
        signalUploadData.image = markedImage;
        await uploadToSignal(selectedGroup, description);
        signalUploadData.image = origImage;
      }
      setSuccess(true);
    } catch (err) {
      setError(err.message || t('signal.uploadFailed', lang));
    }
  };

  if (!signalUploadOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Success state */}
        {success ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-emerald-400 mb-2">
              {t('signal.uploadSuccess', lang)}
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              {isLinkMode
                ? (lang === 'no' ? 'Lenken er sendt til Signal-gruppen' : 'Link sent to Signal group')
                : (lang === 'no' ? 'Bildet er sendt til Signal-gruppen' : 'Image sent to Signal group')
              }
            </p>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors"
            >
              {lang === 'no' ? 'Lukk' : 'Close'}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">
                {isLinkMode ? (lang === 'no' ? 'Del lenke via Signal' : 'Share link via Signal') : t('signal.transfer', lang)}
              </h2>
              <button onClick={handleClose} className="text-slate-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Preview */}
            {isLinkMode ? (
              <div className="mb-4 p-3 bg-slate-900 rounded border border-slate-600">
                <div className="text-xs text-slate-500 mb-1">{lang === 'no' ? 'Lenke' : 'Link'}</div>
                <div className="text-sm text-blue-400 break-all font-mono">{signalUploadData.linkUrl}</div>
                {signalUploadData.linkLabel && (
                  <div className="text-xs text-slate-400 mt-1">{signalUploadData.linkLabel}</div>
                )}
              </div>
            ) : signalUploadData?.preview ? (
              <div className="mb-4">
                <img
                  src={signalUploadData.preview}
                  alt="Upload preview"
                  className="w-full max-h-48 object-contain rounded border border-slate-600 bg-slate-900"
                />
              </div>
            ) : null}

            {/* Security marking indicator */}
            {user?.exportMarking && user.exportMarking !== 'none' && (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>
                  {lang === 'no' ? 'Sikkerhetsmerking' : 'Security marking'}: <span className="text-amber-400 font-medium uppercase">{user.exportMarking === 'custom' ? user.exportMarkingText : user.exportMarking}</span>
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Group picker */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t('signal.selectGroup', lang)}
                </label>
                {loadingGroups ? (
                  <div className="text-sm text-slate-500 py-2">{t('signal.loadingGroups', lang)}</div>
                ) : groups.length === 0 ? (
                  <div className="text-sm text-slate-500 py-2">{t('signal.noGroups', lang)}</div>
                ) : (
                  <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                    disabled={signalUploading}
                  >
                    <option value="">-- {t('signal.selectGroup', lang)} --</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.membersCount} {t('signal.members', lang)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t('signal.uploadText', lang)}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder=""
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                  disabled={signalUploading}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/50 rounded">
                  <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
                  disabled={signalUploading}
                >
                  {t('signal.cancel', lang)}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm transition-colors disabled:opacity-50"
                  disabled={signalUploading || !selectedGroup || groups.length === 0}
                >
                  {signalUploading ? t('signal.uploading', lang) : isLinkMode ? (lang === 'no' ? 'Send lenke' : 'Send link') : t('signal.send', lang)}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
