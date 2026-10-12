import { useEffect, useRef, useState } from "react";
import { usePlaylist } from "@/hooks/use-playlist";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";

interface UseSongAudioOptions {
  songId: string;
  hasAudio: boolean;
  /** When true (status === "completed" && audio available), pre-fetch the signed URL. */
  ready: boolean;
  /** Cap playback at this many seconds (preview limit). */
  sampleSeconds: number;
  /**
   * "preview" streams the short sample; "full" streams the complete master.
   * Community listeners may stream "full" for free — downloading still costs coins.
   */
  mode?: "preview" | "full";
  /** Joins the shared playlist queue (auto-advance + mini player controls). */
  playlistTitle?: string;
}

/**
 * Owns the signed-URL fetch, audio element lifecycle, sample cap, and play/pause
 * controls for a song card. Keeps `SongCard` purely presentational.
 */
export function useSongAudio({
  songId,
  hasAudio,
  ready,
  sampleSeconds,
  mode = "preview",
  playlistTitle,
}: UseSongAudioOptions) {
  const playlist = usePlaylist();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRequestRef = useRef<Promise<string | null> | null>(null);
  // Signed links expire (5 min for full tracks, 15 for previews). A pre-warmed
  // link for track 3 in a queue is often dead by the time we reach it, which
  // made the playlist silently stop — so refresh anything close to expiry.
  const fetchedAtRef = useRef(0);
  const playlistTitleRef = useRef(playlistTitle);
  playlistTitleRef.current = playlistTitle;
  const maxAgeMs = (mode === "full" ? 4 : 13) * 60 * 1000;

  async function ensureUrl(force = false): Promise<string | null> {
    if (signedUrl && !force && Date.now() - fetchedAtRef.current < maxAgeMs) return signedUrl;
    if (!hasAudio) return null;
    if (urlRequestRef.current) return urlRequestRef.current;
    setLoadingUrl(true);
    const request = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("song-url", {
          body:
            mode === "full"
              ? { song_id: songId, mode: "full", purpose: "stream" }
              : { song_id: songId, mode: "preview" },
        });
        if (error) throw error;
        const url = typeof data?.url === "string" ? data.url : null;
        if (!url) return null;
        fetchedAtRef.current = Date.now();
        setSignedUrl(url);
        const el = audioRef.current;
        if (el && el.src !== url) {
          el.src = url;
          el.load();
        }
        return url;
      } catch (error) {
        console.warn("Track audio is temporarily unavailable", error);
        return null;
      } finally {
        urlRequestRef.current = null;
        setLoadingUrl(false);
      }
    })();
    urlRequestRef.current = request;
    return request;
  }

  // Switching sample → full (after unlock) must drop the cached sample URL.
  const modeRef = useRef(mode);
  if (modeRef.current !== mode) {
    modeRef.current = mode;
    if (signedUrl) setSignedUrl(null);
  }

  // Cap preview playback.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.currentTime);
      if (el.currentTime >= sampleSeconds) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
        if (playlistTitleRef.current) playlist?.handleEnded(songId);
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [sampleSeconds, playlist, songId]);

  // If the stream dies mid-queue (expired link, network blip), fetch a fresh
  // link once and carry on instead of stalling the playlist.
  const retriedRef = useRef(false);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onError = () => {
      if (retriedRef.current || !el.getAttribute("src")) return;
      retriedRef.current = true;
      const at = el.currentTime;
      ensureUrl(true)
        .then((url) => {
          if (!url) return;
          el.src = url;
          el.currentTime = at;
          return el.play();
        })
        .catch(() => setPlaying(false));
    };
    const onPlaying = () => {
      retriedRef.current = false;
    };
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    return () => {
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, mode]);

  // Keep the button in sync when something else pauses us (only one track
  // may play at a time app-wide) or when the user uses OS media controls.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPause = () => setPlaying(false);
    const onPlayEvt = () => {
      setPlaying(true);
      if (playlistTitle) playlist?.markCurrent(songId);
    };
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlayEvt);
    return () => {
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlayEvt);
    };
  }, [playlist, playlistTitle, songId]);

  const playRef = useRef<() => Promise<void>>(async () => {});
  const pauseRef = useRef<() => void>(() => {});

  async function start() {
    const url = await ensureUrl();
    if (!url) return;
    const el = audioRef.current;
    if (!el) return;
    if (el.src !== url) el.src = url;
    await el.play();
    setPlaying(true);
  }
  playRef.current = start;
  pauseRef.current = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  // Register with the surrounding playlist so the media bar can drive us.
  useEffect(() => {
    if (!playlist || !playlistTitle) return;
    return playlist.register(songId, {
      title: playlistTitle,
      play: () => playRef.current(),
      pause: () => pauseRef.current(),
      el: () => audioRef.current,
    });
  }, [playlist, songId, playlistTitle]);

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      if (playlistTitle && playlist) {
        playlist.playId(songId);
      } else {
        const url = await ensureUrl();
        if (!url) return;
        if (el.src !== url) el.src = url;
        await el.play();
        setPlaying(true);
      }
    }
  }

  async function download(filename: string) {
    const url = await ensureUrl();
    if (!url) return;
    const blob = await downloadFile(url, filename);
    await shareTrack({ title: filename.replace(/\.mp3$/i, ""), blob, filename, songId });
  }

  function handleEnded() {
    setPlaying(false);
    if (playlistTitle) playlist?.handleEnded(songId);
  }

  return {
    audioRef,
    playing,
    loadingUrl,
    progress,
    togglePlay,
    download,
    handleEnded,
  };
}
