// A tiny per-instance cache for settings that change rarely but were read on
// every request (persona text, free-access flag, slang pool, boss ids...).
// Each server instance keeps its own copy for `ttlMs`; concurrent callers
// share one in-flight load, and a failed load is never kept.

type Slot = { at: number; ttlMs: number; value: Promise<unknown> };
const slots = new Map<string, Slot>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = slots.get(key);
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.value as Promise<T>;
  const value = load();
  const slot: Slot = { at: Date.now(), ttlMs, value };
  slots.set(key, slot);
  value.catch(() => {
    if (slots.get(key) === slot) slots.delete(key);
  });
  return value;
}

/** Drop a cached value so the next read loads it fresh. */
export function forgetCached(key: string): void {
  slots.delete(key);
}
