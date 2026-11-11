import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// One Supabase realtime channel per key for the whole page, however many
// components ask for it. Hooks like useProfile run in half a dozen places at
// once; each used to open its own channel (and refetch on every event).

type Listener = (payload: unknown) => void;
type Entry = { channel: RealtimeChannel; listeners: Set<{ current: Listener | undefined }> };

const live = new Map<string, Entry>();

/**
 * Joins the shared channel `key`, creating it on first use. `bind` adds the
 * postgres_changes handlers; it runs once per channel, so put once-per-event
 * work there (e.g. invalidating a query) and call `emit` to fan an event out
 * to each subscriber's `listener`. Returns a leave function; the channel is
 * removed when the last subscriber leaves.
 */
export function joinSharedChannel(
  key: string,
  bind: (channel: RealtimeChannel, emit: Listener) => RealtimeChannel,
  listener?: { current: Listener | undefined },
  client: Pick<typeof supabase, "channel" | "removeChannel"> = supabase,
): () => void {
  let entry = live.get(key);
  if (!entry) {
    const listeners: Entry["listeners"] = new Set();
    const emit: Listener = (payload) => {
      for (const l of listeners) l.current?.(payload);
    };
    // A unique topic, so a channel still being torn down never clashes.
    const topic = `${key}:${Math.random().toString(36).slice(2, 10)}`;
    entry = { channel: bind(client.channel(topic), emit), listeners };
    entry.channel.subscribe();
    live.set(key, entry);
  }
  const ref = listener ?? { current: undefined };
  entry.listeners.add(ref);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = live.get(key);
    if (!current) return;
    current.listeners.delete(ref);
    if (current.listeners.size > 0) return;
    live.delete(key);
    void client.removeChannel(current.channel);
  };
}

/**
 * React wrapper for joinSharedChannel. `key` null means "not now" (e.g.
 * signed out). `bind` is taken from whichever component opens the channel
 * first, so every caller of a given key must bind the same handlers.
 */
export function useSharedChannel<P = unknown>(
  key: string | null,
  bind: (channel: RealtimeChannel, emit: Listener) => RealtimeChannel,
  listener?: (payload: P) => void,
): void {
  const listenerRef = useRef<Listener | undefined>(listener as Listener | undefined);
  listenerRef.current = listener as Listener | undefined;
  const bindRef = useRef(bind);
  bindRef.current = bind;
  useEffect(() => {
    if (!key) return;
    return joinSharedChannel(key, (ch, emit) => bindRef.current(ch, emit), listenerRef);
  }, [key]);
}
