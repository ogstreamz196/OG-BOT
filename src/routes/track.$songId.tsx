import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Headphones, Home, Pause, Play, Volume2 } from "lucide-react";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import { Button } from "@/components/ui/button";
import { getPublicSharedTrack } from "@/lib/public-track.functions";

const SITE_URL = "https://ogbot.co.uk";
const SHARE_IMAGE = `${SITE_URL}/share/og-bot-track.png`;

export const Route = createFileRoute("/track/$songId")({
  loader: ({ params }) => getPublicSharedTrack({ data: { songId: params.songId } }),
  head: ({ params, loaderData }) => {
    const title = loaderData?.title || "Shared OG BOT track";
    const description = loaderData
      ? `Listen to “${title}”, created with OG BOT.`
      : "Listen to music created with OG BOT.";
    const url = `${SITE_URL}/track/${params.songId}`;
    return {
      meta: [
        { title: `${title} — OG BOT` },
        { name: "description", content: description },
        { property: "og:title", content: `${title} — OG BOT` },
        { property: "og:description", content: description },
        { property: "og:type", content: "music.song" },
        { property: "og:url", content: url },
        { property: "og:image", content: SHARE_IMAGE },
        { property: "og:image:alt", content: "OG BOT" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: `${title} — OG BOT` },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SHARE_IMAGE },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SharedTrackPage,
});

function SharedTrackPage() {
  const track = Route.useLoaderData();
  const lyrics = track?.lyrics?.trim();

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:py-14">
      <section className="mx-auto w-full max-w-2xl text-center">
        <img
          src={ogBotAsset.url}
          alt="OG BOT"
          width={512}
          height={512}
          className="mx-auto aspect-square w-52 rounded-2xl object-cover shadow-glow sm:w-64"
        />

        {track ? (
          <>
            <h1 className="mt-8 text-balance font-display text-3xl text-foreground sm:text-4xl">
              {track.title}
            </h1>
            <SharedTrackPlayer src={track.audioUrl} title={track.title} />
            <Button asChild size="lg" className="mt-7 w-full max-w-xl">
              <Link to="/welcome">
                <Headphones className="h-5 w-5" /> Make a track with OG BOT
              </Link>
            </Button>

            {lyrics && (
              <section className="mx-auto mt-12 max-w-xl border-t border-border pt-9 text-left">
                <h2 className="font-display text-2xl text-foreground">Lyrics</h2>
                <div className="mt-5 whitespace-pre-wrap text-pretty text-base leading-8 text-muted-foreground">
                  {lyrics}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl text-foreground">Track unavailable</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This track is private, was removed, or is no longer available.
            </p>
            <Button asChild variant="outline" className="mt-7">
              <Link to="/welcome">
                <Home className="h-4 w-4" /> Visit OG BOT
              </Link>
            </Button>
          </>
        )}
      </section>
    </main>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function SharedTrackPlayer({ src, title }: { src: string; title: string }) {
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
    <div className="mx-auto mt-7 w-full max-w-xl rounded-lg border border-border bg-surface p-4 text-left shadow-glow sm:p-5">
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
