import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Marker } from 'react-map-gl/maplibre';
import { useWebcamStore } from '../../stores/useWebcamStore.js';
import { useWebcams } from '../../hooks/useWebcams.js';
import { useMapStore } from '../../stores/useMapStore.js';
import DraggablePopup from './DraggablePopup.jsx';

export default function WebcamLayer() {
  const cameras = useWebcamStore((s) => s.cameras);
  const toggleCamera = useWebcamStore((s) => s.toggleCamera);
  const closeCamera = useWebcamStore((s) => s.closeCamera);
  const openCameras = useWebcamStore((s) => s.openCameras);
  const { fetchWebcams } = useWebcams();
  const mapRef = useMapStore((s) => s.mapRef);
  const lang = useMapStore((s) => s.lang);

  // Track which camera IDs are pinned
  const [pinnedIds, setPinnedIds] = useState(new Set());

  const pinCamera = useCallback((id) => {
    setPinnedIds((prev) => new Set(prev).add(id));
  }, []);

  const unpinCamera = useCallback((id) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const togglePinCamera = useCallback((id) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Close unpinned cameras on map click, pan, or zoom
  useEffect(() => {
    if (!mapRef) return;

    const closeUnpinned = () => {
      const unpinned = openCameras.filter((c) => !pinnedIds.has(c.properties.id));
      for (const cam of unpinned) {
        closeCamera(cam.properties.id);
      }
    };

    mapRef.on('click', closeUnpinned);
    mapRef.on('movestart', closeUnpinned);

    return () => {
      mapRef.off('click', closeUnpinned);
      mapRef.off('movestart', closeUnpinned);
    };
  }, [mapRef, openCameras, pinnedIds, closeCamera]);

  // Clean up pinned state when cameras are closed
  useEffect(() => {
    const openIds = new Set(openCameras.map((c) => c.properties.id));
    setPinnedIds((prev) => {
      const next = new Set();
      for (const id of prev) {
        if (openIds.has(id)) next.add(id);
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [openCameras]);

  useEffect(() => {
    if (cameras.length === 0) fetchWebcams();
  }, []);

  // Restore saved open cameras after cameras are fetched
  useEffect(() => {
    if (cameras.length === 0) return;
    const savedIds = window.__coremap_restore_cameras;
    if (savedIds?.length) {
      delete window.__coremap_restore_cameras;
      for (const camId of savedIds) {
        const cam = cameras.find(c => c.properties.id === camId);
        if (cam) toggleCamera(cam);
      }
    }
  }, [cameras.length > 0]);

  return (
    <>
      {cameras.map((cam) => {
        const [lon, lat] = cam.geometry.coordinates;
        const id = cam.properties.id;
        return (
          <Marker key={id} longitude={lon} latitude={lat} anchor="center">
            <div
              className="cursor-pointer w-6 h-6 bg-cyan-600 border-2 border-white rounded-full shadow-lg flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); toggleCamera(cam); }}
              title={cam.properties.name}
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          </Marker>
        );
      })}

      {openCameras.map((cam) => {
        const id = cam.properties.id;
        return (
          <WebcamPopupWrapper
            key={`popup-${id}`}
            camera={cam}
            mapRef={mapRef}
            pinned={pinnedIds.has(id)}
            onPin={() => pinCamera(id)}
            onTogglePin={() => togglePinCamera(id)}
            onClose={() => closeCamera(id)}
            lang={lang}
          />
        );
      })}
    </>
  );
}

function WebcamPopupWrapper({ camera, mapRef, pinned, onPin, onTogglePin, onClose, lang }) {
  const [lon, lat] = camera.geometry.coordinates;

  // Get initial screen position for the popup
  const popupOrigin = useMemo(() => {
    if (!mapRef) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    try {
      const pt = mapRef.project([lon, lat]);
      return { x: pt.x, y: pt.y - 30 };
    } catch {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
  }, [lon, lat, mapRef]);

  return (
    <DraggablePopup
      originLng={lon}
      originLat={lat}
      originX={popupOrigin.x}
      originY={popupOrigin.y}
      showConnectionLine={true}
      onPin={onPin}
    >
      <WebcamPopupContent camera={camera} pinned={pinned} onTogglePin={onTogglePin} onClose={onClose} lang={lang} />
    </DraggablePopup>
  );
}

function formatTimestamp(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
    return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return null; }
}

function formatNow() {
  return formatTimestamp(new Date().toISOString());
}

function WebcamPopupContent({ camera, pinned, onTogglePin, onClose, lang }) {
  const id = camera.properties.id;
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [displayTime, setDisplayTime] = useState(() => {
    return formatTimestamp(camera.properties.lastUpdate || camera.properties.publicationTime) || formatNow();
  });

  // Fetch image and check for Last-Modified header to get accurate timestamp
  const fetchImageTimestamp = async (bust) => {
    try {
      const res = await fetch(`/api/webcams/image/${id}?t=${bust}`, { method: 'HEAD' });
      const lastMod = res.headers.get('Last-Modified');
      if (lastMod) {
        const ts = formatTimestamp(lastMod);
        if (ts) { setDisplayTime(ts); return; }
      }
    } catch { /* ignore */ }
    // Fallback: use current time when refreshed
    setDisplayTime(formatNow());
  };

  // Initial timestamp fetch
  useEffect(() => {
    fetchImageTimestamp(cacheBust);
  }, []);

  // Refresh image every 60 seconds and update the timestamp
  useEffect(() => {
    const interval = setInterval(() => {
      const newBust = Date.now();
      setCacheBust(newBust);
      fetchImageTimestamp(newBust);
    }, 60000);
    return () => clearInterval(interval);
  }, [id]);

  // Esc key closes fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const imgSrc = `/api/webcams/image/${id}?t=${cacheBust}`;

  return (
    <>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-600 max-w-xs overflow-hidden">
        {/* Timestamp header — draggable */}
        <div className="bg-cyan-700/80 px-2 py-1 text-[11px] text-white font-mono text-center draggable-header cursor-grab">
          {displayTime}
        </div>
        <div className="p-2">
          <div className="flex justify-between items-center mb-1 draggable-header cursor-grab">
            <span className="text-sm font-semibold text-emerald-400 truncate">
              {camera.properties.name}
            </span>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {/* Pin button */}
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
                className={`text-xs p-0.5 rounded transition-colors ${pinned ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                title={lang === 'no' ? (pinned ? 'Løsne' : 'Fest') : (pinned ? 'Unpin' : 'Pin')}
              >
                <svg className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
          {(camera.properties.direction || camera.properties.road) && (
            <div className="text-[10px] text-slate-400 mb-1">
              {camera.properties.road && <span>{camera.properties.road}</span>}
              {camera.properties.road && camera.properties.direction && <span> · </span>}
              {camera.properties.direction && <span>{camera.properties.direction}</span>}
            </div>
          )}
          <img
            src={imgSrc}
            alt={camera.properties.name}
            className="w-72 h-auto rounded cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setFullscreen(true)}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      </div>

      {/* Fullscreen image overlay — portal to body to escape stacking context */}
      {fullscreen && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center"
          onClick={() => setFullscreen(false)}
        >
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white text-xl flex items-center justify-center z-[10000]"
          >
            ✕
          </button>
          <div className="relative max-w-[92vw] max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-2">
              <span className="text-white font-semibold text-lg">{camera.properties.name}</span>
              <span className="text-slate-400 text-sm ml-3">{displayTime}</span>
            </div>
            <img
              src={imgSrc}
              alt={camera.properties.name}
              className="max-w-[92vw] max-h-[85vh] rounded-lg shadow-2xl"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
