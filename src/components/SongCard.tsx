import { memo } from "react";
import { Play, Pause, Loader2, Music2, Download, AlertCircle, Lock, Share2 } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { useSongAudio } from "@/hooks/use-song-audio";
import { useReferralUrl } from "@/hooks/use-referral-url";
import { shareLyricClip } from "@/lib/share-clip";
import { Button } from "@/components/ui/button";
import { CreatorTag } from "@/components/library/CreatorTag";

import { cn } from "@/lib/utils";

export interface Song {
  id: string;
  user_id?: string | null;
  title: string | null;
  prompt: string;
  style: string | null;
  status: string;
  audio_path: string | null;
  sample_path?: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at?: string | null;
  generation_started_at?: string | null;
  suno_task_id?: string | null;
  stream_audio_url?: string | null;
  unlocked?: boolean | null;
  /** True when the track's creator unlocked the master — everyone can listen free. */
  artistUnlocked?: boolean | null;
  is_variation?: boolean | null;
  revealed?: boolean | null;
  drive_audio_link?: string | null;
  retry_count?: number | null;
  next_retry_at?: string | null;
  failure_class?: "recoverable_cdn" | "retryable" | "terminal" | null;
}

function SongCardImpl({ song }: { song: Song }) {
  const { data: settings } = useSettings();
  const sampleSeconds = settings?.sample_seconds ?? 60;
  const referralUrl = useReferralUrl();

  const hasAudio = !!(song.audio_path || song.sample_path);
  // Already paid to unlock? Stream the complete master with no preview cap.
  const unlocked = !!song.unlocked && !!song.audio_path;
  const isReady = song.status === "completed" && hasAudio;
  const isFailed = song.status === "failed";
  const isPending = song.status === "pending" || song.status === "processing";

  const { audioRef, playing, loadingUrl, progress, togglePlay, download, handleEnded } =
    useSongAudio({
      songId: song.id,
      hasAudio,
      ready: isReady,
      sampleSeconds: unlocked ? Number.MAX_SAFE_INTEGER : sampleSeconds,
      mode: unlocked ? "full" : "preview",
    });

  return (
    <div className="group flex gap-4 rounded-2xl border border-border bg-card p-4 shadow-card transition-all hover:shadow-glow">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-brand-soft">
        {song.cover_url ? (
          <img
            src={song.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Music2 className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        {isReady && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={playing ? "Pause" : "Play"}
          >
            {loadingUrl ? (
              <Loader2 className="h-7 w-7 animate-spin text-white" />
            ) : playing ? (
              <Pause className="h-7 w-7 text-white" />
            ) : (
              <Play className="h-7 w-7 text-white" />
            )}
          </button>
        )}
        {isPending && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <h3 className="truncate font-semibold">
            {song.title || (isPending ? "Generating..." : "Untitled")}
          </h3>
          <p className="line-clamp-2 text-sm text-muted-foreground">{song.prompt}</p>
          {song.style && (
            <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {song.style}
            </span>
          )}
          <CreatorTag userId={song.user_id} className="mt-1" />
        </div>

        {isReady && (
          <div className="mt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!unlocked && <Lock className="h-3 w-3" />}
              <span>
                {unlocked
                  ? "Unlocked • full track"
                  : `Preview limited to ${sampleSeconds}s • Download for full track`}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, (progress / (unlocked ? song.duration_seconds || 180 : sampleSeconds)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className={cn(
              "shrink-0 whitespace-nowrap text-xs font-medium",
              isReady && "text-primary",
              isPending && "text-muted-foreground",
              isFailed && "whitespace-normal text-destructive",
            )}
          >
            {isReady && "Ready"}
            {isPending && "Generating song..."}
            {isFailed && (
              <span className="inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {song.error_message || "Failed"}
              </span>
            )}
          </span>
          {isReady && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Share a lyric card"
                onClick={() =>
                  shareLyricClip({
                    title: song.title || "OG track",
                    lyrics: song.prompt,
                    style: song.style,
                    referralUrl,
                  })
                }
              >
                <Share2 className="mr-2 h-3.5 w-3.5" />
                Share
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => download(`${song.title || "song"}.mp3`)}
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                <span className="min-[400px]:hidden">Download</span>
                <span className="hidden min-[400px]:inline">Download (free)</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        onEnded={handleEnded}
        className="hidden"
        data-og-track={song.id}
        data-og-title={song.title || "OG track"}
        data-og-full={unlocked ? "1" : undefined}
      />
    </div>
  );
}

export const SongCard = memo(
  SongCardImpl,
  (a, b) =>
    a.song.id === b.song.id &&
    a.song.status === b.song.status &&
    a.song.audio_path === b.song.audio_path &&
    a.song.sample_path === b.song.sample_path &&
    a.song.cover_url === b.song.cover_url &&
    a.song.title === b.song.title &&
    a.song.error_message === b.song.error_message,
);
