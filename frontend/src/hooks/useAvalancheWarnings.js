import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour

export function useAvalancheWarnings(visible, day) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/avalanche-warnings?day=${day}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      setData(geojson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Avalanche warnings fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [day]);

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
