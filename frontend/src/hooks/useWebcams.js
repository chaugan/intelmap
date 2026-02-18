import { useCallback } from 'react';
import { useWebcamStore } from '../stores/useWebcamStore.js';

export function useWebcams() {
  const { setCameras, setLoading, setError } = useWebcamStore();

  const fetchWebcams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/webcams');
      if (!res.ok) throw new Error(`Webcam fetch failed: ${res.status}`);
      const data = await res.json();
      setCameras(data.features || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchWebcams };
}
