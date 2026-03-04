import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

export function useInfrastructure(enabled) {
  const [layerList, setLayerList] = useState([]);
  const [layerData, setLayerData] = useState({});
  const [loading, setLoading] = useState({});
  const cacheRef = useRef({});
  const infraLayers = useMapStore((s) => s.infraLayers);
  const bounds = useMapStore((s) => s.bounds);

  // Fetch layer list on mount
  useEffect(() => {
    if (!enabled) return;
    fetch('/api/infrastructure/layers', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setLayerList)
      .catch(() => {});
  }, [enabled]);

  // Fetch GeoJSON when sublayer is toggled on
  useEffect(() => {
    if (!enabled) return;

    for (const [name, on] of Object.entries(infraLayers)) {
      if (!on) continue;
      if (name === 'lufthinder') continue; // handled separately
      if (cacheRef.current[name]) {
        setLayerData(prev => ({ ...prev, [name]: cacheRef.current[name] }));
        continue;
      }
      if (loading[name]) continue;

      setLoading(prev => ({ ...prev, [name]: true }));
      fetch(`/api/infrastructure/${name}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            cacheRef.current[name] = data;
            setLayerData(prev => ({ ...prev, [name]: data }));
          }
          setLoading(prev => ({ ...prev, [name]: false }));
        })
        .catch(() => setLoading(prev => ({ ...prev, [name]: false })));
    }
  }, [enabled, infraLayers]);

  // Lufthinder: bbox-based fetching
  const lufthinderTimerRef = useRef(null);
  useEffect(() => {
    if (!enabled || !infraLayers.lufthinder || !bounds) return;

    clearTimeout(lufthinderTimerRef.current);
    lufthinderTimerRef.current = setTimeout(() => {
      const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
      fetch(`/api/infrastructure/lufthinder?bbox=${bbox}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setLayerData(prev => ({ ...prev, lufthinder: data }));
          }
        })
        .catch(() => {});
    }, 500);

    return () => clearTimeout(lufthinderTimerRef.current);
  }, [enabled, infraLayers.lufthinder, bounds]);

  // Clear data when sublayer toggled off
  useEffect(() => {
    setLayerData(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!infraLayers[key]) delete next[key];
      }
      return next;
    });
  }, [infraLayers]);

  return { layerList, layerData, loading };
}
