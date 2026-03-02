import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import ExportMenu from '../common/ExportMenu.jsx';

export default function StreetViewOverlay({ lat, lng, apiKey, heading = 0, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const [exporting, setExporting] = useState(false);

  // Current view params for export (user can adjust these)
  const [viewHeading, setViewHeading] = useState(heading);
  const [viewPitch, setViewPitch] = useState(0);
  const [viewFov, setViewFov] = useState(90);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Fetch the static image for export
  const fetchStaticImage = useCallback(async () => {
    const url = `/api/streetview/image?lat=${lat}&lng=${lng}&heading=${viewHeading}&pitch=${viewPitch}&fov=${viewFov}&size=1600x1200`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch image');
    const blob = await resp.blob();
    return blob;
  }, [lat, lng, viewHeading, viewPitch, viewFov]);

  // Save to disk
  const handleSaveToDisk = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await fetchStaticImage();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      a.download = `streetview_${lat.toFixed(5)}_${lng.toFixed(5)}_${localTime}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Street view export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [fetchStaticImage, lat, lng]);

  // Transfer to WaSOS
  const handleTransferToWasos = useCallback(async () => {
    if (!wasosLoggedIn) return;
    setExporting(true);
    try {
      const blob = await fetchStaticImage();
      // Convert blob to data URL
      const reader = new FileReader();
      reader.onloadend = () => {
        const now = new Date();
        const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
        const filename = `streetview_${lat.toFixed(5)}_${lng.toFixed(5)}_${localTime}.jpg`;
        prepareWasosUpload(reader.result, [lng, lat], filename);
        setExporting(false);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Street view WaSOS transfer failed:', err);
      setExporting(false);
    }
  }, [fetchStaticImage, wasosLoggedIn, prepareWasosUpload, lat, lng]);

  const iframeWidth = Math.min(window.innerWidth * 0.9, 1200);
  const iframeHeight = Math.min(window.innerHeight * 0.8, 800);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center"
         onClick={onClose}>
      {/* Close button */}
      <button onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white text-xl flex items-center justify-center z-[10000]">
        ✕
      </button>

      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {/* Header with title, coordinates, and export */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div>
            <span className="text-white font-semibold">Street View</span>
            <span className="text-slate-400 text-sm ml-3">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          </div>

          {/* Export controls */}
          <div className="flex items-center gap-3">
            {/* View params for export */}
            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-400">
                {lang === 'no' ? 'Retning' : 'Heading'}:
                <input
                  type="number"
                  min="0"
                  max="360"
                  value={viewHeading}
                  onChange={(e) => setViewHeading(Number(e.target.value))}
                  className="ml-1 w-14 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-white text-center"
                />°
              </label>
              <label className="text-slate-400">
                {lang === 'no' ? 'Tilt' : 'Pitch'}:
                <input
                  type="number"
                  min="-90"
                  max="90"
                  value={viewPitch}
                  onChange={(e) => setViewPitch(Number(e.target.value))}
                  className="ml-1 w-14 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-white text-center"
                />°
              </label>
            </div>

            {/* Export menu */}
            <ExportMenu
              onSaveToDisk={handleSaveToDisk}
              onTransferToWasos={handleTransferToWasos}
              wasosLoggedIn={wasosLoggedIn}
              disabled={exporting}
              buttonIcon={
                exporting ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )
              }
              buttonLabel={lang === 'no' ? 'Eksporter' : 'Export'}
              buttonClassName="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1 text-white text-sm"
            />
          </div>
        </div>

        {/* Street View iframe */}
        <iframe
          src={`https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lng}&heading=${heading}&pitch=0&fov=90`}
          width={iframeWidth}
          height={iframeHeight}
          style={{ border: 0, borderRadius: '8px' }}
          allowFullScreen
          loading="lazy"
        />

        {/* Note about export params */}
        <div className="text-center mt-2 text-slate-500 text-xs">
          {lang === 'no'
            ? 'Eksport bruker retning/tilt-verdiene ovenfor (juster for ønsket vinkel)'
            : 'Export uses heading/pitch values above (adjust for desired angle)'}
        </div>
      </div>
    </div>,
    document.body
  );
}
