import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const Ctx = createContext<AuthCtx>({ session: null, user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Keep the same session object when nothing changed (Supabase re-sends
    // it each time the tab is shown), so effects keyed on it don't rerun.
    const keep = (s: Session | null) =>
      setSession((prev) =>
        prev?.access_token === s?.access_token && prev?.user.updated_at === s?.user.updated_at
          ? prev
          : s,
      );
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => keep(s));
    supabase.auth.getSession().then(({ data }) => {
      keep(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The user object only changes when the account or its details do, not on
  // each hourly token refresh, so `[user]` effects (realtime channels) stay put.
  const userId = session?.user.id;
  const userUpdatedAt = session?.user.updated_at;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => session?.user ?? null, [userId, userUpdatedAt]);
  const value = useMemo(() => ({ session, user, loading }), [session, user, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
