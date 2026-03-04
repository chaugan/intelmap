import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_INTERVAL = 10000; // 10 seconds

export function useTrains(visible) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/trains');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      setData(geojson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Train fetch error:', err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

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

  return { data, loading, fetchedAt };
}
