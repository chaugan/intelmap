import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../stores/useMapStore.js';

const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

export function useAuroraForecast(visible) {
  const [data, setData] = useState(null);
  const [kpData, setKpData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const intervalRef = useRef(null);
  const setAuroraGrid = useMapStore((s) => s.setAuroraGrid);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [auroraRes, kpRes, gridRes] = await Promise.all([
        fetch('/api/aurora'),
        fetch('/api/aurora/kp'),
        fetch('/api/aurora/grid'),
      ]);

      if (!auroraRes.ok) throw new Error(`Aurora HTTP ${auroraRes.status}`);
      if (!kpRes.ok) throw new Error(`Kp HTTP ${kpRes.status}`);
      if (!gridRes.ok) throw new Error(`Aurora grid HTTP ${gridRes.status}`);

      const [auroraJson, kpJson, gridJson] = await Promise.all([
        auroraRes.json(),
        kpRes.json(),
        gridRes.json(),
      ]);

      setData(auroraJson);
      setKpData(kpJson);
      setAuroraGrid(gridJson);
      setFetchedAt(new Date());
    } catch (err) {
      console.error('Aurora forecast fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [setAuroraGrid]);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setKpData(null);
      setFetchedAt(null);
      setAuroraGrid(null);
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
