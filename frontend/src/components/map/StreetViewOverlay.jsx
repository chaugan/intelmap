import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function StreetViewOverlay({ lat, lng, apiKey, heading = 0, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center"
         onClick={onClose}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white text-xl flex items-center justify-center z-[10000]">
        ✕
      </button>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-2">
          <span className="text-white font-semibold">Street View</span>
          <span className="text-slate-400 text-sm ml-3">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
        </div>
        <iframe
          src={`https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lng}&heading=${heading}&pitch=0&fov=90`}
          width={Math.min(window.innerWidth * 0.9, 1200)}
          height={Math.min(window.innerHeight * 0.8, 800)}
          style={{ border: 0, borderRadius: '8px' }}
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>,
    document.body
  );
}
