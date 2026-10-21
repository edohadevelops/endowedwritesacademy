import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/data';
import type { DataKey } from '@/lib/data/events';

interface AsyncState<T> { data: T | undefined; error: unknown; loading: boolean; reload: () => void }

/**
 * Runs an async loader, re-running when deps change and (optionally) when
 * any of the listed collections change elsewhere in the app.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], watch: DataKey[] = []): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: undefined, error, loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const watchKey = watch.join(',');
  useEffect(() => {
    if (!watchKey) return;
    const keys = watchKey.split(',');
    return subscribe((k) => { if (keys.includes(k)) setTick((t) => t + 1); });
  }, [watchKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
