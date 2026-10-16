import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadFile, safeFileName } from "@/lib/download-file";
import { shareTrack } from "@/lib/share-track";
import { claimAudio } from "@/lib/audio-focus";

/** Wherever the user is, auto-plays a freshly finished track and offers download/share. */
export function TrackReadyListener({ userId }: { userId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const ch = supabase
      .channel(`track-ready-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "songs", filter: `user_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as {
            id: string;
            status: string;
            audio_path: string | null;
            title: string | null;
            is_variation?: boolean;
          };
          const old = payload.old as { status?: string };
          if (row.status !== "completed" || !row.audio_path || old.status === "completed") return;
          if (seen.current.has(row.id) || row.is_variation) return;
          seen.current.add(row.id);
          const title = row.title || "Your track";
          // The library opens its own finished-track player; don't start a
          // second copy of the same track on top of it.
          if (window.location.pathname.startsWith("/library")) return;
          let url: string | null = null;
          for (const mode of ["full", "preview"]) {
            const { data } = await supabase.functions.invoke("song-url", {
              body: { song_id: row.id, mode },
            });
            if (data?.url) {
              url = data.url as string;
              break;
            }
          }
          if (!url) return;
          const el = audioRef.current ?? new Audio();
          audioRef.current = el;
          el.src = url;
          let played = true;
          claimAudio(el);
          try {
            await el.play();
          } catch {
            played = false;
          }
          const fname = safeFileName(`${title}.mp3`);
          toast.success(`🔥 “${title}” is ready${played ? " — playing now" : ""}`, {
            duration: 30_000,
            description: (
              <div className="mt-2 flex flex-wrap gap-2">
                {!played && (
                  <button
                    className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
                    onClick={() => {
                      claimAudio(el);
                      void el.play();
                    }}
                  >
                    ▶ Play
                  </button>
                )}
                <button
                  className="rounded-md bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground"
                  onClick={() => el.pause()}
                >
                  ⏸ Pause
                </button>
                <button
                  className="rounded-md bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground"
                  onClick={() => void downloadFile(url!, fname)}
                >
                  ⬇ Download
                </button>
                <button
                  className="rounded-md bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground"
                  onClick={() => void shareTrack({ title, filename: fname, songId: row.id })}
                >
                  ↗ Share
                </button>
              </div>
            ),
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
      el_pause();
    };
    function el_pause() {
      audioRef.current?.pause();
    }
  }, [userId]);
  return null;
}
