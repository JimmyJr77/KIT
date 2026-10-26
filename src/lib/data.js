import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

/** Tiny fetch hook: const { data, reload, loading, error } = useApi('/teams'). */
export function useApi(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(() => {
    if (!url) return Promise.resolve();
    setState((s) => ({ ...s, loading: true }));
    return api.get(url)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => setState({ data: null, loading: false, error }));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
