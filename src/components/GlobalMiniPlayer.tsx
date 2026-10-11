import { useEffect, useRef, useState } from "react";
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
export function GlobalMiniPlayer() {
  const ownRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<HTMLAudioElement | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Track whichever tagged element starts playing.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const el = e.target as HTMLAudioElement | null;
      if (!el || el === ownRef.current) return;
      if (!(el instanceof HTMLAudioElement)) return;
      if (!el.dataset.ogTrack) return;
      sourceRef.current = el;
      setTitle(el.dataset.ogTitle || "Now playing");
      setDismissed(false);
      setPlaying(true);
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  // Mirror the source element, and adopt playback if it disappears.
  useEffect(() => {
    const id = window.setInterval(() => {
      const own = ownRef.current;
      const src = sourceRef.current;

      // Our own element is carrying playback.
      if (!src && own && own.src) {
        setPlaying(!own.paused);
        setTime(own.currentTime);
        setDuration(Number.isFinite(own.duration) ? own.duration : 0);
        return;
      }
      if (!src) return;

      if (!src.isConnected) {
        // The card unmounted — carry on where it left off.
        const at = src.currentTime;
        const wasPlaying = !src.paused;
        const url = src.currentSrc || src.src;
        sourceRef.current = null;
        if (own && url && wasPlaying) {
          own.src = url;
          own.currentTime = at;
          void own.play().catch(() => setPlaying(false));
        } else {
          setPlaying(false);
        }
        return;
      }

      setPlaying(!src.paused);
      setTime(src.currentTime);
      setDuration(Number.isFinite(src.duration) ? src.duration : 0);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const active = () => sourceRef.current ?? (ownRef.current?.src ? ownRef.current : null);

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
          // Sits just above the mobile floating tab bar.
          "bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-3",
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        )}
        aria-hidden={!visible}
        // While hidden the bar must be completely inert — an invisible strip
        // that still swallows taps is exactly what made the chat box feel dead.
        inert={!visible ? true : undefined}
      >
        <div
          className={cn(
            "mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 glass-panel shadow-glow px-3 py-2",
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
