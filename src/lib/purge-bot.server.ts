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
  opts: { confirming?: boolean; note?: string; realBalance?: number | null } = {},
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
  const real = opts.realBalance != null ? Math.floor(opts.realBalance) : null;
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        ...(real != null && real >= MIN_BALANCE
          ? [[{ text: `${real === balance ? "✅ " : ""}💰 Real account ${money(real)}`, callback_data: `rs:bal:${real}` }]]
          : []),
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
  // A connected real account: its balance is the start, unless a balance was typed.
  const { realBalance } = await import("./mt5-autotrade.server");
  const real = await realBalance(admin).catch(() => null);
  const realBal = real != null ? Math.floor(real) : null;
  if (ask.balance == null)
    return resetPanel(realBal != null && realBal >= MIN_BALANCE ? realBal : 1000, current, {
      realBalance: realBal,
      note:
        realBal != null
          ? `💰 Real account connected: its balance starts the new run.`
          : `⚠️ Pick a start balance between ${money(MIN_BALANCE)} and ${money(MAX_BALANCE)}, e.g. /reset 2500`,
    });
  return resetPanel(ask.balance, current, { realBalance: realBal });
}

/** Where a queued purge reports back: the copy bot and the card it was asked from. */
export type PurgeCard = { botId: string; chatId: number; messageId: number };
/** A purge waiting for the next minute's watch run (site_content). */
export const PURGE_JOB_KEY = "signals.purge.job";
/** A queued purge older than this is dropped, not run late. */
export const PURGE_JOB_MAX_AGE_MS = 10 * 60_000;
type PurgeJob = {
  balance: number;
  by?: string;
  card?: PurgeCard;
  at: string;
  state: "queued" | "running" | "done";
  /** When a run claimed it (a claim this old with no result is run again). */
  claimedAt?: string;
};

/** A stored job, or null when it's missing, finished, stale or broken. Pure. */
/** A claimed purge with no result after this long was cut off: it's run again. */
export const PURGE_STUCK_MS = 2 * 60_000;

export function dueJob(raw: string | null | undefined, now: number): PurgeJob | null {
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as PurgeJob;
    if (cleanBalance(job.balance) == null) return null;
    const claimed = Date.parse(job.claimedAt ?? "");
    const stuck =
      job.state === "running" && (!Number.isFinite(claimed) || now - claimed > PURGE_STUCK_MS);
    if (job.state !== "queued" && !stuck) return null;
    const at = Date.parse(job.at);
    if (!Number.isFinite(at) || now - at > PURGE_JOB_MAX_AGE_MS) return null;
    return job;
  } catch {
    return null;
  }
}

async function saveJob(admin: Admin, job: PurgeJob) {
  const at = new Date().toISOString();
  await admin
    .from("site_content")
    .upsert(
      { key: PURGE_JOB_KEY, value: JSON.stringify(job), updated_at: at },
      { onConflict: "key" },
    );
}

/**
 * A tap on the card ("rs:…"), Boss only. "Yes, purge and reset" queues the
 * purge (PURGE_JOB_KEY); the webhook then runs it at once (runQueuedPurge,
 * about 4 seconds: the Boss, 2026-11-17, "purge from the bot takes long to
 * appear" when it waited for the next minute). If the tap's request is cut
 * off, the next trade-signal-watch run does it instead (a claim with no
 * result after PURGE_STUCK_MS is run again). Either way the card shows the
 * result.
 */
export async function resetTap(
  admin: Admin,
  fromId: number,
  data: string,
  card?: PurgeCard,
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
  await saveJob(admin, {
    balance: tap.balance,
    by: who.userId,
    ...(card ? { card } : {}),
    at: new Date().toISOString(),
    state: "queued",
  });
  return {
    toast: "🧹 Purge on its way",
    panel: {
      text: `🧹 Purging the signals group and resetting the test account to ${money(tap.balance)}… this card shows the result in a few seconds.`,
      reply_markup: { inline_keyboard: [] },
    },
  };
}

/**
 * The queued purge, from trade-signal-watch (once a minute): runs freshStart
 * (the same as the website's Purge button), audit-logs it and puts the result
 * on the Boss's card. Returns what happened, "none" when nothing's queued.
 */
export async function runQueuedPurge(admin: Admin, now = Date.now()): Promise<string> {
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", PURGE_JOB_KEY)
    .maybeSingle();
  const job = dueJob((data as { value?: string } | null)?.value, now);
  if (!job) return "none";
  // Claimed first, so a slow run is never started twice.
  await saveJob(admin, { ...job, state: "running", claimedAt: new Date(now).toISOString() });
  const { freshStart } = await import("./signals-fresh-start.server");
  const out = await freshStart(admin, job.balance).catch(
    (e: unknown) =>
      ({ ok: false, why: e instanceof Error ? e.message : "error" }) as Record<string, unknown>,
  );
  await saveJob(admin, { ...job, state: "done" });
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: job.by,
      action: "signals_chat_purge",
      category: "signals",
      target_key: "signals.chat.purgedAt",
      metadata: { balance: job.balance, ok: out.ok, swept: out.swept ?? 0, from: "copy bot" },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
  if (job.card && key) {
    const after = await currentAccount(admin);
    const panel = resetPanel(job.balance, after, { note: resultNote(out, job.balance) });
    const { fleetApi } = await import("./telegram-fleet.server");
    await fleetApi(
      job.card.botId,
      "editMessageText",
      {
        chat_id: job.card.chatId,
        message_id: job.card.messageId,
        text: panel.text,
        reply_markup: panel.reply_markup,
      },
      key,
    ).catch(() => undefined);
  }
  return out.ok ? `purged at ${job.balance}` : `not done: ${String(out.why ?? "error")}`;
}
