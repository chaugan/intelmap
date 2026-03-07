import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import ExportMenu from '../common/ExportMenu.jsx';

// Load Google Maps JavaScript API
let googleMapsLoaded = false;
let googleMapsLoadPromise = null;

function loadGoogleMapsApi(apiKey) {
  if (googleMapsLoaded && window.google?.maps) {
    return Promise.resolve();
  }
  if (googleMapsLoadPromise) {
    return googleMapsLoadPromise;
  }

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.google?.maps) {
      googleMapsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=streetView`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      googleMapsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps API'));
    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
}

export default function StreetViewOverlay({ lat, lng, apiKey, heading = 0, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const signalLinked = useAuthStore((s) => s.signalLinked);
  const prepareSignalUpload = useAuthStore((s) => s.prepareSignalUpload);
  const [exporting, setExporting] = useState(false);
  const [apiLoaded, setApiLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Track current POV from the Street View panorama
  const [currentPov, setCurrentPov] = useState({ heading, pitch: 0, zoom: 1 });
  const panoramaRef = useRef(null);
  const containerRef = useRef(null);

  // Load Google Maps API and initialize Street View
  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsApi(apiKey)
      .then(() => {
        if (cancelled) return;
        setApiLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  // Initialize Street View panorama when API is loaded and container is ready
  useEffect(() => {
    if (!apiLoaded || !containerRef.current || panoramaRef.current) return;

    const panorama = new window.google.maps.StreetViewPanorama(containerRef.current, {
      position: { lat, lng },
      pov: { heading, pitch: 0 },
      zoom: 1,
      addressControl: true,
      showRoadLabels: true,
      motionTracking: false,
      motionTrackingControl: false,
    });

    panoramaRef.current = panorama;

    // Track POV changes
    panorama.addListener('pov_changed', () => {
      const pov = panorama.getPov();
      setCurrentPov({
        heading: pov.heading,
        pitch: pov.pitch,
        zoom: panorama.getZoom() || 1,
      });
    });

    // Also track zoom changes
    panorama.addListener('zoom_changed', () => {
      const pov = panorama.getPov();
      setCurrentPov({
        heading: pov.heading,
        pitch: pov.pitch,
        zoom: panorama.getZoom() || 1,
      });
    });

    // Set initial POV state
    setCurrentPov({ heading, pitch: 0, zoom: 1 });

    return () => {
      // Cleanup is handled by removing the container
      panoramaRef.current = null;
    };
  }, [apiLoaded, lat, lng, heading]);

  // Handle escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Calculate FOV from zoom level (Google's formula)
  // zoom 0 = 180° FOV, zoom 1 = 90° FOV, zoom 2 = 45° FOV, etc.
  const getFovFromZoom = (zoom) => {
    return 180 / Math.pow(2, zoom);
  };

  // Fetch the static image for export
  const fetchStaticImage = useCallback(async () => {
    const fov = Math.round(getFovFromZoom(currentPov.zoom));
    // Google Street View Static API max size is 640x640 for free tier
    // Use 640x480 for better aspect ratio
    const url = `/api/streetview/image?lat=${lat}&lng=${lng}&heading=${Math.round(currentPov.heading)}&pitch=${Math.round(currentPov.pitch)}&fov=${fov}&size=640x480`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch image');
    const blob = await resp.blob();
    return blob;
  }, [lat, lng, currentPov]);

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

  // Send to Signal
  const handleSendToSignal = useCallback(async () => {
    if (!signalLinked) return;
    setExporting(true);
    try {
      const blob = await fetchStaticImage();
      const reader = new FileReader();
      reader.onloadend = () => {
        const now = new Date();
        const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
        const filename = `streetview_${lat.toFixed(5)}_${lng.toFixed(5)}_${localTime}.jpg`;
        prepareSignalUpload(reader.result, [lng, lat], filename);
        setExporting(false);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Street view Signal transfer failed:', err);
      setExporting(false);
    }
  }, [fetchStaticImage, signalLinked, prepareSignalUpload, lat, lng]);

  const containerWidth = Math.min(window.innerWidth * 0.9, 1200);
  const containerHeight = Math.min(window.innerHeight * 0.8, 800);

  // Stop propagation for inner content
  const stopProp = (e) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center"
      onMouseDown={(e) => {
        // Only close if clicking directly on the backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        onMouseDown={stopProp}
        className="absolute top-4 right-4 w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white text-xl flex items-center justify-center z-[10000]"
      >
        ✕
      </button>

      <div className="relative" onMouseDown={stopProp} onClick={stopProp}>
        {/* Header with title, coordinates, and export */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div>
            <span className="text-white font-semibold">Street View</span>
            <span className="text-slate-400 text-sm ml-3">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          </div>

          {/* Export button */}
          <div className="flex items-center gap-3">
            <ExportMenu
              onSaveToDisk={handleSaveToDisk}
              onTransferToWasos={handleTransferToWasos}
              wasosLoggedIn={wasosLoggedIn}
              onSendToSignal={user?.signalEnabled ? handleSendToSignal : undefined}
              signalLinked={signalLinked}
              disabled={exporting || !apiLoaded}
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

        {/* Street View container */}
        {error ? (
          <div
            className="flex items-center justify-center bg-slate-800 rounded-lg text-red-400"
            style={{ width: containerWidth, height: containerHeight }}
          >
            {error}
          </div>
        ) : !apiLoaded ? (
          <div
            className="flex items-center justify-center bg-slate-800 rounded-lg text-slate-400"
            style={{ width: containerWidth, height: containerHeight }}
          >
            <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            {lang === 'no' ? 'Laster Street View...' : 'Loading Street View...'}
          </div>
        ) : (
          <div
            ref={containerRef}
            onMouseDown={stopProp}
            onClick={stopProp}
            style={{ width: containerWidth, height: containerHeight, borderRadius: '8px' }}
          />
        )}

        {/* Current view info */}
        <div className="text-center mt-2 text-slate-500 text-xs">
          {lang === 'no' ? 'Retning' : 'Heading'}: {Math.round(currentPov.heading)}° | {lang === 'no' ? 'Tilt' : 'Pitch'}: {Math.round(currentPov.pitch)}° | FOV: {Math.round(getFovFromZoom(currentPov.zoom))}°
        </div>
      </div>
    </div>,
    document.body
  );
}
