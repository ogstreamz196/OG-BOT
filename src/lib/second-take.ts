/**
 * Remembers which freshly created tracks the user paid-in for a second version,
 * so the hidden alternate take is revealed automatically once it lands.
 * Coins are only taken at reveal time, never up front.
 */
const KEY = "og_pending_second_take";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* storage unavailable — the offer simply won't auto-apply */
  }
}

export function markSecondTakeWanted(songId: string) {
  const list = read();
  if (!list.includes(songId)) write([...list, songId]);
}

export function pendingSecondTakes(): string[] {
  return read();
}

export function clearSecondTake(songId: string) {
  write(read().filter((id) => id !== songId));
}
