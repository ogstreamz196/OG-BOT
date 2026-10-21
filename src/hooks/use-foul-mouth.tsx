import { useSharedChannel } from "@/lib/shared-realtime";
import { userPrefsChannel, type UserPrefsPayload } from "./user-prefs-realtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

/**
 * Single source of truth for the per-user "foul mouth" preference.
 * Reads and writes the `user_preferences.foul_mouth` row for the signed-in user.
 * Defaults to ON site-wide — users can opt out.
 * Realtime subscribed so widget ↔ messenger toggle stays in sync across surfaces & devices.
 */
export function foulMouthQueryKey(userId: string | null | undefined) {
  return ["user-preferences", "foul_mouth", userId ?? "anon"] as const;
}

export function useFoulMouth() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: foulMouthQueryKey(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("foul_mouth")
        .eq("user_id", uid!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.foul_mouth ?? true) as boolean;
    },
  });

  useSharedChannel<UserPrefsPayload>(
    userPrefsChannel.key(uid),
    userPrefsChannel.bind(uid),
    (payload) => {
      const row = (payload.new ?? payload.old) as { foul_mouth?: boolean } | null;
      if (row && typeof row.foul_mouth === "boolean") {
        qc.setQueryData(foulMouthQueryKey(uid), row.foul_mouth);
      }
    },
  );

  return {
    foulMouth: query.data ?? true,
    isLoading: query.isLoading,
    isReady: !!uid && query.isFetched,
  };
}

export function useSetFoulMouth() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (next: boolean) => {
      if (!uid) throw new Error("Sign in required");
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: uid, foul_mouth: next }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      return next;
    },
    onMutate: async (next) => {
      const key = foulMouthQueryKey(uid);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<boolean>(key);
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) qc.setQueryData(foulMouthQueryKey(uid), ctx.prev);
    },
    onSuccess: (next) => {
      toast.success(next ? "🤬 Foul Mouth: ON" : "🧼 Foul Mouth: OFF", {
        id: "foul-mouth-toggle",
        description: next
          ? "OG Bot is off the leash. Saved to your profile."
          : "Clean mode locked in. Saved to your profile.",
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: foulMouthQueryKey(uid) });
    },
  });
}

/** 0 (clean) – 3 (savage) swearing intensity. */
export function foulIntensityQueryKey(userId: string | null | undefined) {
  return ["user-preferences", "foul_intensity", userId ?? "anon"] as const;
}

export function useFoulIntensity() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const query = useQuery({
    queryKey: foulIntensityQueryKey(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("foul_intensity")
        .eq("user_id", uid!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const v = (data as { foul_intensity?: number } | null)?.foul_intensity;
      return typeof v === "number" ? Math.max(0, Math.min(3, Math.round(v))) : 3;
    },
  });

  return { intensity: query.data ?? 3, isLoading: query.isLoading };
}

export function useSetFoulIntensity() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (next: number) => {
      if (!uid) throw new Error("Sign in required");
      const value = Math.max(0, Math.min(3, Math.round(next)));
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: uid, foul_intensity: value } as never, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      return value;
    },
    onMutate: async (next) => {
      const key = foulIntensityQueryKey(uid);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<number>(key);
      qc.setQueryData(key, Math.max(0, Math.min(3, Math.round(next))));
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) qc.setQueryData(foulIntensityQueryKey(uid), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: foulIntensityQueryKey(uid) });
    },
  });
}
