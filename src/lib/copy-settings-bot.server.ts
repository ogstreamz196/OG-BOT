// The Boss's copier settings inside the Copy Trader B0T on Telegram (the
// Boss, 2026-11-11: "add the settings for boss inside copy bot on telegram so
// all values can be adjusted directly thru the copy bot"). Text commands in
// the copy bot's private chat, Boss only (a Telegram chat linked to an account
// with the admin or boss role); anyone else gets the copy bot's usual reply.
// They edit site_content "copy.settings", which every Python copier reads on
// each check (copySettings in copy-feed.ts), and each change is audit-logged.
import { copySettings, type CopySettings } from "./copy-feed";

type Admin = any;

export const SETTINGS_KEY = "copy.settings";

const MARKET_NAMES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  XAUUSD: "XAUUSD",
  BTC: "BTCUSD",
  BITCOIN: "BTCUSD",
  BTCUSD: "BTCUSD",
};

const COMMANDS = [
  "settings",
  "copysettings",
  "pause",
  "resume",
  "lot",
  "markets",
  "maxopen",
  "late",
  "brokerstop",
] as const;

/** The command word of a settings command ("/lot 0.05" → "lot"), or null. Pure. */
export function settingsCommand(text: string): string | null {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  const cmd = m?.[1]?.toLowerCase() ?? "";
  return (COMMANDS as readonly string[]).includes(cmd) ? cmd : null;
}

/** The settings as the Boss reads them, with every command. Pure. */
export function settingsText(s: CopySettings): string {
  const lot = s.lot === undefined || s.lot === "bot" ? "bot (same as the copy bot)" : `${s.lot}`;
  const markets = s.markets ? (s.markets.length ? s.markets.join(", ") : "none") : "XAUUSD, BTCUSD";
  return [
    "⚙️ COPIER SETTINGS (every copier follows these)",
    `${s.paused ? "⏸ Paused: no new trades" : "▶️ Running"}`,
    `📏 Lot: ${lot}`,
    `📈 Markets: ${markets}`,
    `🔢 Max open: ${s.maxOpen ?? 6}`,
    `⏱ Max late: ${s.maxLateMinutes ?? 10} min`,
    `🛑 Broker stop: ${s.useBrokerStop ? "on" : "off"}`,
    "",
    "Change them:",
    "/pause · /resume",
    "/lot bot · /lot 0.05",
    "/markets gold btc · /markets gold",
    "/maxopen 6",
    "/late 10",
    "/brokerstop on · /brokerstop off",
  ].join("\n");
}

/**
 * Applies one command to the settings. Returns the new settings and a short
 * reply, or an error reply with no change. Pure.
 */
export function applyCommand(
  current: CopySettings,
  text: string,
): { next: CopySettings | null; reply: string } {
  const cmd = settingsCommand(text);
  const arg = text.trim().split(/\s+/).slice(1).join(" ").trim();
  const words = arg.split(/[\s,]+/).filter(Boolean);
  const done = (patch: CopySettings, reply: string) => {
    const next = copySettings(JSON.stringify({ ...current, ...patch }));
    return { next, reply: `✅ ${reply}` };
  };
  const bad = (reply: string) => ({ next: null, reply: `⚠️ ${reply}` });
  switch (cmd) {
    case "pause":
      return done({ paused: true }, "Paused: no new trades. Open ones are still managed.");
    case "resume":
      return done({ paused: false }, "Running: copying new trades again.");
    case "lot": {
      if (/^bot$/i.test(arg)) return done({ lot: "bot" }, "Lot: same as the copy bot.");
      const n = Number(arg);
      if (!(n >= 0.01 && n <= 5))
        return bad("Use /lot bot or a lot from 0.01 to 5, e.g. /lot 0.05");
      return done(
        { lot: Math.round(n * 100) / 100 },
        `Lot: ${Math.round(n * 100) / 100} on every trade.`,
      );
    }
    case "markets": {
      const all = /^all$/i.test(arg);
      const mapped = words.map((w) => MARKET_NAMES[w.toUpperCase()]);
      if (!all && (!words.length || mapped.some((m) => !m)))
        return bad("Use /markets gold btc, /markets gold, /markets btc or /markets all");
      const picked = all ? ["XAUUSD", "BTCUSD"] : [...new Set(mapped as string[])];
      return done({ markets: picked }, `Markets: ${picked.join(", ")}.`);
    }
    case "maxopen": {
      const n = Number(arg);
      if (!(Number.isInteger(n) && n >= 0 && n <= 50))
        return bad("Use /maxopen with 0 to 50, e.g. /maxopen 6");
      return done({ maxOpen: n }, `Max open trades: ${n}.`);
    }
    case "late": {
      const n = Number(arg);
      if (!(Number.isInteger(n) && n >= 1 && n <= 120))
        return bad("Use /late with 1 to 120 minutes, e.g. /late 10");
      return done({ maxLateMinutes: n }, `Won't jump in more than ${n} min after a fill.`);
    }
    case "brokerstop": {
      if (!/^(on|off)$/i.test(arg)) return bad("Use /brokerstop on or /brokerstop off");
      const on = /^on$/i.test(arg);
      return done(
        { useBrokerStop: on },
        on
          ? "Broker stop on: the bot's stop also sits on the broker as a safety net."
          : "Broker stop off: the copier closes at market (house rule).",
      );
    }
    default:
      return { next: null, reply: "" };
  }
}

/** Whether this private Telegram chat is the Boss's (linked account with admin or boss). */
export async function isBossChat(
  admin: Admin,
  chatId: number,
): Promise<{ ok: boolean; userId?: string }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!profile?.id) return { ok: false };
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", profile.id);
  const ok = ((roles ?? []) as { role: string }[]).some(
    (r) => r.role === "admin" || r.role === "boss",
  );
  return { ok, userId: profile.id };
}

/**
 * The copy bot's answer to a settings command from a private chat, or null
 * when it isn't one (or isn't the Boss), so the usual reply goes instead.
 */
export async function copySettingsReply(
  admin: Admin,
  chatId: number,
  text: string,
): Promise<string | null> {
  const cmd = settingsCommand(text);
  if (!cmd) return null;
  const boss = await isBossChat(admin, chatId).catch(
    () => ({ ok: false }) as { ok: boolean; userId?: string },
  );
  if (!boss.ok) return null;
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const current = copySettings((data as { value?: string } | null)?.value);
  if (cmd === "settings" || cmd === "copysettings") return settingsText(current);
  const { next, reply } = applyCommand(current, text);
  if (!next) return reply;
  const at = new Date().toISOString();
  const { error } = await admin
    .from("site_content")
    .upsert(
      { key: SETTINGS_KEY, value: JSON.stringify(next), updated_at: at },
      { onConflict: "key" },
    );
  if (error) return "⚠️ Couldn't save that. Try again in a minute.";
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: boss.userId,
      action: "copy_settings",
      category: "signals",
      target_key: cmd,
      metadata: { text: text.slice(0, 100), settings: next },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return `${reply}\n\n${settingsText(next)}`;
}
