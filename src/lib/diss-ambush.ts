/** Diss Ambush — OG Bot offers a diss track about the user mid-chat. Plain, browser-safe data. */
export const DISS_TRACK_COST = 5;
export const DISS_TRACK_PRICE_GBP = "99p";
export const DISS_MARKER = "[[DISS_AMBUSH]]";
export const DISS_STYLES = ["UK Drill", "Grime", "Trap", "Boom-Bap"] as const;

/** Minimum user messages before the first ambush, and gap between ambushes. */
export const AMBUSH_MIN_USER_MSGS = 5;
export const AMBUSH_COOLDOWN_MSGS = 8;

type Msg = { role: "user" | "assistant"; content: string };

/** Decide whether this reply should carry an ambush. `roll` is 0–1 random. */
export function shouldAmbush(history: Msg[], roll: number, chance = 0.35): boolean {
  const userCount = history.filter((m) => m.role === "user").length;
  if (userCount < AMBUSH_MIN_USER_MSGS) return false;
  const recent = history.slice(-AMBUSH_COOLDOWN_MSGS * 2);
  if (recent.some((m) => m.role === "assistant" && m.content.includes(DISS_MARKER))) return false;
  return roll < chance;
}

export function stripMarker(text: string): string {
  return text.split(DISS_MARKER).join("").trim();
}

/** Pull the user's own lines as ammo for the lyrics (most recent last). */
export function collectAmmo(history: Msg[], max = 900): string {
  const lines = history
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter((t) => t && !t.startsWith("📎"));
  let out = lines.join(" | ");
  if (out.length > max) out = out.slice(out.length - max);
  return out;
}
