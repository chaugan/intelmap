import { create } from 'zustand';

export const useWeatherStore = create((set) => ({
  forecast: null,
  sun: null,
  moon: null,
  windGrid: null,
  loading: false,
  error: null,
  location: null, // { lat, lon }

  setForecast: (forecast) => set({ forecast }),
  setSun: (sun) => set({ sun }),
  setMoon: (moon) => set({ moon }),
  setWindGrid: (windGrid) => set({ windGrid }),
  windFetchedAt: null,
  setWindFetchedAt: (windFetchedAt) => set({ windFetchedAt }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setLocation: (location) => set({ location }),
}));
