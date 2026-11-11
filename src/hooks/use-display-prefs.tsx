import { useEffect } from "react";
import { useSharedChannel } from "@/lib/shared-realtime";
import { userPrefsChannel, type UserPrefsPayload } from "./user-prefs-realtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

/**
 * Per-user display preferences stored in `user_preferences`.
 * `text_scale` ∈ [0.85, 1.50]  ·  `density` ∈ comfortable | compact | spacious.
 * Applied globally to <html> as `--text-scale` and `data-density`.
 */

export type Density = "comfortable" | "compact" | "spacious";

export interface DisplayPrefs {
  textScale: number;
  density: Density;
}

const DEFAULTS: DisplayPrefs = { textScale: 1, density: "comfortable" };
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.5;

export function clampScale(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n * 100) / 100));
}

export function displayPrefsKey(uid: string | null | undefined) {
  return ["user-preferences", "display", uid ?? "anon"] as const;
}

function applyToDocument(p: DisplayPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--text-scale", String(p.textScale));
  root.dataset.density = p.density;
}

export function useDisplayPrefs() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: displayPrefsKey(uid),
    enabled: !!uid,
    queryFn: async (): Promise<DisplayPrefs> => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("text_scale, density")
        .eq("user_id", uid!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        textScale: clampScale(Number(data?.text_scale ?? 1)),
        density: (data?.density as Density) ?? "comfortable",
      };
    },
  });

  // Apply to <html> whenever the value changes (signed-in only).
  useEffect(() => {
    if (query.data) applyToDocument(query.data);
    else applyToDocument(DEFAULTS);
  }, [query.data]);

  // Realtime sync across tabs / devices (one channel shared with the other
  // user_preferences hooks).
  useSharedChannel<UserPrefsPayload>(
    userPrefsChannel.key(uid),
    userPrefsChannel.bind(uid),
    (payload) => {
      const row = (payload.new ?? payload.old) as { text_scale?: number; density?: Density } | null;
      if (!row) return;
      qc.setQueryData<DisplayPrefs>(displayPrefsKey(uid), {
        textScale: clampScale(Number(row.text_scale ?? 1)),
        density: (row.density as Density) ?? "comfortable",
      });
    },
  );

  return {
    textScale: query.data?.textScale ?? DEFAULTS.textScale,
    density: query.data?.density ?? DEFAULTS.density,
    isLoading: query.isLoading,
    isReady: !!uid && query.isFetched,
  };
}

export function useSetDisplayPrefs() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (next: Partial<DisplayPrefs>) => {
      if (!uid) throw new Error("Sign in required");
      const payload: { user_id: string; text_scale?: number; density?: Density } = {
        user_id: uid,
      };
      if (typeof next.textScale === "number") payload.text_scale = clampScale(next.textScale);
      if (next.density) payload.density = next.density;
      const { error } = await supabase
        .from("user_preferences")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      return next;
    },
    onMutate: async (next) => {
      const key = displayPrefsKey(uid);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DisplayPrefs>(key) ?? DEFAULTS;
      const merged: DisplayPrefs = {
        textScale: typeof next.textScale === "number" ? clampScale(next.textScale) : prev.textScale,
        density: next.density ?? prev.density,
      };
      qc.setQueryData(key, merged);
      applyToDocument(merged);
      return { prev };
    },
    onError: (_e, _n, ctx) => {
      if (ctx) {
        qc.setQueryData(displayPrefsKey(uid), ctx.prev);
        applyToDocument(ctx.prev);
      }
    },
    onSuccess: () => {
      toast.success("Settings saved", { id: "settings-saved" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: displayPrefsKey(uid) });
    },
  });
}

/** Mount once at app root to apply prefs everywhere a signed-in user is. */
export function DisplayPrefsBridge() {
  useDisplayPrefs();
  return null;
}
