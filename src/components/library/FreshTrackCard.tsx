import { purchaseOwnerTrack } from "@/lib/track-unlock.functions";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Loader2, Lock, Pause, Play, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestFullTrackPlay } from "@/lib/full-track-autoplay";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { Button } from "@/components/ui/button";
import { UnlockConfirmDialog } from "@/components/library/UnlockConfirmDialog";
import { cn } from "@/lib/utils";
import type { Song } from "@/components/SongCard";

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The last step of the creation flow: the freshly finished sample plays
 * automatically, and unlocking the full track happens right here — no detour
 * to another page.
 */
export function FreshTrackCard({
  song,
  sampleSeconds,
  unlockCost,
  balance,
  onDismiss,
  autoUnlockPrompt,
}: {
  song: Song;
  sampleSeconds: number;
  unlockCost: number;
  balance: number;
  onDismiss: () => void;
  /** Open the unlock sheet as soon as the card appears (from the toast CTA). */
  autoUnlockPrompt?: boolean;
}) {
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unlockOpen, setUnlockOpen] = useState(!!autoUnlockPrompt);
  useEffect(() => {
    if (autoUnlockPrompt) setUnlockOpen(true);
  }, [autoUnlockPrompt]);
  const [busy, setBusy] = useState(false);
  const propUnlocked = !!(song as { unlocked?: boolean | null }).unlocked;
  const [unlocked, setUnlocked] = useState(propUnlocked);
  useEffect(() => {
    if (propUnlocked) setUnlocked(true);
  }, [propUnlocked]);
  // The card may hold a stale snapshot — re-check paid status from the database
  // on mount, on window focus, and every few seconds until unlocked.
  useEffect(() => {
    if (unlocked) return;
    let cancelled = false;
    const check = async () => {
      const [{ data: s }, { data: u }] = await Promise.all([
        supabase.from("songs").select("unlocked").eq("id", song.id).maybeSingle(),
        supabase.from("unlocked_songs").select("id").eq("song_id", song.id).limit(1),
      ]);
      if (!cancelled && (s?.unlocked || (u && u.length > 0))) setUnlocked(true);
    };
    void check();
    const t = setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [song.id, unlocked]);
  const title = song.title || "Your track";
  // Never offer a download until the finished master exists.
  const fullReady = song.status === "completed" && !!song.audio_path;
  const cap = Math.max(5, sampleSeconds);

  // Fetch the preview URL and start playing straight away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("song-url", {
          body: { song_id: song.id, mode: "preview" },
        });
        if (error) throw error;
        if (cancelled) return;
        const el = audioRef.current;
        if (!el) return;
        el.src = data.url as string;
        el.load();
        try {
          await el.play();
          setPlaying(true);
        } catch {
          /* autoplay blocked — the user can tap play */
        }
      } catch {
        /* silent: the play button will retry */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [song.id]);

  // Keep the preview capped to the configured sample length.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.currentTime);
      if (el.currentTime >= cap) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [cap]);

  async function toggle() {
    const el = audioRef.current;
    if (!el?.src) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      await el.play().catch(() => {});
      setPlaying(true);
    }
  }

  const buyOwnerTrack = useServerFn(purchaseOwnerTrack);
  async function confirmUnlock() {
    setBusy(true);
    try {
      const unlockData = await buyOwnerTrack({ data: { songId: song.id } });
      setUnlocked(true);
      audioRef.current?.pause();
      requestFullTrackPlay(song.id);
      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.invalidateQueries({ queryKey: ["library"] });
      if (!unlockData?.already) {
        toast.success(`Full track unlocked + Take 2 free · -${unlockData?.cost ?? unlockCost} coins`);
      }
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error) throw new Error(error.message || "Download failed");
      const blob = await downloadFile(data.url as string, `${title}.mp3`);
      setUnlockOpen(false);
      await shareTrack({ title, blob, filename: `${title}.mp3`, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  /** Fetch the paid master again and hand it to the device share sheet. */
  async function shareNow() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error || !data?.url) throw new Error("Could not prepare the track");
      const blob = await downloadFile(data.url as string, `${title}.mp3`);
      await shareTrack({ title, blob, filename: `${title}.mp3`, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.min(100, (progress / cap) * 100);

  return (
    <section
      aria-label="Your finished track"
      className="overflow-hidden rounded-3xl border-2 border-emerald-400/50 bg-emerald-500/[0.07] shadow-[0_24px_70px_-32px_rgba(16,185,129,0.8)]"
    >
      {/* Status strip */}
      <div className="flex items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-500/10 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-300">
          <span className="grid h-2 w-2 place-items-center rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(16,185,129,0.8)]" />
          Track completed
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-2 h-7 px-2 text-[11px] font-bold uppercase tracking-wider"
        >
          Hide
        </Button>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {/* Cover + title + transport in one tidy block */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/30 to-emerald-900/40 sm:h-20 sm:w-20">
            {song.cover_url ? (
              <img src={song.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center font-display text-2xl font-black text-white/85">
                {title.trim().charAt(0) || "♪"}
              </span>
            )}
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? `Pause ${title}` : `Play ${title}`}
              className="absolute inset-0 grid place-items-center bg-black/45 text-white transition hover:bg-black/30"
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : playing ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="h-6 w-6 translate-x-[1px]" />
              )}
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-xl font-black leading-tight sm:text-2xl">
              {title}
            </h3>
            <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
              {unlocked ? "Full version unlocked" : `${sampleSeconds}s free preview`}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {fmt(progress)} / {fmt(cap)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={() => setUnlockOpen(true)}
            disabled={busy || (unlocked && !fullReady)}
            className="min-h-12 w-full gap-2 rounded-2xl bg-gradient-brand font-black uppercase tracking-[0.12em] text-primary-foreground shadow-glow sm:col-span-2"
          >
            {busy || (unlocked && !fullReady) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : unlocked ? (
              <Download className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {unlocked
              ? fullReady
                ? "Download full track"
                : "Download pending…"
              : `Unlock full version · ${unlockCost} coins`}
          </Button>
          {unlocked && (
            <Button
              type="button"
              variant="outline"
              onClick={shareNow}
              disabled={busy}
              className="min-h-12 w-full gap-2 rounded-2xl border-emerald-400/40 bg-emerald-500/10 font-bold text-emerald-200"
            >
              <Share2 className="h-4 w-4" /> Share track
            </Button>
          )}
          <Link
            to="/library/$songId"
            params={{ songId: song.id }}
            className={cn("w-full", !unlocked && "sm:col-span-2")}
          >
            <Button
              type="button"
              variant="outline"
              className="min-h-12 w-full gap-2 rounded-2xl border-white/15 font-bold"
            >
              <Sparkles className="h-4 w-4" /> Edit track
            </Button>
          </Link>
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        className="hidden"
      />

      <UnlockConfirmDialog
        open={unlockOpen}
        onOpenChange={setUnlockOpen}
        onConfirm={confirmUnlock}
        busy={busy}
        cost={unlockCost}
        royalty={0}
        balance={balance}
        songTitle={title}
        songId={song.id}
        includesSecondTake
      />
    </section>
  );
}
