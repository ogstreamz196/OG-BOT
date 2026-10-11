import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Pause, Play, Loader2, Music2 } from "lucide-react";
import { listPublicCommunityTracks } from "@/lib/public-track.functions";

/** Full community playlist, playable before sign-in. One track at a time. */
export function CommunityShowcase() {
  const listFn = useServerFn(listPublicCommunityTracks);
  const { data, isLoading } = useQuery({
    queryKey: ["public-community-tracks"],
    queryFn: () => listFn(),
    staleTime: 30 * 60_000,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  function toggle(id: string, url: string) {
    const a = audioRef.current ?? new Audio();
    audioRef.current = a;
    if (playing === id) {
      a.pause();
      setPlaying(null);
      return;
    }
    window.dispatchEvent(new Event("og:background-music-pause"));
    a.src = url;
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
  }

  return (
    <section id="studio" className="relative mx-auto max-w-5xl scroll-mt-24 px-3 py-10 sm:px-8">
      <p className="text-center text-xs font-black uppercase tracking-[0.25em] text-primary">
        Community playlist
      </p>
      <h2 className="font-display mt-2 text-center text-3xl font-black tracking-tight sm:text-5xl">
        Hear what people made
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted-foreground">
        Real tracks from the OG community. Tap play — no account needed.
      </p>
      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.length ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">New tracks dropping soon.</p>
      ) : (
        <ul className="mt-6 grid max-h-[28rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {data.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => toggle(t.id, t.audioUrl)}
                className={`flex w-full items-center gap-3 rounded-xl border bg-card/70 p-2 text-left backdrop-blur transition hover:border-primary/60 ${
                  playing === t.id ? "border-primary" : "border-border/60"
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
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/15">
                    <Music2 className="h-5 w-5 text-primary" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{t.title}</span>
                  {t.style && (
                    <span className="block truncate text-xs text-muted-foreground">{t.style}</span>
                  )}
                </span>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  {playing === t.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
