import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Headphones, Home, Pause, Play, Volume2 } from "lucide-react";
import { ogBotLogo } from "@/assets/ogbot-logo";
import ogStreamzLogo from "@/assets/og-streamz-presentz-160.webp";
import { Button } from "@/components/ui/button";
import type { PublicSharedTrack } from "@/lib/public-track.functions";
import { PortalLinks } from "./PortalLinks";

/**
 * The page a shared track link opens: artwork, title and player sized to
 * fit the screen, lyrics folded away until asked for, and the OG B0T
 * portals underneath for signed-in members (a "make your own" button for
 * everyone else).
 */
export function SharedTrackView({
  track,
  signedIn,
}: {
  track: PublicSharedTrack | null | undefined;
  signedIn: boolean;
}) {
  const lyrics = track?.lyrics?.trim();
  // The artwork is as big as the screen allows while the title and player
  // still fit without scrolling: by height on phones, beside them on wide screens.
  // Real cover art carries the OG Streamz presentz badge in its corner, like a
  // label stamp, over a soft fade so it reads on any artwork.
  const art = (
    <div className="relative aspect-square w-[min(100%,46dvh)] overflow-hidden rounded-3xl shadow-glow lg:w-[min(100%,72dvh)]">
      <img
        src={track?.coverUrl || ogBotLogo.large}
        alt={track?.coverUrl ? `Cover art for ${track.title}` : "OG B0T"}
        width={512}
        height={512}
        className="h-full w-full object-cover"
      />
      {track?.coverUrl ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent"
          />
          <img
            src={ogStreamzLogo}
            alt="OG Streamz presentz ogbot.co.uk"
            width={160}
            height={160}
            className="absolute bottom-[4%] left-[4%] aspect-square w-[22%] max-w-24 rounded-[18%] shadow-lg ring-1 ring-white/25"
          />
        </>
      ) : null}
    </div>
  );

  return (
    <main className="flex min-h-dvh flex-col bg-background px-4 pb-8 pt-5 text-foreground sm:px-6">
      <Link
        to="/welcome"
        className="mx-auto mb-4 inline-flex items-center gap-2 opacity-90 lg:mx-0"
      >
        <img src={ogBotLogo.small} alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
        <span className="font-display text-sm font-black tracking-wide">OG B0T</span>
      </Link>

      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="flex justify-center">{art}</div>

        <div className="flex w-full flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          {track?.pending ? (
            <>
              <h1 className="text-balance font-display text-[clamp(1.75rem,6vw,3.25rem)] leading-tight">
                {track.title}
              </h1>
              <p className="text-muted-foreground">
                This track is being remixed right now. It'll play here in a minute or two; this page
                checks by itself.
              </p>
            </>
          ) : track ? (
            <>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">
                  Made with OG B0T
                </p>
                <h1 className="mt-2 text-balance font-display text-[clamp(1.75rem,6vw,3.25rem)] leading-tight">
                  {track.title}
                </h1>
              </div>
              <SharedTrackPlayer src={track.audioUrl} title={track.title} />
              {lyrics && (
                // Collapsed until asked for, so the player stays the focus.
                <details className="group w-full rounded-2xl border border-border bg-card text-left">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Show lyrics</span>
                    <span className="hidden group-open:inline">Hide lyrics</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap border-t border-border px-4 py-4 text-pretty leading-7 text-muted-foreground">
                    {lyrics}
                  </div>
                </details>
              )}
              {!signedIn && (
                <Button asChild size="lg" className="w-full">
                  <Link to="/welcome">
                    <Headphones className="h-5 w-5" /> Make your own track
                  </Link>
                </Button>
              )}
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl">Track unavailable</h1>
              <p className="text-muted-foreground">
                This track is private, was removed, or is no longer available.
              </p>
              <Button asChild variant="outline">
                <Link to="/welcome">
                  <Home className="h-4 w-4" /> Visit OG B0T
                </Link>
              </Button>
            </>
          )}
        </div>
      </section>

      {signedIn && (
        <div className="mx-auto mt-10 w-full max-w-3xl">
          <PortalLinks />
        </div>
      )}
    </main>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function SharedTrackPlayer({ src, title }: { src: string; title: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gestureStartedAtRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let active = true;
    const beginPlayback = async () => {
      try {
        await audio.play();
        if (active) setAutoplayBlocked(false);
      } catch {
        if (active) setAutoplayBlocked(true);
      }
    };

    void beginPlayback();

    const startFromFirstInteraction = () => {
      if (!audio.paused) return;
      gestureStartedAtRef.current = Date.now();
      void audio.play().catch(() => {});
    };

    document.addEventListener("pointerdown", startFromFirstInteraction, {
      capture: true,
      once: true,
    });
    document.addEventListener("keydown", startFromFirstInteraction, {
      capture: true,
      once: true,
    });

    return () => {
      active = false;
      document.removeEventListener("pointerdown", startFromFirstInteraction, true);
      document.removeEventListener("keydown", startFromFirstInteraction, true);
    };
  }, [src]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Date.now() - gestureStartedAtRef.current < 500 && !audio.paused) return;
    if (audio.paused) await audio.play().catch(() => setAutoplayBlocked(true));
    else audio.pause();
  };

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4 text-left shadow-glow sm:p-5">
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        autoPlay
        playsInline
        onPlay={() => {
          setPlaying(true);
          setAutoplayBlocked(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />

      <div className="flex items-center gap-4">
        <Button
          type="button"
          size="icon"
          onClick={() => void togglePlayback()}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          className="h-16 w-16 shrink-0 rounded-full shadow-glow sm:h-20 sm:w-20"
        >
          {playing ? (
            <Pause className="h-7 w-7 sm:h-9 sm:w-9" />
          ) : (
            <Play className="h-7 w-7 translate-x-0.5 sm:h-9 sm:w-9" />
          )}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm tabular-nums text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={0.1}
            value={Math.min(currentTime, Math.max(duration, 1))}
            onChange={(event) => {
              const audio = audioRef.current;
              if (!audio) return;
              const nextTime = Number(event.target.value);
              audio.currentTime = nextTime;
              setCurrentTime(nextTime);
            }}
            aria-label={`Seek ${title}`}
            className="h-3 w-full cursor-pointer appearance-none rounded-full accent-primary"
            style={{
              background: `linear-gradient(to right, var(--primary) ${progress}%, var(--muted) ${progress}%)`,
            }}
          />
        </div>
      </div>

      <div className="mt-4 flex min-h-6 items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <Volume2 className="h-4 w-4 shrink-0" />
        <span>
          {autoplayBlocked
            ? "Tap anywhere to start listening"
            : playing
              ? "Now playing"
              : "Ready to play"}
        </span>
      </div>
    </div>
  );
}
