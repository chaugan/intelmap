import { useCallback } from 'react';
import { useWeatherStore } from '../stores/useWeatherStore.js';

export function useWeather() {
  const { setForecast, setSun, setMoon, setLoading, setError, setLocation } = useWeatherStore();

  const fetchWeather = useCallback(async (lat, lon) => {
    setLoading(true);
    setError(null);
    setLocation({ lat, lon });

    try {
      const [forecastRes, sunRes, moonRes] = await Promise.all([
        fetch(`/api/weather/forecast?lat=${lat}&lon=${lon}`),
        fetch(`/api/weather/sun?lat=${lat}&lon=${lon}`),
        fetch(`/api/weather/moon?lat=${lat}&lon=${lon}`),
      ]);

      if (forecastRes.ok) setForecast(await forecastRes.json());
      if (sunRes.ok) setSun(await sunRes.json());
      if (moonRes.ok) setMoon(await moonRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchWeather };
}
