import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

/**
 * Tiny fetch hook: const { data, reload, loading, error } = useApi('/teams').
 * A timed refresh calls reload({ quiet: true }) so it doesn't show the processing scanner.
 */
export function useApi(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback((opts) => {
    if (!url) return Promise.resolve();
    setState((s) => ({ ...s, loading: true }));
    return api.get(url, opts?.quiet ? { quiet: true } : undefined)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => setState({ data: null, loading: false, error }));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
