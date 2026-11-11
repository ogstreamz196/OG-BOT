// Who gets OG B0T's foul mouth, the same on the website and Telegram: VIPs
// and staff, anyone on a VIP trial, and every signed-in member while the
// Boss's free-access promo is on. It's on by default for them; their own
// switch (user_preferences.foul_mouth) turns it off.
import { cached } from "./server-cache";

type Row = { key: string; value: unknown };

/** Whether the free-access promo is on (and not past its optional end). */
export function freeAccessOn(rows: Row[], now = Date.now()): boolean {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const raw = map.get("free_access_all");
  const exp = map.get("free_access_expires_at");
  const expired = typeof exp === "string" && exp ? new Date(exp).getTime() <= now : false;
  return (raw === true || raw === "true") && !expired;
}

export type FoulAccess = {
  /** May use the foul mouth at all. */
  allowed: boolean;
  /** Allowed and switched on (the default). */
  on: boolean;
};

export async function foulAccess(admin: any, userId: string, roles: string[]): Promise<FoulAccess> {
  const [settings, profile, pref] = await Promise.all([
    cached("free-access-flags", 30_000, async () => {
      const { data } = await admin
        .from("app_settings")
        .select("key, value")
        .in("key", ["free_access_all", "free_access_expires_at"]);
      return (data ?? []) as Row[];
    }),
    admin.from("profiles").select("vip_trial_ends_at").eq("id", userId).maybeSingle(),
    admin.from("user_preferences").select("foul_mouth").eq("user_id", userId).maybeSingle(),
  ]);
  const trialEnds = (profile.data as { vip_trial_ends_at?: string | null } | null)
    ?.vip_trial_ends_at;
  const onTrial = !!trialEnds && new Date(trialEnds).getTime() > Date.now();
  const allowed =
    ["vip", "admin", "boss", "dev"].some((r) => roles.includes(r)) ||
    onTrial ||
    freeAccessOn(settings);
  const choice = (pref.data as { foul_mouth?: boolean } | null)?.foul_mouth;
  return { allowed, on: allowed && (choice ?? true) };
}

/** Flips the member's own foul-mouth switch. */
export async function setFoulMouth(admin: any, userId: string, on: boolean): Promise<void> {
  const { error } = await admin
    .from("user_preferences")
    .upsert({ user_id: userId, foul_mouth: on }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
