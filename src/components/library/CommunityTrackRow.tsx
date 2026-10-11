import { memo, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CloudDownload,
  Download,
  Loader2,
  Music2,
  Pause,
  Pencil,
  Play,
  Share2,
  Trash2,
  Wand2,
} from "lucide-react";

import { toast } from "sonner";
import { useSongAudio } from "@/hooks/use-song-audio";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { UnlockConfirmDialog } from "@/components/library/UnlockConfirmDialog";
import { cn } from "@/lib/utils";
import type { Song } from "@/components/SongCard";

export const COMMUNITY_DOWNLOAD_COST = 3;
export const COMMUNITY_DOWNLOAD_ROYALTY = 1;

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Deterministic hue from the song id so placeholders feel intentional, not random. */
function hueFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * Global (community) library row — cover thumbnail with a polished fallback,
 * title, compact quick actions (play/pause, seek, unlock/download).
 * Community tracks stream in full; downloading costs coins.
 */
function CommunityTrackRowImpl({
  song,
  variant = "community",
  onDelete,
  onRemix,
}: {
  song: Song;
  /** "owned" rows link to the edit/regenerate workspace instead of charging coins. */
  variant?: "owned" | "community";
  onDelete?: (song: Song) => void;
  /** Opens the creation wizard pre-loaded with this track's vibe. */
  onRemix?: (song: Song) => void;
}) {
  const owned = variant === "owned";
  const hasAudio = !!(song.audio_path || song.sample_path);
  const isReady = song.status === "completed" && hasAudio;
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const balance = (profile as { coin_balance?: number } | null)?.coin_balance ?? 0;

  const { audioRef, playing, loadingUrl, progress, togglePlay, handleEnded } = useSongAudio({
    songId: song.id,
    hasAudio,
    ready: isReady,
    // Full playback in the global library — no preview cap, and the signed URL
    // points at the complete master rather than the 60s sample.
    sampleSeconds: Number.MAX_SAFE_INTEGER,
    // Owners hear the full master once unlocked; otherwise the free sample.
    mode: owned && !song.unlocked ? "preview" : "full",
    playlistTitle: song.title || "Untitled track",
  });

  const [duration, setDuration] = useState<number>(song.duration_seconds ?? 0);
  const [coverFailed, setCoverFailed] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (song.duration_seconds) setDuration(song.duration_seconds);
  }, [song.duration_seconds]);

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const title = song.title || "Untitled track";
  const showCover = !!song.cover_url && !coverFailed;
  const hue = hueFor(song.id);

  async function confirmDownload() {
    setBusy(true);
    try {
      const { data: unlockData, error: unlockErr } = await supabase.functions.invoke(
        "unlock-full-song",
        { body: { song_id: song.id } },
      );
      if (unlockErr) {
        throw new Error(
          (unlockErr as { context?: { error?: string } })?.context?.error ||
            unlockErr.message ||
            "Could not unlock track",
        );
      }
      if (!unlockData?.already) {
        toast.success(
          `Charged ${unlockData?.cost ?? COMMUNITY_DOWNLOAD_COST} OG coins — ${
            unlockData?.royalty ?? COMMUNITY_DOWNLOAD_ROYALTY
          } sent to the creator as a royalty.`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["profile"] });

      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error) {
        throw new Error(
          (error as { context?: { error?: string } })?.context?.error ||
            error.message ||
            "Download failed",
        );
      }
      const blob = await downloadFile(data.url as string, `${title}.mp3`);
      setUnlockOpen(false);
      await shareTrack({ title, blob, filename: `${title}.mp3` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  /** Re-download an already-paid track and hand it to the share sheet. */
  async function shareUnlocked() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error || !data?.url) throw new Error("Could not prepare the track");
      const blob = await downloadFile(data.url as string, `${title}.mp3`);
      await shareTrack({ title, blob, filename: `${title}.mp3` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(false);
    }
  }

  const canShare = isReady && !!song.unlocked;
  const driveLink = (song as unknown as { drive_audio_link?: string | null }).drive_audio_link;

  const actions = (
    <div className="flex shrink-0 items-center gap-1.5">
      {onRemix && (
        <div className="flex shrink-0 flex-col items-center">
          <span
            aria-hidden
            className="mb-0.5 text-[0.7rem] font-black uppercase leading-none tracking-[0.12em] text-amber-300/90"
          >
            Remix
          </span>
          <button
            type="button"
            onClick={() => onRemix(song)}
            aria-label={`Use this vibe from ${title}`}
            title="Use this vibe"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber-400/40 bg-amber-500/15 text-amber-300 transition-colors hover:bg-amber-500/25"
          >
            <Wand2 className="h-4 w-4" />
          </button>
        </div>
      )}
      {owned && driveLink && (
        <a
          href={driveLink}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} backup in Google Drive`}
          title="Saved to Google Drive"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-sky-400/40 bg-sky-500/15 text-sky-300 transition-colors hover:bg-sky-500/25"
        >
          <CloudDownload className="h-4 w-4" />
        </a>
      )}
      {canShare && (
        <button
          type="button"
          onClick={shareUnlocked}
          disabled={busy}
          aria-label={`Share ${title}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        </button>
      )}

      {owned ? (
        <Link
          to="/library/$songId"
          params={{ songId: song.id }}
          aria-label={`Edit ${title}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary transition-colors hover:bg-primary/25"
        >
          <Pencil className="h-4 w-4" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setUnlockOpen(true)}
          disabled={!isReady || busy}
          aria-label={`Download ${title} for ${COMMUNITY_DOWNLOAD_COST} OG coins or 99p`}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 text-xs font-black tabular-nums text-primary transition-colors",
            isReady && !busy ? "hover:bg-primary/25" : "opacity-40",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{COMMUNITY_DOWNLOAD_COST}</span>
          <span className="sr-only">OG coins or 99p</span>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(song)}
          aria-label={`Delete ${title}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-destructive/40 bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <li className="group px-3 py-3 transition-colors hover:bg-primary/[0.06]">
      {/* Row 1 — artwork + full-width title, so long names stay readable */}
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-card"
          style={{
            backgroundImage: showCover
              ? undefined
              : `linear-gradient(140deg, oklch(0.32 0.13 ${hue}), oklch(0.18 0.06 ${(hue + 40) % 360}))`,
          }}
        >
          {showCover ? (
            <img
              src={song.cover_url!}
              alt=""
              loading="lazy"
              decoding="async"
              width={44}
              height={44}
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <span className="font-display text-base font-black uppercase text-white/85">
                {title.trim().charAt(0) || <Music2 className="h-5 w-5 text-white/70" />}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {owned ? (
            <Link
              to="/library/$songId"
              params={{ songId: song.id }}
              className="line-clamp-2 text-[15px] font-semibold leading-snug hover:text-primary focus:outline-none focus-visible:underline"
            >
              {title}
            </Link>
          ) : (
            <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{title}</p>
          )}
        </div>
      </div>

      {/* Row 2 — transport: play, seek bar, time, quick actions */}
      <div className="mt-2 flex items-center gap-2 pl-[3.5rem]">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!isReady}
          aria-label={`${playing ? "Pause" : "Play"} ${title}`}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary transition-colors",
            isReady ? "hover:bg-primary/25" : "opacity-40",
          )}
        >
          {loadingUrl ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 translate-x-[1px]" />
          )}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={1}
          value={Math.min(Math.round(progress), Math.max(1, Math.round(duration)))}
          onChange={(e) => {
            const el = audioRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
          disabled={!isReady || duration <= 0}
          aria-label={`Seek ${title}`}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-default"
          style={{
            background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)`,
          }}
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {playing || progress > 0 ? `${fmt(progress)} / ` : ""}
          {fmt(duration)}
        </span>
        {actions}
      </div>

      <audio
        ref={audioRef}
        preload="none"
        onEnded={handleEnded}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        className="hidden"
      />

      <UnlockConfirmDialog
        open={unlockOpen}
        onOpenChange={setUnlockOpen}
        onConfirm={confirmDownload}
        busy={busy}
        cost={COMMUNITY_DOWNLOAD_COST}
        royalty={COMMUNITY_DOWNLOAD_ROYALTY}
        balance={balance}
        songTitle={song.title}
        songId={song.id}
      />
    </li>
  );
}

export const CommunityTrackRow = memo(CommunityTrackRowImpl);
export const TrackRow = CommunityTrackRow;
