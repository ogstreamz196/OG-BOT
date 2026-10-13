import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AudioLines, Clock3, History, Loader2, Mic2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { RecentSong } from "@/hooks/use-recent-songs";
import { deleteQueuedSong, retryGeneration } from "@/lib/song-queue-actions";
import { cn } from "@/lib/utils";

type UiStatus = "queued" | "generating" | "ready" | "failed" | "cancelled";

const STATUS_META: Record<UiStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-amber-400/50 bg-amber-500/15 text-amber-200" },
  generating: { label: "Rendering", className: "border-primary/50 bg-primary/15 text-primary" },
  ready: { label: "Ready", className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" },
  failed: {
    label: "Failed",
    className: "border-destructive/50 bg-destructive/15 text-destructive",
  },
  cancelled: { label: "Cancelled", className: "border-white/15 bg-white/5 text-muted-foreground" },
};

function toUiStatus(raw: string | null | undefined): UiStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "completed":
    case "complete":
    case "ready":
      return "ready";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "processing":
    case "generating":
    case "rendering":
      return "generating";
    default:
      return "queued";
  }
}

/** Typical end-to-end render time. Past this we stop guessing and show elapsed time. */
const EXPECTED_SECONDS = 300;

function etaLabel(song: RecentSong, now: number) {
  const started = new Date(song.generation_started_at ?? song.created_at).getTime();
  if (!Number.isFinite(started)) return "Rendering";
  const elapsed = Math.max(0, Math.round((now - started) / 1000));
  const remaining = EXPECTED_SECONDS - elapsed;
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  // Honest: no countdown to zero — after the usual window we just report how
  // long it has been running, because renders often need a few more minutes.
  if (remaining <= 0) return `Still rendering · ${clock(elapsed)}`;
  return `Usually ~${clock(remaining)} more`;
}

/** Human name for the uploaded beat this track was sung over. */
function beatLabel(song: RecentSong) {
  if (song.beat_path) {
    const file = song.beat_path.split("/").pop() ?? song.beat_path;
    return file.replace(/\.[a-z0-9]+$/i, "").slice(0, 28);
  }
  if (song.vocals_only) return "A cappella (no beat)";
  return "AI instrumental";
}

/**
 * Dashboard-level progress board: every recent track with its live status,
 * countdown, and the beat it was generated over.
 */
export function DashboardGenerationHistory({ songs }: { songs: RecentSong[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const active = songs.some((s) => ["queued", "generating"].includes(toUiStatus(s.status)));

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const refresh = () =>
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("songs") });

  async function onDelete(song: RecentSong) {
    if (
      !window.confirm(
        `Delete "${song.title || "Untitled track"}"? Any coins in flight are refunded.`,
      )
    )
      return;
    setBusy(song.id);
    try {
      await deleteQueuedSong(song);
      toast.success("Removed from the queue");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete that track");
    } finally {
      setBusy(null);
    }
  }

  async function onRetry(song: RecentSong) {
    setBusy(song.id);
    try {
      await retryGeneration(song.id);
      toast.success("Re-generating — it's back in the queue");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't restart that track");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="dash-generation-history"
      className="rounded-[2rem] border-2 border-white/15 bg-card/60 p-4 shadow-[0_18px_50px_-20px_rgba(80,60,255,0.35)] sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="dash-generation-history"
          className="flex items-center gap-2 font-display text-2xl font-black tracking-tight sm:text-3xl"
        >
          <History className="h-6 w-6 text-primary" /> Generation history
        </h2>
        <Link
          to="/library"
          className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
        >
          Studio
        </Link>
      </div>

      {songs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing rendering yet — start a track and watch it progress here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {songs.map((s) => {
            const st = toUiStatus(s.status);
            const meta = STATUS_META[st];
            const pending = st === "queued" || st === "generating";
            const canRetry = st === "failed" || st === "cancelled";
            const working = busy === s.id;
            return (
              <li key={s.id} className="flex items-center gap-2 py-3 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/library/$songId"
                    params={{ songId: s.id }}
                    className="block truncate text-sm font-bold hover:text-primary sm:text-base"
                  >
                    {s.title || "Untitled track"}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {s.vocals_only ? (
                        <Mic2 className="h-3 w-3" />
                      ) : (
                        <AudioLines className="h-3 w-3" />
                      )}
                      {beatLabel(s)}
                    </span>
                    {pending && (
                      <span className="inline-flex items-center gap-1 tabular-nums text-primary">
                        <Clock3 className="h-3 w-3" />
                        {etaLabel(s, now)}
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]",
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => void onRetry(s)}
                    disabled={working}
                    aria-label={`Retry ${s.title || "track"}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary transition hover:bg-primary/20 disabled:opacity-50"
                  >
                    {working ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onDelete(s)}
                  disabled={working}
                  aria-label={`Delete ${s.title || "track"}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                >
                  {working && !canRetry ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
