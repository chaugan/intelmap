import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

const REFRESH_INTERVAL = 30000; // 30 seconds
const DEBOUNCE_DELAY = 3000; // 3 seconds after viewport stops moving

export function useVessels(visible) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);
  const debounceRef = useRef(null);
  const boundsRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;

    const bounds = useMapStore.getState().bounds;
    if (!bounds) return;

    fetchingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/ais?south=${bounds.south.toFixed(4)}&north=${bounds.north.toFixed(4)}&west=${bounds.west.toFixed(4)}&east=${bounds.east.toFixed(4)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      setData(geojson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Vessel fetch error:', err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // Auto-refresh on interval
  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetchedAt(null);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [visible, fetchData]);

  // Debounced refetch on viewport change
  const bounds = useMapStore((s) => s.bounds);
  useEffect(() => {
    if (!visible || !bounds) return;

    if (!boundsRef.current) {
      boundsRef.current = bounds;
      return;
    }
    boundsRef.current = bounds;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData();
    }, DEBOUNCE_DELAY);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible, bounds, fetchData]);

  return { data, loading, fetchedAt };
}
