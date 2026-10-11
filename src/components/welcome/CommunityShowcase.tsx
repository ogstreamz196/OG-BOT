import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Loader2, Music2, SkipForward } from "lucide-react";
import { listPublicCommunityTracks } from "@/lib/public-track.functions";

const PAGE = 8;

/**
 * Community playlist, playable before sign-in. Player on the left, list on the
 * right. The list grows the page (no inner scroll box) so page scrolling never
 * gets trapped inside the tracks.
 */
export function CommunityShowcase() {
  const listFn = useServerFn(listPublicCommunityTracks);
  const { data, isLoading } = useQuery({
    queryKey: ["public-community-tracks"],
    queryFn: () => listFn(),
    staleTime: 30 * 60_000,
  });
  const tracks = data ?? [];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [brokenCovers, setBrokenCovers] = useState<Record<string, boolean>>({});

  const current = tracks.find((t) => t.id === currentId) ?? tracks[0];

  useEffect(() => () => audioRef.current?.pause(), []);

  function play(id: string) {
    const t = tracks.find((x) => x.id === id);
    if (!t) return;
    const a = audioRef.current ?? new Audio();
    audioRef.current = a;
    if (currentId === id && playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    window.dispatchEvent(new Event("og:background-music-pause"));
    if (currentId !== id || !a.src) a.src = t.audioUrl;
    setCurrentId(id);
    a.onended = () => {
      const i = tracks.findIndex((x) => x.id === id);
      const nxt = tracks[i + 1];
      if (nxt) play(nxt.id);
      else setPlaying(false);
    };
    void a
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  function skip() {
    if (!current) return;
    const i = tracks.findIndex((x) => x.id === current.id);
    const nxt = tracks[(i + 1) % tracks.length];
    if (nxt) {
      if (audioRef.current) audioRef.current.pause();
      setPlaying(false);
      setCurrentId(null);
      setTimeout(() => play(nxt.id), 0);
    }
  }

  const isOn = (id: string) => current?.id === id && playing;

  return (
    <section id="studio" className="relative mx-auto max-w-6xl scroll-mt-24 px-3 py-10 sm:px-8">
      <p className="text-center text-xs font-black uppercase tracking-[0.25em] text-primary">
        Community playlist
      </p>
      <h2 className="font-display mt-2 text-center text-3xl font-black tracking-tight text-foreground sm:text-5xl">
        Hear what people made
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm font-medium text-foreground/85">
        Real tracks from the OG community. Tap play — no account needed.
      </p>

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-foreground" />
        </div>
      ) : !current ? (
        <p className="mt-8 text-center text-sm text-foreground/85">New tracks dropping soon.</p>
      ) : (
        <div className="mt-6 grid gap-4 rounded-3xl border-2 border-border bg-card p-3 shadow-card md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Player */}
          <div className="md:sticky md:top-24 md:self-start">
            <div className="overflow-hidden rounded-3xl border-2 border-border bg-card shadow-card">
              <div className="aspect-video w-full bg-secondary">
                {current.coverUrl && !brokenCovers[current.id] ? (
                  <img
                    src={current.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() =>
                      setBrokenCovers((m) => ({ ...m, [current.id]: true }))
                    }
                  />
                ) : (
                  <div className="grid h-full place-items-center">
                    <Music2 className="h-14 w-14 text-primary" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                  {playing ? "Now playing" : "Up next"}
                </p>
                <p className="mt-1 truncate font-display text-xl font-black text-card-foreground">
                  {current.title}
                </p>
                {current.style && (
                  <p className="truncate text-sm text-card-foreground/80">{current.style}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => play(current.id)}
                    className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary font-black uppercase text-primary-foreground shadow-glow"
                  >
                    {isOn(current.id) ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    {isOn(current.id) ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={skip}
                    aria-label="Next track"
                    className="grid h-12 w-12 place-items-center rounded-xl border-2 border-border bg-secondary text-secondary-foreground"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* List */}
          <div className="min-w-0">
            <ul className="grid gap-2">
              {tracks.slice(0, shown).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => play(t.id)}
                    className={`flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-xl border-2 bg-card p-2 text-left shadow-card transition hover:border-primary ${
                      current.id === t.id ? "border-primary" : "border-border"
                    }`}
                  >
                    {t.coverUrl ? (
                      <img
                        src={t.coverUrl}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/20">
                        <Music2 className="h-5 w-5 text-primary" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-card-foreground">
                        {t.title}
                      </span>
                      {t.style && (
                        <span className="block truncate text-xs text-card-foreground/75">
                          {t.style}
                        </span>
                      )}
                    </span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      {isOn(t.id) ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {shown < tracks.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="mt-3 h-12 w-full rounded-xl border-2 border-border bg-secondary font-bold text-secondary-foreground"
              >
                Show more tracks ({tracks.length - shown} left)
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
