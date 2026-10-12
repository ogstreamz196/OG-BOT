import { useCallback, useEffect, useState, type SetStateAction } from "react";

/**
 * App-lifetime state: survives the page unmounting during navigation, so an
 * in-flight track creation keeps updating and is shown again on return.
 * Values live in module memory (and optionally sessionStorage for reloads).
 */
const store = new Map<string, unknown>();
const listeners = new Map<string, Set<(v: unknown) => void>>();

function read<T>(key: string, init: T, persist: boolean): T {
  if (store.has(key)) return store.get(key) as T;
  if (persist && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(`og-run:${key}`);
      if (raw != null) {
        const v = JSON.parse(raw) as T;
        store.set(key, v);
        return v;
      }
    } catch {
      /* ignore */
    }
  }
  return init;
}

export function useSessionRunState<T>(key: string, init: T, persist = false) {
  const [value, setLocal] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : init));

  useEffect(() => {
    const cur = read(key, init, persist);
    setLocal(cur);
    const fn = (v: unknown) => setLocal(v as T);
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback(
    (action: SetStateAction<T>) => {
      const prev = read(key, init, persist);
      const next =
        typeof action === "function" ? (action as (p: T) => T)(prev) : action;
      store.set(key, next);
      if (persist && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(`og-run:${key}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      listeners.get(key)?.forEach((l) => l(next));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, persist],
  );

  return [value, setValue] as const;
}
