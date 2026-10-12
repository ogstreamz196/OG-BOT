import { Pause, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import backgroundTrack from "@/assets/og-bot-background.mp3.asset.json";
import anthemTrack from "@/assets/og-bot-anthem.mp3.asset.json";
import { Button } from "@/components/ui/button";

/** Background rotation: plays in order, then cycles back to the first track. */
const PLAYLIST = [backgroundTrack.url, anthemTrack.url];

const ENABLED_KEY = "og:background-music-enabled";
const POSITION_KEY = "og:background-music-position";
const TRACK_KEY = "og:background-music-track";
const TOGGLE_EVENT = "og:background-music-toggle";
const NEXT_EVENT = "og:background-music-next";
const ENTER_BATTLE_EVENT = "og:background-music-enter-battle";
const STATUS_EVENT = "og:background-music-status";
const STATUS_REQUEST_EVENT = "og:background-music-status-request";
const BACKGROUND_VOLUME = 0.5;
const FADE_DURATION_MS = 2_000;

function announceStatus(playing: boolean) {
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { playing } }));
}

export function BackgroundMusicHeaderControl({ className = "" }: { className?: string }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ playing?: boolean }>).detail;
      setPlaying(Boolean(detail?.playing));
    };
    window.addEventListener(STATUS_EVENT, update);
    window.dispatchEvent(new Event(STATUS_REQUEST_EVENT));
    return () => window.removeEventListener(STATUS_EVENT, update);
  }, []);

  return (
    <div className={`flex shrink-0 items-center gap-0.5 ${className}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full hover:bg-white/5 sm:h-9 sm:w-9"
        onClick={() => window.dispatchEvent(new Event(TOGGLE_EVENT))}
        aria-label={playing ? "Pause background music" : "Play background music"}
        title={playing ? "Pause background music" : "Play background music"}
        data-background-music-control
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
        <span className="sr-only">
          {playing ? "Pause background music" : "Play background music"}
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full hover:bg-white/5 sm:h-9 sm:w-9"
        onClick={() => window.dispatchEvent(new Event(NEXT_EVENT))}
        aria-label="Play next background track"
        title="Next background track"
        data-background-music-control
      >
        <SkipForward className="h-4 w-4" aria-hidden />
        <span className="sr-only">Play next background track</span>
      </Button>
    </div>
  );
}

/**
 * One audio element mounted above the router outlet, so client-side page
 * changes never interrupt or restart the soundtrack.
 */
export function PersistentBackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const enabledRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const fadeFrameRef = useRef<number | null>(null);
  // Skip the very first src change (initial mount) so the stored position sticks.
  const advancedRef = useRef(false);

  const stopFade = useCallback(() => {
    if (fadeFrameRef.current !== null) {
      window.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  }, []);

  const fadeIn = useCallback(
    (audio: HTMLAudioElement) => {
      stopFade();
      audio.volume = 0;
      const startedAt = performance.now();
      const tick = (now: number) => {
        // Some browsers can deliver a frame timestamp fractionally before
        // performance.now(); clamp both ends so HTMLMediaElement never receives
        // an out-of-range volume during the first fade frame.
        const progress = Math.max(0, Math.min((now - startedAt) / FADE_DURATION_MS, 1));
        audio.volume = BACKGROUND_VOLUME * progress;
        if (progress < 1 && !audio.paused) {
          fadeFrameRef.current = window.requestAnimationFrame(tick);
        } else {
          fadeFrameRef.current = null;
        }
      };
      fadeFrameRef.current = window.requestAnimationFrame(tick);
    },
    [stopFade],
  );

  const start = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return false;
    stopFade();
    audio.volume = 0;
    try {
      await audio.play();
      fadeIn(audio);
      setPlaying(true);
      return true;
    } catch {
      audio.volume = BACKGROUND_VOLUME;
      setPlaying(false);
      return false;
    }
  }, [fadeIn, stopFade]);

  const advanceToRandomTrack = useCallback(() => {
    advancedRef.current = true;
    window.localStorage.setItem(POSITION_KEY, "0");
    setTrackIndex((currentIndex) => {
      if (PLAYLIST.length < 2) return currentIndex;
      const choices = PLAYLIST.map((_, index) => index).filter((index) => index !== currentIndex);
      const nextIndex = choices[Math.floor(Math.random() * choices.length)] ?? currentIndex;
      window.localStorage.setItem(TRACK_KEY, String(nextIndex));
      return nextIndex;
    });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0;

    const storedEnabled = window.localStorage.getItem(ENABLED_KEY);
    // Native Android/iOS apps never auto-play on launch; the header Play button
    // still works. The website no longer auto-plays either — the soundtrack
    // starts when the visitor steps into the OG Battle Zone or taps Play.
    const isNativeApp = Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
        ?.isNativePlatform?.(),
    );
    enabledRef.current = isNativeApp ? false : storedEnabled !== "0";

    const storedTrack = Number(window.localStorage.getItem(TRACK_KEY));
    if (Number.isInteger(storedTrack) && storedTrack > 0 && storedTrack < PLAYLIST.length) {
      setTrackIndex(storedTrack);
    }

    const storedPosition = Number(window.localStorage.getItem(POSITION_KEY));
    if (Number.isFinite(storedPosition) && storedPosition > 0) {
      audio.currentTime = storedPosition;
    }

    const onPlay = () => {
      setPlaying(true);
      announceStatus(true);
    };
    const onPause = () => {
      setPlaying(false);
      announceStatus(false);
    };
    const savePosition = () => {
      if (Number.isFinite(audio.currentTime)) {
        window.localStorage.setItem(POSITION_KEY, String(audio.currentTime));
      }
    };

    const onEnded = () => advanceToRandomTrack();

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", savePosition);
    const saveTimer = window.setInterval(savePosition, 5_000);
    setReady(true);

    // The soundtrack never auto-plays on load. It starts only when the user
    // steps into the OG Battle Zone (ENTER_BATTLE_EVENT) or taps the header
    // play controls.
    let unlockAttached = false;
    let removeUnlockListeners = () => undefined;
    const enterBattle = () => {
      if (!enabledRef.current || unlockAttached) return;
      const otherMediaPlaying = Array.from(
        document.querySelectorAll<HTMLMediaElement>(
          "audio:not([data-background-music]), video",
        ),
      ).some((media) => !media.paused && !media.ended);
      if (otherMediaPlaying) return;
      void start().then((started) => {
        if (started) {
          removeUnlockListeners();
          return;
        }
        // iOS and most mobile browsers require one genuine interaction before
        // starting audible media. Wait for the first tap or key press.
        const unlock = (event: Event) => {
          if (!enabledRef.current) return;
          if (
            event.target instanceof Element &&
            event.target.closest("[data-background-music-control]")
          ) {
            return;
          }
          void start().then((unlocked) => {
            if (unlocked) removeUnlockListeners();
          });
        };
        unlockAttached = true;
        document.addEventListener("pointerup", unlock, { passive: true });
        document.addEventListener("keydown", unlock);
        removeUnlockListeners = () => {
          unlockAttached = false;
          document.removeEventListener("pointerup", unlock);
          document.removeEventListener("keydown", unlock);
        };
      });
    };
    window.addEventListener(ENTER_BATTLE_EVENT, enterBattle);

    return () => {
      savePosition();
      stopFade();
      removeUnlockListeners();
      window.removeEventListener(ENTER_BATTLE_EVENT, enterBattle);
      window.clearInterval(saveTimer);
      window.removeEventListener("pagehide", savePosition);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [advanceToRandomTrack, start, stopFade]);

  // When the rotation moves on, load the new track and keep playing.
  useEffect(() => {
    if (!advancedRef.current) return;
    advancedRef.current = false;
    const audio = audioRef.current;
    if (!audio || !enabledRef.current) return;
    audio.currentTime = 0;
    void start();
  }, [trackIndex, start]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      enabledRef.current = false;
      window.localStorage.setItem(ENABLED_KEY, "0");
      stopFade();
      audio.pause();
      return;
    }

    enabledRef.current = true;
    window.localStorage.setItem(ENABLED_KEY, "1");
    await start();
  };

  const playNext = useCallback(() => {
    enabledRef.current = true;
    window.localStorage.setItem(ENABLED_KEY, "1");
    advanceToRandomTrack();
  }, [advanceToRandomTrack]);

  useEffect(() => {
    if (!ready) return;
    const handleToggle = () => void toggle();
    const handleNext = () => playNext();
    const reportStatus = () => announceStatus(playing);
    window.addEventListener(TOGGLE_EVENT, handleToggle);
    window.addEventListener(NEXT_EVENT, handleNext);
    window.addEventListener(STATUS_REQUEST_EVENT, reportStatus);
    announceStatus(playing);
    return () => {
      window.removeEventListener(TOGGLE_EVENT, handleToggle);
      window.removeEventListener(NEXT_EVENT, handleNext);
      window.removeEventListener(STATUS_REQUEST_EVENT, reportStatus);
    };
  }, [playNext, playing, ready]);

  return (
    <>
      <audio
        ref={audioRef}
        src={PLAYLIST[trackIndex]}
        preload="auto"
        className="hidden"
        data-background-music
      />
    </>
  );
}
