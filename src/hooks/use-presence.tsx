import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

const PRESENCE_CHANNEL = "ogstreamz:presence";

export type OnlineUser = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  online_at: string;
  last_page: string | null;
};

/**
 * Mount once inside the authenticated shell. Each tab joins a shared
 * presence channel and re-tracks itself when the route changes so devs
 * see the current page live.
 */
export function PresenceTracker() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: user.id } },
    });

    const payload = () => ({
      user_id: user.id,
      email: user.email ?? null,
      display_name: (user.user_metadata?.display_name as string | undefined) ?? null,
      online_at: new Date().toISOString(),
      last_page: null,
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      await channel.track(payload());
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);
  return null;
}

export function useOnlineUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState<OnlineUser[]>([]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: user.id } },
    });
    const sync = () => {
      const state = channel.presenceState<OnlineUser>();
      const flat: OnlineUser[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas && metas[0]) flat.push(metas[0]);
      }
      flat.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
      setUsers(flat);
    };
    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);
  return users;
}
