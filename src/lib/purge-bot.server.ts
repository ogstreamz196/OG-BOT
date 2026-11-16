// The signals group's purge and balance reset from the Copy Trader B0T (the
// Boss, 2026-11-16: "add the purge and reset balance for signal group button
// on copy trade bot on telegram so I don't need to keep going on the website
// to reset"). A card with start-balance choices and a two-tap run (🧹 Purge &
// reset → ✅ Yes, purge and reset), Boss only. It runs the same freshStart as
// the website's Purge button (signals-chat.functions.ts purgeSignalsChat):
// the chat is cleared as far as Telegram allows, the counters and results post
// restart, the test account starts at the chosen balance; no stored trade or
// learning data is deleted (house rule). Audit-logged the same way.
// The card is stateless: the chosen balance rides in each button's data.

type Admin = any;

export const RESET_BUTTON = "🧹 Purge & reset";
export const RESET_BALANCES = [500, 1000, 2000, 5000];
export const MIN_BALANCE = 10;
export const MAX_BALANCE = 1_000_000;

type Button = { text: string; callback_data: string };
export type ResetPanel = { text: string; reply_markup: { inline_keyboard: Button[][] } };

const money = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** A start balance from a button or a typed command, or null when it's out of range. Pure. */
export function cleanBalance(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < MIN_BALANCE || n > MAX_BALANCE) return null;
  return Math.round(n * 100) / 100;
}

/** "/reset", "/reset 2500", "/purge" or the 🧹 button: the balance asked for (default $1,000), else undefined. Pure. */
export function resetAsk(text: string): { balance: number | null } | undefined {
  const t = text.trim();
  if (t === RESET_BUTTON) return { balance: 1000 };
  const m = /^\/(reset|purge)(?:@\w+)?(?:\s+\$?([\d,.]+))?\s*$/i.exec(t);
  if (!m) return undefined;
  if (!m[2]) return { balance: 1000 };
  return { balance: cleanBalance(m[2].replace(/,/g, "")) };
}

/** The card: what it does, the current test account and the balance choices. Pure. */
export function resetPanel(
  balance: number,
  current: { start: number; balance: number | null; startedAt: string } | null,
  opts: { confirming?: boolean; note?: string } = {},
): ResetPanel {
  const since = current
    ? new Date(current.startedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "Europe/London",
      })
    : null;
  const text = [
    ...(opts.note ? [opts.note, ""] : []),
    opts.confirming ? "🧹 PURGE & RESET: ARE YOU SURE?" : "🧹 PURGE & RESET THE SIGNALS GROUP",
    "",
    current
      ? `Test account now: ${current.balance != null ? money(current.balance) : "?"} (started at ${money(current.start)} on ${since})`
      : "No test account running yet.",
    `New start balance: ${money(balance)}`,
    "",
    "Clears every message the bots can still delete in the signals group (Telegram only lets bots delete the last 48 hours), restarts the win/loss counter and the results post, and starts the test account at the new balance.",
    "Nothing stored is deleted: the bot keeps learning from every past trade.",
  ].join("\n");
  if (opts.confirming)
    return {
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `✅ Yes, purge and reset at ${money(balance)}`,
              callback_data: `rs:go:${balance}`,
            },
          ],
          [{ text: "↩️ Back", callback_data: `rs:back:${balance}` }],
        ],
      },
    };
  const tick = (n: number) => `${n === balance ? "✅ " : ""}${money(n)}`;
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        RESET_BALANCES.slice(0, 2).map((n) => ({ text: tick(n), callback_data: `rs:bal:${n}` })),
        RESET_BALANCES.slice(2).map((n) => ({ text: tick(n), callback_data: `rs:bal:${n}` })),
        [{ text: `🧹 Purge & reset at ${money(balance)}`, callback_data: `rs:ask:${balance}` }],
        [{ text: "✖️ Close", callback_data: `rs:close:${balance}` }],
      ],
    },
  };
}

/**
 * One tap: what to show next ("card" or "confirm"), whether to run the purge
 * now, or close the card. Unknown or out-of-range data changes nothing. Pure.
 */
export function applyResetTap(data: string): {
  balance: number;
  show: "card" | "confirm" | "closed";
  run: boolean;
} | null {
  const [, kind, raw] = data.split(":");
  const balance = cleanBalance(raw);
  if (balance == null) return null;
  switch (kind) {
    case "bal":
    case "back":
      return { balance, show: "card", run: false };
    case "ask":
      return { balance, show: "confirm", run: false };
    case "go":
      return { balance, show: "card", run: true };
    case "close":
      return { balance, show: "closed", run: false };
    default:
      return null;
  }
}

/** The result line after a purge. Pure. */
export function resultNote(out: Record<string, unknown>, balance: number): string {
  if (!out.ok)
    return `⚠️ Not done: ${String(out.why ?? "something went wrong")}. Nothing was reset.`;
  const swept = Number(out.swept) || 0;
  return [
    `✅ Done. The signals group is clear and the test account starts at ${money(balance)}.`,
    `${swept.toLocaleString("en-GB")} message ids swept${out.deleteRefused ? " (older ones Telegram won't let bots delete stay)" : ""}.`,
  ].join("\n");
}

/* ── the database and Telegram side ────────────────────────────────────────── */

async function currentAccount(admin: Admin) {
  const pa = await import("./paper-account.server");
  const state = await pa.paperState(admin).catch(() => null);
  if (!state) return null;
  const balance = await pa.paperBalance(admin, state).catch(() => null);
  return { start: state.start, balance, startedAt: state.startedAt };
}

async function boss(admin: Admin, chatId: number) {
  const { isBossChat } = await import("./copy-settings-bot.server");
  return isBossChat(admin, chatId).catch(() => ({ ok: false }) as { ok: boolean; userId?: string });
}

/** "/reset", "/purge" or the 🧹 button from the Boss: the card. Null for anyone else. */
export async function resetReply(
  admin: Admin,
  chatId: number,
  text: string,
): Promise<ResetPanel | null> {
  const ask = resetAsk(text);
  if (!ask) return null;
  if (!(await boss(admin, chatId)).ok) return null;
  const current = await currentAccount(admin);
  if (ask.balance == null)
    return resetPanel(1000, current, {
      note: `⚠️ Pick a start balance between ${money(MIN_BALANCE)} and ${money(MAX_BALANCE)}, e.g. /reset 2500`,
    });
  return resetPanel(ask.balance, current);
}

/**
 * A tap on the card ("rs:…"), Boss only. A purge answers the tap and shows
 * "Purging…" first (it can take a while), then puts the result on the card.
 */
export async function resetTap(
  admin: Admin,
  fromId: number,
  data: string,
  progress: (panel: ResetPanel) => Promise<void>,
): Promise<{ toast: string; panel: ResetPanel | null }> {
  const who = await boss(admin, fromId);
  if (!who.ok) return { toast: "Only the Boss can purge the signals group.", panel: null };
  const tap = applyResetTap(data);
  if (!tap) return { toast: "", panel: null };
  if (tap.show === "closed")
    return {
      toast: "Closed",
      panel: {
        text: "🧹 Purge & reset closed. Nothing was changed.",
        reply_markup: { inline_keyboard: [] },
      },
    };
  const current = await currentAccount(admin);
  if (!tap.run)
    return {
      toast: tap.show === "confirm" ? "Check it, then tap Yes" : "",
      panel: resetPanel(tap.balance, current, { confirming: tap.show === "confirm" }),
    };
  await progress({
    text: `🧹 Purging the signals group and resetting the test account to ${money(tap.balance)}…`,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
  const { freshStart } = await import("./signals-fresh-start.server");
  const out = await freshStart(admin, tap.balance).catch(
    (e: unknown) =>
      ({ ok: false, why: e instanceof Error ? e.message : "error" }) as Record<string, unknown>,
  );
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: who.userId,
      action: "signals_chat_purge",
      category: "signals",
      target_key: "signals.chat.purgedAt",
      metadata: { balance: tap.balance, ok: out.ok, swept: out.swept ?? 0, from: "copy bot" },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  const after = await currentAccount(admin);
  return {
    toast: out.ok ? "✅ Purged and reset" : "⚠️ Not done",
    panel: resetPanel(tap.balance, after, { note: resultNote(out, tap.balance) }),
  };
}
