import { useCallback } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

export function useScreenshot() {
  const mapRef = useMapStore((s) => s.mapRef);

  const captureScreenshot = useCallback(() => {
    if (!mapRef) return null;
    try {
      const canvas = mapRef.getCanvas();
      return canvas.toDataURL('image/jpeg', 0.5);
    } catch {
      return null;
    }
  }, [mapRef]);

  return { captureScreenshot };
}
