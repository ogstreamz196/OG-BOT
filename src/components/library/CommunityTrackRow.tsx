import { useServerFn } from "@tanstack/react-start";
import { purchaseOwnerTrack } from "@/lib/track-unlock.functions";
import { memo, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CloudDownload,
  Download,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  Share2,
  Trash2,
  Wand2,
  LockKeyhole,
  Radio,
} from "lucide-react";

import { toast } from "sonner";
import { useSongAudio } from "@/hooks/use-song-audio";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { readInvokeError } from "@/lib/invoke-error";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { UnlockConfirmDialog } from "@/components/library/UnlockConfirmDialog";
import { OwnerUnlockDialog } from "@/components/library/OwnerUnlockDialog";
import { useSettings } from "@/hooks/use-settings";
import { CreatorTag } from "@/components/library/CreatorTag";
import { SendToTelegramButton } from "@/components/library/SendToTelegramButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { cn } from "@/lib/utils";
import { POOLS } from "@/lib/library-utils";
import type { Song } from "@/components/SongCard";

export const COMMUNITY_DOWNLOAD_COST = 3;
export const COMMUNITY_DOWNLOAD_ROYALTY = 1;

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function styleChips(style?: string | null) {
  const value = (style || "").toLowerCase();
  return POOLS.genre.filter((genre) => value.includes(genre.toLowerCase())).slice(0, 2);
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
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [ownerUnlockOpen, setOwnerUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: settings } = useSettings();
  const fullUnlockCost = settings?.coins_per_full_unlock ?? 5;

  /** Owner padlock: unlock the full master, optionally bundling the hidden take. */
  const buyOwnerTrack = useServerFn(purchaseOwnerTrack);
  async function ownerUnlock() {
    setBusy(true);
    try {
      const data = await buyOwnerTrack({ data: { songId: song.id } });
      if (!data?.already) {
        toast.success(`Full track unlocked + Take 2 free · -${data?.cost ?? fullUnlockCost} coins`);
      }
      setOwnerUnlockOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profile"] }),
        qc.invalidateQueries({ queryKey: ["recent-songs"] }),
        qc.invalidateQueries({ queryKey: ["songs"] }),
        qc.invalidateQueries({ queryKey: ["library"] }),
        qc.invalidateQueries({ queryKey: ["recent-songs"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (song.duration_seconds) setDuration(song.duration_seconds);
  }, [song.duration_seconds]);

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const title = song.title || "Untitled track";
  // Album art removed from rows so the play button is always clear.

  async function confirmDownload() {
    setBusy(true);
    try {
      const { data: unlockData, error: unlockErr } = await supabase.functions.invoke(
        "unlock-full-song",
        { body: { song_id: song.id } },
      );
      if (unlockErr) {
        throw new Error(await readInvokeError(unlockErr, "Could not unlock track"));
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
        throw new Error(await readInvokeError(error, "Download failed"));
      }
      const blob = await downloadFile(data.url as string, `${title}.mp3`);
      setUnlockOpen(false);
      await shareTrack({ title, blob, filename: `${title}.mp3`, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  /** Save an unlocked owned track straight to the device. */
  async function downloadOwned() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
      });
      if (error || !data?.url) throw new Error("Could not prepare the download");
      await downloadFile(data.url as string, `${title}.mp3`);
      toast.success("Saved to your device");
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
      await shareTrack({ title, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(false);
    }
  }

  const canShare = isReady && !!song.unlocked;
  // The Drive file is the full song, so it's only offered once it's unlocked.
  const driveLink = song.unlocked
    ? (song as unknown as { drive_audio_link?: string | null }).drive_audio_link
    : null;
  const styles = styleChips(song.style);

  const actions = (
    <div className="flex shrink-0 items-center gap-1">
      {owned && !song.unlocked && isReady && (
        <button
          type="button"
          onClick={() => setOwnerUnlockOpen(true)}
          disabled={busy}
          aria-label={`Unlock the full version of ${title}`}
          className="inline-flex h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-500/15 px-2 text-xs font-black tabular-nums leading-none text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LockKeyhole className="h-3.5 w-3.5" />
          )}
          <span>{fullUnlockCost}</span>
          <span className="sr-only">OG coins to unlock</span>
        </button>
      )}
      {owned ? (
        <>
          <Link
            to="/library/$songId"
            params={{ songId: song.id }}
            aria-label={`Edit ${title}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary transition-colors hover:bg-primary/25"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          {song.unlocked && (
            <button
              type="button"
              onClick={() => void downloadOwned()}
              disabled={busy || !isReady || !song.audio_path}
              aria-label={
                isReady && song.audio_path
                  ? `Download ${title} to device`
                  : `Download pending — ${title} is still finishing`
              }
              title={
                isReady && song.audio_path ? undefined : "Download pending — track still finishing"
              }
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
            >
              {busy || !isReady || !song.audio_path ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {song.unlocked && (
            <SendToTelegramButton
              songId={song.id}
              title={title}
              variant="icon"
              disabled={busy || !isReady || !song.audio_path}
            />
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setUnlockOpen(true)}
          disabled={!isReady || busy}
          aria-label={`Download ${title} for ${COMMUNITY_DOWNLOAD_COST} OG coins or 99p`}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/15 px-2 text-xs font-black tabular-nums leading-none text-primary transition-colors",
            isReady && !busy ? "hover:bg-primary/25" : "opacity-40",
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span>{COMMUNITY_DOWNLOAD_COST}</span>
          <span className="sr-only">OG coins or 99p</span>
        </button>
      )}
      {(canShare || (owned && driveLink) || onDelete || onRemix) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${title}`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreVertical className="h-3.5 w-3.5" />
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            {onRemix && (
              <DropdownMenuItem onSelect={() => onRemix(song)}>
                <Wand2 className="mr-2 h-4 w-4" /> Remix vibe
              </DropdownMenuItem>
            )}
            {canShare && (
              <DropdownMenuItem disabled={busy} onSelect={() => void shareUnlocked()}>
                <Share2 className="mr-2 h-4 w-4" /> Share track
              </DropdownMenuItem>
            )}
            {owned && driveLink && (
              <DropdownMenuItem asChild>
                <a href={driveLink} target="_blank" rel="noreferrer">
                  <CloudDownload className="mr-2 h-4 w-4" /> Open Drive backup
                </a>
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onDelete(song)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <li
      className={cn(
        "group relative px-3 py-2.5 transition-colors hover:bg-primary/[0.06]",
        playing && "bg-primary/[0.08] shadow-[inset_3px_0_0_var(--primary)]",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5">
        {/* Artwork doubles as the play / pause control. */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={!isReady}
          aria-label={`${playing ? "Pause" : "Play"} ${title}`}
          className={cn(
            "relative grid h-12 w-12 shrink-0 place-items-center transition-transform",
            isReady ? "hover:scale-110 active:scale-95" : "opacity-50",
          )}
        >
          {/* Bright yellow play button — no artwork or background behind it. */}
          {loadingUrl ? (
            <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
          ) : playing ? (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-yellow-400 shadow-[0_0_16px_-2px_rgba(250,204,21,0.7)]">
              <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
                <i className="h-1.5 w-[3px] animate-[eqbar_0.9s_ease-in-out_infinite] rounded-full bg-black" />
                <i className="h-3.5 w-[3px] animate-[eqbar_0.7s_ease-in-out_infinite] rounded-full bg-black" />
                <i className="h-2.5 w-[3px] animate-[eqbar_1.1s_ease-in-out_infinite] rounded-full bg-black" />
              </span>
            </span>
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-yellow-400 shadow-[0_0_16px_-2px_rgba(250,204,21,0.7)]">
              <Play className="h-4.5 w-4.5 translate-x-[1px] fill-black text-black" />
            </span>
          )}
        </button>

        <div className="min-w-0">
          {/* Row 1: title gets the full width. */}
          <div className="flex min-w-0 items-center gap-1.5">
            {owned ? (
              <Link
                to="/library/$songId"
                params={{ songId: song.id }}
                className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug hover:text-primary focus:outline-none focus-visible:underline"
              >
                {title}
              </Link>
            ) : (
              <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug">
                {title}
              </p>
            )}
            {song.is_variation && (
              <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-400/25 bg-amber-500/10 px-1.5 py-px text-[0.7rem] font-semibold leading-tight text-amber-300">
                Take 2
              </span>
            )}
          </div>

          {/* Row 2: quiet info on the left, actions on the right. */}
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-none text-muted-foreground">
              {!owned && <CreatorTag userId={song.user_id} className="max-w-[72px] shrink-0" />}
              {styles.length > 0 && <span className="min-w-0 truncate">{styles[0]}</span>}
              {duration > 0 && (
                <span className="shrink-0 whitespace-nowrap tabular-nums">{fmt(duration)}</span>
              )}
              {!(song.unlocked || song.artistUnlocked) && (
                <Radio className="h-3 w-3 shrink-0" aria-label={owned ? "Preview" : "Stream"} />
              )}
            </div>
            {actions}
          </div>
        </div>
      </div>

      {/* Ultra-thin progress line, only for the track that's playing. */}
      {(playing || progress > 0) && duration > 0 && (
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-400 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <audio
        ref={audioRef}
        preload="none"
        onEnded={handleEnded}
        data-og-track={song.id}
        data-og-title={song.title || "OG track"}
        data-og-full={owned && !song.unlocked ? undefined : "1"}
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

      {owned && (
        <OwnerUnlockDialog
          open={ownerUnlockOpen}
          onOpenChange={setOwnerUnlockOpen}
          songId={song.id}
          songTitle={song.title}
          balance={balance}
          singleCost={fullUnlockCost}
          busy={busy}
          onConfirm={() => void ownerUnlock()}
        />
      )}
    </li>
  );
}

export const CommunityTrackRow = memo(CommunityTrackRowImpl);
export const TrackRow = CommunityTrackRow;
