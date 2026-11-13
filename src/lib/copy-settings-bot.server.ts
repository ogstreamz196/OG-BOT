// The Boss's copier settings inside the Copy Trader B0T on Telegram (the
// Boss, 2026-11-11: "add the settings for boss inside copy bot … make it so I
// can press buttons and also make the options make sense"). A settings card
// with tap buttons (inline keyboard) that edits itself in place, in the copy
// bot's private chat, Boss only (a Telegram chat linked to an account with the
// admin or boss role); anyone else gets the copy bot's usual reply. It edits
// site_content "copy.settings", which every Python copier reads on each check
// (copySettings in copy-feed.ts); each change is audit-logged. Typed commands
// (/lot 0.1, /maxopen 6 …) still work for values the buttons don't offer.
import {
  copySettings,
  MULTIPLIERS,
  multLabel,
  LOT_BAND_ORDER,
  lotBandLabel,
  type CopySettings,
  type LotBand,
} from "./copy-feed";
import { STRATEGY_KEYS, type EngineConfig, type StrategyToggles } from "./engine-config";

type Admin = any;

/** Short labels for the strategy switches shown in the copier card. */
const STRATEGY_LABEL: Record<keyof StrategyToggles, string> = {
  sniper: "🎯 Sniper entries",
  hedges: "⚖️ Counter-trend hedges",
  rangeHedge: "🔁 Range hedging",
  patternsAlongside: "➕ Patterns alongside",
};

export const SETTINGS_KEY = "copy.settings";

/** Defaults a copier uses when a setting isn't set (config.example.ini). */
const DEFAULTS = { maxOpen: 6, maxLateMinutes: 10 };
const ALL_MARKETS = ["XAUUSD", "BTCUSD"];
const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };
const MARKET_NAMES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  XAUUSD: "XAUUSD",
  BTC: "BTCUSD",
  BITCOIN: "BTCUSD",
  BTCUSD: "BTCUSD",
};
export const LOT_CHOICES = [0.01, 0.02, 0.05, 0.1];
export const OPEN_BUTTON = "⚙️ Copier settings";

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

/* ── reading the settings ──────────────────────────────────────────────── */

const marketsOf = (s: CopySettings) => s.markets ?? ALL_MARKETS;
const maxOpenOf = (s: CopySettings) => s.maxOpen ?? DEFAULTS.maxOpen;
const lateOf = (s: CopySettings) => s.maxLateMinutes ?? DEFAULTS.maxLateMinutes;
const lotIsBot = (s: CopySettings) => s.lot === undefined || s.lot === "bot";
/** Off (all switches off) unless the engine config says otherwise. */
const noStrategies: StrategyToggles = {
  sniper: false,
  hedges: false,
  rangeHedge: false,
  patternsAlongside: false,
};

/** The settings card's text: what each setting means, in plain words. Pure. */
export function panelText(
  s: CopySettings,
  strategies: StrategyToggles = noStrategies,
  note?: string,
): string {
  const markets = marketsOf(s);
  // A fixed lot still shows (set by the /lot command); the bands are the buttons.
  const lot =
    typeof s.lot === "number"
      ? `${s.lot} on every trade`
      : s.lotBand
        ? `${lotBandLabel(s.lotBand)} (bigger when the signal's surer)`
        : // No range picked yet: say what really happens instead of ticking one.
          `the bot's own lot${
            Number(s.multiplier) > 0 && Number(s.multiplier) !== 1 ? ` × ${s.multiplier}` : ""
          }. Tap a range below to set yours.`;
  return [
    ...(note ? [note, ""] : []),
    "⚙️ COPIER SETTINGS",
    "Every copier using your token follows these within seconds.",
    "",
    s.paused
      ? "⏸ PAUSED: no new trades. Open trades are still managed and closed."
      : "▶️ COPYING: new trades are copied.",
    `📏 Lot size: ${lot}`,
    `📈 Markets: ${markets.length ? markets.map((m) => MARKET_LABEL[m] ?? m).join(" and ") : "none (nothing new is copied)"}`,
    `🔢 Max trades open at once: ${s.hft ? "no cap while high-frequency is on" : maxOpenOf(s)}`,
    `⏱ Joins a trade up to ${lateOf(s)} min after it opens`,
    s.useBrokerStop
      ? "🛑 Safety stop on the broker: ON (the bot's stop sits on the broker too, in case the laptop goes off)"
      : "🛑 Safety stop on the broker: OFF (the copier closes trades itself, so keep it running)",
    "",
    "🎛 STRATEGIES (several run at once)",
    s.hft
      ? "⚡ High-frequency: ON (more trades, no cap on open trades, entries 30s apart, more hedges; bitcoin at the top of your lot range, gold too from $400 and at the bottom of it under that)"
      : "⚡ High-frequency: OFF",
    ...STRATEGY_KEYS.map((k) => `${strategies[k] ? "✅ ON" : "⬜️ OFF"} — ${STRATEGY_LABEL[k]}`),
    "",
    "Tap a button to change it.",
  ].join("\n");
}

type Button = { text: string; callback_data: string };

/** The card's tap buttons; ✅ marks what's chosen. Pure. */
export function panelKeyboard(
  s: CopySettings,
  strategies: StrategyToggles = noStrategies,
): { inline_keyboard: Button[][] } {
  const tick = (on: boolean, label: string) => `${on ? "✅ " : ""}${label}`;
  const markets = marketsOf(s);
  return {
    inline_keyboard: [
      [
        s.paused
          ? { text: "▶️ Resume copying", callback_data: "cs:resume" }
          : { text: "⏸ Pause copying", callback_data: "cs:pause" },
      ],
      // Lot size: three clear bands (replaces "same as the bot" + the multiplier).
      LOT_BAND_ORDER.map((b) => ({
        text: tick(typeof s.lot !== "number" && s.lotBand === b, `📏 ${lotBandLabel(b)}`),
        callback_data: `cs:band:${b}`,
      })),
      [
        { text: tick(markets.includes("XAUUSD"), "🥇 Gold"), callback_data: "cs:mk:XAUUSD" },
        { text: tick(markets.includes("BTCUSD"), "₿ Bitcoin"), callback_data: "cs:mk:BTCUSD" },
      ],
      [
        { text: "➖", callback_data: "cs:open:-1" },
        { text: `🔢 ${maxOpenOf(s)} trades max`, callback_data: "cs:noop" },
        { text: "➕", callback_data: "cs:open:1" },
      ],
      [
        { text: "➖", callback_data: "cs:late:-5" },
        { text: `⏱ Join up to ${lateOf(s)} min late`, callback_data: "cs:noop" },
        { text: "➕", callback_data: "cs:late:5" },
      ],
      [
        {
          text: s.useBrokerStop
            ? "🛑 Safety stop: ON · tap to turn off"
            : "🛑 Safety stop: OFF · tap to turn on",
          callback_data: s.useBrokerStop ? "cs:stop:off" : "cs:stop:on",
        },
      ],
      // Strategies: high-frequency plus the signal strategy switches.
      [
        {
          text: s.hft
            ? "⚡ High-frequency: ON · tap to turn off"
            : "⚡ High-frequency: OFF · tap to turn on",
          callback_data: s.hft ? "cs:hft:off" : "cs:hft:on",
        },
      ],
      ...STRATEGY_KEYS.map((k) => [
        {
          text: `${STRATEGY_LABEL[k]}: ${strategies[k] ? "ON · tap off" : "OFF · tap on"}`,
          callback_data: `es:${k}:${strategies[k] ? "off" : "on"}`,
        },
      ]),
      [{ text: "🔄 Refresh", callback_data: "cs:refresh" }],
    ],
  };
}

/**
 * One button tap on the card: the new settings and the toast Telegram shows,
 * or next null when nothing changes (refresh, a label, an out-of-range step). Pure.
 */
export function applyPanelAction(
  current: CopySettings,
  data: string,
): { next: CopySettings | null; toast: string } {
  const [, kind, val] = data.split(":");
  const save = (patch: CopySettings, toast: string) => ({
    next: copySettings(JSON.stringify({ ...current, ...patch })),
    toast,
  });
  switch (kind) {
    case "pause":
      return save({ paused: true }, "⏸ Paused: no new trades");
    case "resume":
      return save({ paused: false }, "▶️ Copying new trades again");
    case "band": {
      if (!LOT_BAND_ORDER.includes(val as LotBand)) return { next: null, toast: "" };
      // Picking a band clears any fixed lot so the band is in charge.
      return save(
        { lotBand: val as LotBand, lot: undefined },
        `📏 Lot ${lotBandLabel(val as LotBand)}`,
      );
    }
    case "lot": {
      if (val === "bot") return save({ lot: "bot" }, "📏 Lot: same as the bot");
      const n = Number(val);
      if (!LOT_CHOICES.includes(n)) return { next: null, toast: "" };
      return save({ lot: n }, `📏 ${n} lot on every trade`);
    }
    case "mk": {
      if (!ALL_MARKETS.includes(val)) return { next: null, toast: "" };
      const now = marketsOf(current);
      const on = now.includes(val);
      if (on && now.length === 1)
        return { next: null, toast: "Keep at least one market (or tap Pause)" };
      const markets = on
        ? now.filter((m) => m !== val)
        : ALL_MARKETS.filter((m) => m === val || now.includes(m));
      return save({ markets }, `${MARKET_LABEL[val]} ${on ? "off" : "on"}`);
    }
    case "open": {
      const n = maxOpenOf(current) + Number(val);
      if (!(n >= 1 && n <= 20)) return { next: null, toast: "Between 1 and 20 trades" };
      return save({ maxOpen: n }, `🔢 Up to ${n} trades open`);
    }
    case "late": {
      const n = lateOf(current) + Number(val);
      if (!(n >= 5 && n <= 60)) return { next: null, toast: "Between 5 and 60 minutes" };
      return save({ maxLateMinutes: n }, `⏱ Joins up to ${n} min late`);
    }
    case "stop":
      return save(
        { useBrokerStop: val === "on" },
        val === "on" ? "🛑 Safety stop on the broker: ON" : "🛑 Safety stop on the broker: OFF",
      );
    case "mult": {
      const m = Number(val);
      if (!MULTIPLIERS.includes(m)) return { next: null, toast: "" };
      return save({ multiplier: m }, `🎯 Risk multiplier: ${multLabel(m)}`);
    }
    case "hft":
      return save(
        { hft: val === "on" },
        val === "on" ? "⚡ High-frequency: ON" : "⚡ High-frequency: OFF",
      );
    case "refresh":
      return { next: null, toast: "Up to date" };
    default:
      return { next: null, toast: "" };
  }
}

/* ── typed commands (for values the buttons don't offer) ───────────────── */

/** The Boss's reply-keyboard: the settings button beside the ⚡ signal button. */
export function bossKeyboard(generateText: string) {
  return {
    keyboard: [
      [{ text: OPEN_BUTTON }, { text: "✋ Manual trade" }],
      [{ text: "👥 Copier users" }],
      [{ text: generateText }],
    ],
    is_persistent: true,
    resize_keyboard: true,
    input_field_placeholder: "Tap ⚙️ for the copier settings",
  };
}

/** The settings button or /start as /settings, else the text as sent. Pure. */
export function asCommand(text: string): string {
  const t = text.trim();
  if (t === OPEN_BUTTON || /^⚙️?\s*settings$/i.test(t)) return "/settings";
  if (/^\/start(?:@\w+)?(?:\s|$)/i.test(t)) return "/settings";
  return t;
}

/** The command word of a settings command ("/lot 0.05" → "lot"), or null. Pure. */
export function settingsCommand(text: string): string | null {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  const cmd = m?.[1]?.toLowerCase() ?? "";
  return (COMMANDS as readonly string[]).includes(cmd) ? cmd : null;
}

/**
 * Applies one typed command. Returns the new settings and a short note, or
 * an error note with no change. Pure.
 */
export function applyCommand(
  current: CopySettings,
  text: string,
): { next: CopySettings | null; reply: string } {
  const cmd = settingsCommand(text);
  const arg = text.trim().split(/\s+/).slice(1).join(" ").trim();
  const words = arg.split(/[\s,]+/).filter(Boolean);
  const done = (patch: CopySettings, reply: string) => ({
    next: copySettings(JSON.stringify({ ...current, ...patch })),
    reply: `✅ ${reply}`,
  });
  const bad = (reply: string) => ({ next: null, reply: `⚠️ ${reply}` });
  switch (cmd) {
    case "pause":
      return done({ paused: true }, "Paused: no new trades. Open ones are still managed.");
    case "resume":
      return done({ paused: false }, "Copying new trades again.");
    case "lot": {
      if (/^bot$/i.test(arg)) return done({ lot: "bot" }, "Lot: same as the bot.");
      const n = Number(arg);
      if (!(n >= 0.01 && n <= 5)) return bad("Use /lot bot or a lot from 0.01 to 5, e.g. /lot 0.1");
      const lot = Math.round(n * 100) / 100;
      return done({ lot }, `Lot: ${lot} on every trade.`);
    }
    case "markets": {
      const all = /^all$/i.test(arg);
      const mapped = words.map((w) => MARKET_NAMES[w.toUpperCase()]);
      if (!all && (!words.length || mapped.some((m) => !m)))
        return bad("Use /markets gold btc, /markets gold, /markets btc or /markets all");
      const picked = all ? ALL_MARKETS : [...new Set(mapped as string[])];
      return done(
        { markets: picked },
        `Markets: ${picked.map((m) => MARKET_LABEL[m]).join(" and ")}.`,
      );
    }
    case "maxopen": {
      const n = Number(arg);
      if (!(Number.isInteger(n) && n >= 0 && n <= 50))
        return bad("Use /maxopen with 0 to 50, e.g. /maxopen 6");
      return done({ maxOpen: n }, `Up to ${n} trades open at once.`);
    }
    case "late": {
      const n = Number(arg);
      if (!(Number.isInteger(n) && n >= 1 && n <= 120))
        return bad("Use /late with 1 to 120 minutes, e.g. /late 10");
      return done({ maxLateMinutes: n }, `Joins a trade up to ${n} min after it opens.`);
    }
    case "brokerstop": {
      if (!/^(on|off)$/i.test(arg)) return bad("Use /brokerstop on or /brokerstop off");
      const on = /^on$/i.test(arg);
      return done({ useBrokerStop: on }, `Safety stop on the broker: ${on ? "ON" : "OFF"}.`);
    }
    default:
      return { next: null, reply: "" };
  }
}

/* ── the database side ─────────────────────────────────────────────────── */

/** Whether this private Telegram chat (or user id) is the Boss's (admin or boss role). */
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

async function loadSettings(admin: Admin): Promise<CopySettings> {
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  return copySettings((data as { value?: string } | null)?.value);
}

async function saveSettings(
  admin: Admin,
  userId: string | undefined,
  next: CopySettings,
  what: string,
): Promise<boolean> {
  const at = new Date().toISOString();
  const { error } = await admin
    .from("site_content")
    .upsert(
      { key: SETTINGS_KEY, value: JSON.stringify(next), updated_at: at },
      { onConflict: "key" },
    );
  if (error) return false;
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: userId,
      action: "copy_settings",
      category: "signals",
      target_key: what.slice(0, 60),
      metadata: { settings: next },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return true;
}

export type Panel = { text: string; reply_markup: { inline_keyboard: Button[][] } };

/** The engine strategy switches, shown in the copier card's Strategies section. */
async function loadStrategies(admin: Admin): Promise<StrategyToggles> {
  try {
    const { engineConfig } = await import("./engine-config.server");
    return (await engineConfig()).strategies;
  } catch {
    return noStrategies;
  }
}
const card = (s: CopySettings, strat: StrategyToggles, note?: string): Panel => ({
  text: panelText(s, strat, note),
  reply_markup: panelKeyboard(s, strat),
});

/** The copier settings and the strategy switches, for the website's Trading switches card. */
export async function copierState(
  admin: Admin,
): Promise<{ settings: CopySettings; strategies: StrategyToggles }> {
  return { settings: await loadSettings(admin), strategies: await loadStrategies(admin) };
}

/**
 * A switch flipped on the website (Signals › Controls): exactly the same
 * actions as the copier card's buttons ("cs:…" copier settings, "es:…"
 * strategies), through the same pure functions, so the two never disagree.
 * The caller checks the Boss. Returns the toast and the state now.
 */
export async function applyCopierAction(
  admin: Admin,
  userId: string,
  data: string,
): Promise<{ ok: boolean; toast: string; settings: CopySettings; strategies: StrategyToggles }> {
  if (data.startsWith("es:")) {
    const { engineConfig, saveEngineConfig } = await import("./engine-config.server");
    const { applyStrategyTap } = await import("./engine-strategies-bot.server");
    const cfg: EngineConfig = await engineConfig();
    const { next, toast } = applyStrategyTap(cfg, data);
    const settings = await loadSettings(admin);
    if (!next)
      return { ok: false, toast: toast || "No change", settings, strategies: cfg.strategies };
    const saved = await saveEngineConfig(admin, next, userId).catch(() => null);
    return {
      ok: !!saved,
      toast: saved ? toast : "Couldn't save that. Try again.",
      settings,
      strategies: (saved ?? cfg).strategies,
    };
  }
  const current = await loadSettings(admin);
  const strategies = await loadStrategies(admin);
  const { next, toast } = applyPanelAction(current, data);
  if (!next) return { ok: false, toast: toast || "No change", settings: current, strategies };
  if (!(await saveSettings(admin, userId, next, data)))
    return { ok: false, toast: "Couldn't save that. Try again.", settings: current, strategies };
  return { ok: true, toast, settings: next, strategies };
}

/**
 * The copy bot's answer to a settings message from a private chat (the
 * settings card, after applying a typed command), or null when it isn't one
 * or isn't the Boss, so the usual reply goes instead.
 */
export async function copySettingsReply(
  admin: Admin,
  chatId: number,
  sent: string,
): Promise<Panel | null> {
  const text = asCommand(sent);
  const cmd = settingsCommand(text);
  if (!cmd) return null;
  const boss = await isBossChat(admin, chatId).catch(
    () => ({ ok: false }) as { ok: boolean; userId?: string },
  );
  if (!boss.ok) return null;
  const current = await loadSettings(admin);
  const strat = await loadStrategies(admin);
  if (cmd === "settings" || cmd === "copysettings") return card(current, strat);
  const { next, reply } = applyCommand(current, text);
  if (!next) return card(current, strat, reply);
  const saved = await saveSettings(admin, boss.userId, next, cmd);
  const shown = saved ? next : current;
  return card(shown, strat, saved ? reply : "⚠️ Couldn't save that. Try again in a minute.");
}

/**
 * A tap on the settings card (callback data "cs:…"), Boss only: the toast to
 * show and the card to put in place of the old one (null when unchanged).
 */
export async function copySettingsTap(
  admin: Admin,
  fromId: number,
  data: string,
): Promise<{ toast: string; panel: Panel | null }> {
  const boss = await isBossChat(admin, fromId).catch(
    () => ({ ok: false }) as { ok: boolean; userId?: string },
  );
  if (!boss.ok) return { toast: "Only the Boss can change these.", panel: null };

  // A strategy switch (es:…) edits the engine config, not the copier settings.
  if (data.startsWith("es:")) {
    const { engineConfig, saveEngineConfig } = await import("./engine-config.server");
    const { applyStrategyTap } = await import("./engine-strategies-bot.server");
    const cfg: EngineConfig = await engineConfig();
    const { next: nextCfg, toast } = applyStrategyTap(cfg, data);
    const settings = await loadSettings(admin);
    if (!nextCfg) return { toast: toast || "Up to date", panel: card(settings, cfg.strategies) };
    const saved = await saveEngineConfig(admin, nextCfg, boss.userId).catch(() => null);
    const strat = (saved ?? cfg).strategies;
    return {
      toast: saved ? `✅ ${toast}` : "⚠️ Couldn't save that. Try again.",
      panel: card(settings, strat),
    };
  }

  const current = await loadSettings(admin);
  const strat = await loadStrategies(admin);
  const { next, toast } = applyPanelAction(current, data);
  if (data === "cs:refresh") return { toast, panel: card(current, strat) };
  if (!next) return { toast, panel: null };
  if (!(await saveSettings(admin, boss.userId, next, data)))
    return { toast: "⚠️ Couldn't save that. Try again.", panel: null };
  return { toast: `✅ ${toast}`, panel: card(next, strat) };
}
