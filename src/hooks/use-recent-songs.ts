import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RecentSong {
  id: string;
  title: string | null;
  prompt: string;
  status: string;
  cover_url: string | null;
  created_at: string;
  generation_started_at: string | null;
  beat_path: string | null;
  vocals_only: boolean;
}

export function useRecentSongs(userId: string | undefined, limit = 6) {
  const queryClient = useQueryClient();
  const queryKey = ["recent-songs-home", userId, limit] as const;

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async (): Promise<RecentSong[]> => {
      const { data, error } = await supabase
        .from("songs")
        .select(
          "id, title, prompt, status, cover_url, created_at, generation_started_at, beat_path, vocals_only",
        )
        // Hidden alt-takes stay out of view until the user pays to remake.
        .or("is_variation.is.null,is_variation.eq.false,revealed.eq.true")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RecentSong[];
    },
  });

  // Realtime: refresh the moment a song row changes for this user (e.g. status
  // flips to "completed"). Falls back to the standard query refetch path.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`recent-songs-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "songs", filter: `user_id=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, limit]);

  return query;
}
