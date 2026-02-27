import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

export function useAuroraForecast(visible) {
  const [data, setData] = useState(null);
  const [kpData, setKpData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [auroraRes, kpRes] = await Promise.all([
        fetch('/api/aurora'),
        fetch('/api/aurora/kp'),
      ]);

      if (!auroraRes.ok) throw new Error(`Aurora HTTP ${auroraRes.status}`);
      if (!kpRes.ok) throw new Error(`Kp HTTP ${kpRes.status}`);

      const [auroraJson, kpJson] = await Promise.all([
        auroraRes.json(),
        kpRes.json(),
      ]);

      setData(auroraJson);
      setKpData(kpJson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Aurora forecast fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setKpData(null);
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

  return { data, kpData, loading, fetchedAt };
}
