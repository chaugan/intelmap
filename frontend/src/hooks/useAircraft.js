import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

const REFRESH_INTERVAL = 15000; // 15 seconds
const DEBOUNCE_DELAY = 3000; // 3 seconds after viewport stops moving

export function useAircraft(visible) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);
  const debounceRef = useRef(null);
  const boundsRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    // Prevent overlapping requests
    if (fetchingRef.current) return;

    const bounds = useMapStore.getState().bounds;
    if (!bounds) return;

    const lat = (bounds.north + bounds.south) / 2;
    const lon = (bounds.east + bounds.west) / 2;

    // Calculate radius in nautical miles from bounds
    const latSpan = bounds.north - bounds.south;
    const lonSpan = bounds.east - bounds.west;
    const avgLat = lat * (Math.PI / 180);
    const latDist = latSpan * 60; // 1 deg lat ~ 60 NM
    const lonDist = lonSpan * 60 * Math.cos(avgLat);
    const radiusNm = Math.min(Math.ceil(Math.max(latDist, lonDist) / 2), 250);

    fetchingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/aircraft?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radiusNm}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      setData(geojson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Aircraft fetch error:', err);
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

    // Skip initial render
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
