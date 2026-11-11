import { useUserSongsRealtime } from "@/hooks/user-songs-realtime";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Loader2, Pause, Play, Share2, Sparkles } from "lucide-react";
import { SendToTelegramButton } from "@/components/library/SendToTelegramButton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimAudio } from "@/lib/audio-focus";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { Button } from "@/components/ui/button";
import type { Song } from "@/components/SongCard";

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The last step of the creation flow. Every track is paid for before it cooks,
 * so the finished master plays straight away and downloads in one tap.
 */
export function FreshTrackCard({
  song,
  sampleSeconds,
  onDismiss,
}: {
  song: Song;
  sampleSeconds: number;
  onDismiss: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const propUnlocked = !!(song as { unlocked?: boolean | null }).unlocked;
  const [unlocked, setUnlocked] = useState(propUnlocked);
  useEffect(() => {
    if (propUnlocked) setUnlocked(true);
  }, [propUnlocked]);
  // The card may hold a stale snapshot: the member's songs feed flips it the
  // moment the track is paid for; as a fallback re-check on mount, on window
  // focus, and every 15s while visible until unlocked.
  const { user } = useAuth();
  useUserSongsRealtime(unlocked ? null : user?.id, (change) => {
    const row = change.new as { id?: string; unlocked?: boolean | null } | undefined;
    if (row?.id === song.id && row.unlocked) setUnlocked(true);
  });
  useEffect(() => {
    if (unlocked) return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      const [{ data: s }, { data: u }] = await Promise.all([
        supabase.from("songs").select("unlocked").eq("id", song.id).maybeSingle(),
        supabase.from("unlocked_songs").select("id").eq("song_id", song.id).limit(1),
      ]);
      if (!cancelled && (s?.unlocked || (u && u.length > 0))) setUnlocked(true);
    };
    void check();
    const t = setInterval(check, 15_000);
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
  // Paid tracks (upfront coins or card) play the full master, uncapped.
  const playFull = unlocked && fullReady;
  const [duration, setDuration] = useState(0);
  const cap = playFull ? duration || Infinity : Math.max(5, sampleSeconds);

  // Fetch the preview URL and start playing straight away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("song-url", {
          body: { song_id: song.id, mode: playFull ? "full" : "preview" },
        });
        if (error) throw error;
        if (cancelled) return;
        const el = audioRef.current;
        if (!el) return;
        el.src = data.url as string;
        el.load();
        try {
          claimAudio(el);
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
  }, [song.id, playFull]);

  // Keep the preview capped to the configured sample length.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.currentTime);
      if (!playFull && el.currentTime >= cap) {
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
      claimAudio(el);
      await el.play().catch(() => {});
      setPlaying(true);
    }
  }

  async function downloadNow() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error || !data?.url) throw new Error("Download failed");
      await downloadFile(data.url as string, `${title}.mp3`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  /** Fetch the paid master again and hand it to the device share sheet. */
  async function shareNow() {
    setBusy(true);
    try {
      await shareTrack({ title, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(false);
    }
  }

  const pct = Number.isFinite(cap) && cap > 0 ? Math.min(100, (progress / cap) * 100) : 0;

  return (
    <section
      aria-label="Your finished track"
      className="overflow-hidden rounded-3xl border-2 border-emerald-400/50 bg-emerald-500/[0.07] shadow-[0_24px_70px_-32px_rgba(16,185,129,0.8)]"
    >
      {/* Status strip */}
      <div className="flex items-center justify-between gap-3 border-b border-emerald-400/20 bg-emerald-500/10 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
          <span className="grid h-2 w-2 place-items-center rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(16,185,129,0.8)]" />
          Track completed
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-2 h-7 px-2 text-xs font-bold uppercase tracking-wider"
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
            <p className="mt-0.5 truncate text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
              {playFull ? "Full Master Ready" : "Finalising audio…"}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {fmt(progress)} / {Number.isFinite(cap) ? fmt(cap) : "--:--"}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={downloadNow}
            disabled={busy || !playFull}
            className="min-h-12 w-full gap-2 rounded-2xl bg-gradient-brand font-black uppercase tracking-[0.12em] text-primary-foreground shadow-glow sm:col-span-2"
          >
            {busy || !playFull ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {playFull ? "Download full track" : "Finalising audio…"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={shareNow}
            disabled={busy || !playFull}
            className="min-h-12 w-full gap-2 rounded-2xl border-emerald-400/40 bg-emerald-500/10 font-bold text-emerald-200"
          >
            <Share2 className="h-4 w-4" /> Share track
          </Button>
          <SendToTelegramButton
            songId={song.id}
            title={title}
            disabled={busy || !playFull}
            className="min-h-12 w-full rounded-2xl"
          />
          <Link to="/library/$songId" params={{ songId: song.id }} className="w-full">
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
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        className="hidden"
      />
    </section>
  );
}
