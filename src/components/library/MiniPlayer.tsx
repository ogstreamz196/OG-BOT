import { useEffect, useState } from "react";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Music2 } from "lucide-react";
import { usePlaylist } from "@/hooks/use-playlist";
import { cn } from "@/lib/utils";

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Compact media bar shown above the playlist. Drives whichever row is the
 * current track, so play/pause, seek, skip and loop all stay in sync with the
 * row players themselves.
 */
export function MiniPlayer() {
  const playlist = usePlaylist();
  const currentId = playlist?.currentId ?? null;
  const controls = currentId ? playlist?.getControls(currentId) : undefined;

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // The row owns the <audio> element; poll it so the bar mirrors real state.
  useEffect(() => {
    if (!controls) {
      setPlaying(false);
      setTime(0);
      setDuration(0);
      return;
    }
    const tick = () => {
      const el = controls.el();
      if (!el) return;
      setPlaying(!el.paused && !el.ended);
      setTime(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [controls, currentId]);

  // Stay out of the way until something is actually playing, so the track
  // list is the first thing on screen.
  if (!playlist || !controls) return null;

  const title = controls?.title || "Nothing playing";
  const hasTrack = !!controls;
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const loop = playlist.loop;

  function toggle() {
    if (!controls) {
      const first = playlist!.order[0];
      if (first) playlist!.playId(first);
      return;
    }
    const el = controls.el();
    if (el && !el.paused) controls.pause();
    else void Promise.resolve(controls.play()).catch(() => {});
  }

  function cycleLoop() {
    playlist!.setLoop(loop === "off" ? "all" : loop === "all" ? "one" : "off");
  }

  return (
    <div
      data-testid="mini-player"
      className="sticky top-16 z-20 overflow-hidden rounded-2xl border border-primary/30 bg-surface p-3 shadow-[0_10px_40px_-16px_var(--primary)] backdrop-blur-md"
    >
      {/* Scanline sheen for the cyber-deck feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-70"
      />
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "relative grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary",
            playing && "shadow-[0_0_18px_-4px_var(--primary)]",
          )}
        >
          {playing ? (
            <div aria-hidden className="flex h-5 items-end gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-[3px] origin-bottom rounded-full bg-primary"
                  style={{
                    height: "100%",
                    animation: `eqPulse ${0.45 + i * 0.12}s ease-in-out ${i * 0.08}s infinite alternate`,
                  }}
                />
              ))}
            </div>
          ) : (
            <Music2 className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.25em] text-primary/80">
            {playing ? "● Now playing" : hasTrack ? "Paused" : "Your playlist"}
          </p>
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {playlist.order.length} track{playlist.order.length === 1 ? "" : "s"} in queue
          </p>
        </div>
        <button
          type="button"
          onClick={() => playlist.setShuffle(!playlist.shuffle)}
          aria-label="Shuffle"
          aria-pressed={playlist.shuffle}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors",
            playlist.shuffle
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-white/10 bg-white/[0.04] text-muted-foreground",
          )}
        >
          <Shuffle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cycleLoop}
          aria-label={`Loop: ${loop}`}
          aria-pressed={loop !== "off"}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors",
            loop === "off"
              ? "border-white/10 bg-white/[0.04] text-muted-foreground"
              : "border-primary/40 bg-primary/15 text-primary",
          )}
        >
          {loop === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="w-9 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {fmt(time)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={1}
          value={Math.min(Math.round(time), Math.max(1, Math.round(duration)))}
          onChange={(e) => {
            const el = controls?.el();
            if (el) el.currentTime = Number(e.target.value);
          }}
          disabled={!hasTrack || duration <= 0}
          aria-label="Seek current track"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-primary disabled:cursor-default"
          style={{
            background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)`,
          }}
        />
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {fmt(duration)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => playlist.prev()}
          aria-label="Previous track"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-foreground transition-colors hover:bg-white/[0.1]"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-12 w-12 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow transition-transform active:scale-95"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
        </button>
        <button
          type="button"
          onClick={() => playlist.next()}
          aria-label="Next track"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-foreground transition-colors hover:bg-white/[0.1]"
        >
          <SkipForward className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
