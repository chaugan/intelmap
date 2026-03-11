import { useState, useCallback, useRef } from 'react';

export function useSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  const search = useCallback((query) => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setError(null);

    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          setResults(await res.json());
        } else {
          console.error('Search API error:', res.status);
          setError(res.status);
          setResults([]);
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // superseded by newer search
        console.error('Search fetch error:', err);
        setError('network');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  return { results, loading, error, search, setResults };
}
