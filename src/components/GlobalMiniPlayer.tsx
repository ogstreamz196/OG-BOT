import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Pause, Play, X, Music4 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Docked player that follows the listener around the app.
 *
 * Every card owns its own <audio> element, so instead of rewiring them all we
 * watch for `play` in the capture phase (same trick as <SingleAudioBridge/>)
 * and mirror whichever tagged element is sounding. When that element leaves
 * the page (route change, list re-render) we adopt playback into our own
 * hidden element at the exact same position, so the music keeps going.
 *
 * Only elements tagged `data-og-track` are adopted — the ambient background
 * music player is deliberately excluded.
 */
type QueueItem = { id: string; title: string };

export function GlobalMiniPlayer() {
  const ownRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<HTMLAudioElement | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Unlocked tracks visible when playback started — the queue we roll through
  // once the original page is gone.
  const queueRef = useRef<QueueItem[]>([]);
  const idxRef = useRef(-1);
  // Last state observed while the card was still mounted: removing an element
  // from the page pauses it, so `paused` can't be trusted after unmount.
  const lastPlayingRef = useRef(false);

  const active = () => sourceRef.current ?? (ownRef.current?.src ? ownRef.current : null);

  const playIndex = useCallback(async (i: number) => {
    const q = queueRef.current;
    const own = ownRef.current;
    if (!own || q.length === 0) return;
    const idx = ((i % q.length) + q.length) % q.length;
    const item = q[idx]!;
    idxRef.current = idx;
    sourceRef.current = null;
    setTitle(item.title);
    try {
      const { data } = await supabase.functions.invoke("song-url", {
        body: { song_id: item.id, mode: "full", purpose: "stream" },
      });
      const url = typeof data?.url === "string" ? data.url : null;
      if (!url) throw new Error("no url");
      own.src = url;
      await own.play();
    } catch {
      setPlaying(false);
    }
  }, []);

  // Track whichever tagged element starts playing.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const el = e.target as HTMLAudioElement | null;
      if (!el || el === ownRef.current) return;
      if (!(el instanceof HTMLAudioElement)) return;
      if (!el.dataset.ogTrack) return;
      ownRef.current?.pause();
      sourceRef.current = el;
      lastPlayingRef.current = true;
      setTitle(el.dataset.ogTitle || "Now playing");
      setDismissed(false);
      setPlaying(true);
      if (el.dataset.ogFull) {
        const seen = new Set<string>();
        const q: QueueItem[] = [];
        document
          .querySelectorAll<HTMLAudioElement>("audio[data-og-track][data-og-full]")
          .forEach((a) => {
            const id = a.dataset.ogTrack!;
            if (seen.has(id)) return;
            seen.add(id);
            q.push({ id, title: a.dataset.ogTitle || "OG track" });
          });
        queueRef.current = q;
        idxRef.current = q.findIndex((x) => x.id === el.dataset.ogTrack);
      } else {
        queueRef.current = [];
        idxRef.current = -1;
      }
    };
    // A page player finished: if the page didn't start another track itself,
    // roll on through the queue from here.
    const onEnded = (e: Event) => {
      const el = e.target as HTMLAudioElement | null;
      if (!(el instanceof HTMLAudioElement) || el !== sourceRef.current) return;
      if (!el.dataset.ogFull || queueRef.current.length < 2) return;
      window.setTimeout(() => {
        if (sourceRef.current !== el) return;
        const anyPlaying = Array.from(
          document.querySelectorAll<HTMLAudioElement>("audio[data-og-track]"),
        ).some((a) => !a.paused);
        if (!anyPlaying) void playIndex(idxRef.current + 1);
      }, 800);
    };
    document.addEventListener("play", onPlay, true);
    document.addEventListener("ended", onEnded, true);
    return () => {
      document.removeEventListener("play", onPlay, true);
      document.removeEventListener("ended", onEnded, true);
    };
  }, [playIndex]);

  // Our own element finished a track: next in the queue.
  useEffect(() => {
    const own = ownRef.current;
    if (!own) return;
    const onEnded = () => {
      if (queueRef.current.length > 0) void playIndex(idxRef.current + 1);
      else setPlaying(false);
    };
    own.addEventListener("ended", onEnded);
    return () => own.removeEventListener("ended", onEnded);
  }, [playIndex]);

  // Mirror the source element, and adopt playback if it disappears.
  useEffect(() => {
    const id = window.setInterval(() => {
      const own = ownRef.current;
      const src = sourceRef.current;

      if (!src && own && own.src) {
        setPlaying(!own.paused);
        setTime(own.currentTime);
        setDuration(Number.isFinite(own.duration) ? own.duration : 0);
        return;
      }
      if (!src) return;

      if (!src.isConnected) {
        const at = src.currentTime;
        const wasPlaying = lastPlayingRef.current;
        const url = src.currentSrc || src.src;
        const full = !!src.dataset.ogFull;
        sourceRef.current = null;
        if (own && url && wasPlaying && full) {
          own.src = url;
          own.currentTime = at;
          void own.play().catch(() => setPlaying(false));
        } else {
          setPlaying(false);
        }
        return;
      }

      lastPlayingRef.current = !src.paused;
      setPlaying(!src.paused);
      setTime(src.currentTime);
      setDuration(Number.isFinite(src.duration) ? src.duration : 0);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Phone lock-screen / notification controls.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (title) {
      try {
        ms.metadata = new MediaMetadata({ title, artist: "OG BOT", album: "OGSTREAMZ" });
      } catch {
        /* unsupported */
      }
    }
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => void active()?.play().catch(() => {}));
    set("pause", () => active()?.pause());
    set("stop", () => active()?.pause());
    set("nexttrack", () => {
      if (queueRef.current.length > 1) {
        sourceRef.current?.pause();
        void playIndex(idxRef.current + 1);
      }
    });
    set("previoustrack", () => {
      if (queueRef.current.length > 1) {
        sourceRef.current?.pause();
        void playIndex(idxRef.current - 1);
      }
    });
  }, [title, playIndex]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : title ? "paused" : "none";
  }, [playing, title]);

  function toggle() {
    const el = active();
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  function close() {
    const el = active();
    el?.pause();
    if (ownRef.current) ownRef.current.removeAttribute("src");
    sourceRef.current = null;
    queueRef.current = [];
    setDismissed(true);
    setPlaying(false);
  }

  const visible = !dismissed && !!title && (playing || time > 0);
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <>
      <audio ref={ownRef} preload="auto" className="hidden" data-og-global-player />
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 z-30 px-2 transition-all duration-300",
          // Sits just above the mobile tab bar, flush to the bottom elsewhere.
          "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-3",
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        )}
        aria-hidden={!visible}
        // While hidden the bar must be completely inert — an invisible strip
        // that still swallows taps is exactly what made the chat box feel dead.
        inert={!visible ? true : undefined}
      >
        <div
          className={cn(
            "mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-card/95 px-3 py-2 shadow-2xl backdrop-blur-xl",
            visible ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Music4 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{title}</p>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-brand" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close player"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
