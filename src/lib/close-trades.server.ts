// The Boss's "💰 Close trades" card in the Copy Trader B0T (the Boss,
// 2026-11-22: "add a button in the Telegram copy bot so the Boss can close all
// trades in profit, or half"). Two choices, each with a two-tap confirm:
//
// - Close all in profit: every running signals-group trade that's in profit
//   at the last price is closed. The request goes in site_content
//   CLOSE_ASK_KEY and the tracker's next pass (within ~12 s) closes each one
//   as a locked-in exit at the live price (status "breakeven" with the trail
//   stop at the exit): it counts as a win, the test account books it on the
//   spread, the group hears about it, and every copier closes at market
//   because the signal is no longer active.
// - Close half: every copier banks half of each trade that's in profit (the
//   same half-close it does at TP1), the rest keeps running. The ids go in
//   site_content HALF_KEY and the copy feed marks those trades halfClosed.
//   The test account isn't split (it shows the full trade).
//
// Requests are kept apart from the trades' own feeds so a tracker pass running
// at the same moment can't overwrite them. Boss only.

type Admin = any;

export const CLOSE_ASK_KEY = "signals.closeAsk";
export const HALF_KEY = "signals.halfClose";
export const CLOSE_BUTTON = "💰 Close trades";
/** A close request older than this is dropped (the trade moved on). */
export const CLOSE_ASK_MAX_AGE_MS = 5 * 60_000;
const HALF_KEEP_MS = 2 * 86_400_000;
const UNITS: Record<string, number> = { XAUUSD: 100, BTCUSD: 1 };

export type OpenTrade = {
  id: string;
  market: string;
  direction: "BUY" | "SELL";
  entry: number;
  last: number | null;
  lots: number;
};

type Button = { text: string; callback_data: string };
export type ClosePanel = { text: string; reply_markup: { inline_keyboard: Button[][] } };

/** The trade's money at the last price on its test-account lot, or null when unknown. Pure. */
export function openPnl(t: OpenTrade): number | null {
  if (t.last == null || !Number.isFinite(t.last)) return null;
  const side = t.direction === "BUY" ? 1 : -1;
  return Math.round((t.last - t.entry) * side * t.lots * (UNITS[t.market] ?? 1) * 100) / 100;
}

/** Whether the trade is in profit at the last price. Pure. */
export const inProfit = (t: OpenTrade) =>
  t.last != null && (t.last - t.entry) * (t.direction === "BUY" ? 1 : -1) > 0;

const money = (n: number) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The card: what's running, what's in profit, and the two choices. Pure. */
export function closePanel(
  trades: OpenTrade[],
  opts: { confirming?: "profit" | "half"; note?: string } = {},
): ClosePanel {
  const winners = trades.filter(inProfit);
  const winSum = winners.reduce((a, t) => a + (openPnl(t) ?? 0), 0);
  const text = [
    ...(opts.note ? [opts.note, ""] : []),
    opts.confirming === "profit"
      ? "💰 CLOSE ALL IN PROFIT: SURE?"
      : opts.confirming === "half"
        ? "✂️ CLOSE HALF: SURE?"
        : "💰 CLOSE TRADES",
    "",
    `Running now: ${trades.length} · in profit: ${winners.length}${winners.length ? ` (${money(winSum)} on the test account)` : ""}`,
    ...winners
      .slice(0, 8)
      .map(
        (t) =>
          `• ${t.market === "XAUUSD" ? "🥇 Gold" : "₿ BTC"} ${t.direction} ${money(openPnl(t) ?? 0)}`,
      ),
    "",
    opts.confirming === "profit"
      ? "Every trade in profit closes at the price then, in the signals group, on the test account and on every copier. Losing trades keep running."
      : opts.confirming === "half"
        ? "Every copier banks half of each trade in profit; the other half keeps running with its stop. (The test account shows the full trade.)"
        : "Close every trade that's in profit, or bank half of each on the copiers.",
  ].join("\n");
  if (opts.confirming)
    return {
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                opts.confirming === "profit"
                  ? `✅ Yes, close ${winners.length} in profit`
                  : `✅ Yes, close half of ${winners.length}`,
              callback_data: `ct:go:${opts.confirming}`,
            },
          ],
          [{ text: "↩️ Back", callback_data: "ct:back" }],
        ],
      },
    };
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        ...(winners.length
          ? [
              [
                {
                  text: `💰 Close all in profit (${winners.length})`,
                  callback_data: "ct:ask:profit",
                },
              ],
              [{ text: `✂️ Close half of each (${winners.length})`, callback_data: "ct:ask:half" }],
            ]
          : []),
        [
          { text: "🔄 Refresh", callback_data: "ct:back" },
          { text: "✖️ Close", callback_data: "ct:close" },
        ],
      ],
    },
  };
}

/** One tap ("ct:…"): what to show or do. Pure. */
export function parseCloseTap(
  data: string,
):
  | { show: "card" }
  | { show: "confirm"; mode: "profit" | "half" }
  | { run: "profit" | "half" }
  | { show: "closed" }
  | null {
  if (data === "ct:back") return { show: "card" };
  if (data === "ct:close") return { show: "closed" };
  const ask = /^ct:ask:(profit|half)$/.exec(data);
  if (ask) return { show: "confirm", mode: ask[1] as "profit" | "half" };
  const go = /^ct:go:(profit|half)$/.exec(data);
  if (go) return { run: go[1] as "profit" | "half" };
  return null;
}

/** A stored id list ({ ids, at }), cleaned. Pure. */
export function parseIds(value: string | null | undefined): { ids: string[]; at: number } {
  try {
    const t = JSON.parse(value ?? "") as { ids?: unknown; at?: unknown };
    const ids = Array.isArray(t.ids)
      ? t.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))
      : [];
    return { ids, at: Number(t.at) || 0 };
  } catch {
    return { ids: [], at: 0 };
  }
}

/** The close request the tracker should act on now (ids), or none when stale. Pure. */
export function dueCloseIds(value: string | null | undefined, now: number): Set<string> {
  const ask = parseIds(value);
  return now - ask.at <= CLOSE_ASK_MAX_AGE_MS ? new Set(ask.ids) : new Set();
}

/* ── the database and Telegram side ────────────────────────────────────────── */

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

async function save(admin: Admin, key: string, value: unknown) {
  const at = new Date().toISOString();
  await admin
    .from("site_content")
    .upsert({ key, value: JSON.stringify(value), updated_at: at }, { onConflict: "key" });
}

/** The signals group's running trades that are filled (the ones a copier is in). */
export async function openGroupTrades(admin: Admin): Promise<OpenTrade[]> {
  const { signalsChatId } = await import("./signal-chat.server");
  const chat = await signalsChatId();
  if (chat == null) return [];
  const { data } = await admin
    .from("trade_signals")
    .select("id, market, direction, entry, last_price, entered_at, feeds")
    .eq("sender_worker", "trade")
    .eq("chat_id", chat)
    .in("status", ["open", "tp1", "tp2"])
    .not("entered_at", "is", null)
    .limit(200);
  return (
    (data ?? []) as {
      id: string;
      market: string;
      direction: "BUY" | "SELL";
      entry: number | string;
      last_price: number | string | null;
      feeds: { paper?: { lots?: number } } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    market: r.market,
    direction: r.direction,
    entry: Number(r.entry),
    last: r.last_price == null ? null : Number(r.last_price),
    lots: Number(r.feeds?.paper?.lots) || 0.01,
  }));
}

/** The ids the copy feed marks halfClosed (the Boss's "close half"). */
export async function halfClosedIds(admin: Admin): Promise<Set<string>> {
  return new Set(parseIds(await setting(admin, HALF_KEY)).ids);
}

/** The ids the tracker closes on this pass (a fresh "close all in profit"). */
export async function closeAskIds(admin: Admin, now = Date.now()): Promise<Set<string>> {
  return dueCloseIds(await setting(admin, CLOSE_ASK_KEY), now);
}

async function boss(admin: Admin, chatId: number) {
  const { isBossChat } = await import("./copy-settings-bot.server");
  return isBossChat(admin, chatId).catch(() => ({ ok: false }) as { ok: boolean; userId?: string });
}

/** "💰 Close trades" or /close from the Boss: the card. Null for anyone else. */
export async function closeTradesReply(
  admin: Admin,
  chatId: number,
  text: string,
): Promise<ClosePanel | null> {
  const t = text.trim();
  if (t !== CLOSE_BUTTON && !/^\/close(?:@\w+)?$/i.test(t)) return null;
  if (!(await boss(admin, chatId)).ok) return null;
  return closePanel(await openGroupTrades(admin));
}

/** A tap on the card ("ct:…"), Boss only. */
export async function closeTradesTap(
  admin: Admin,
  fromId: number,
  data: string,
): Promise<{ toast: string; panel: ClosePanel | null }> {
  const who = await boss(admin, fromId);
  if (!who.ok) return { toast: "Only the Boss can close trades.", panel: null };
  const tap = parseCloseTap(data);
  if (!tap) return { toast: "", panel: null };
  if ("show" in tap && tap.show === "closed")
    return {
      toast: "Closed",
      panel: { text: "💰 Close trades: nothing changed.", reply_markup: { inline_keyboard: [] } },
    };
  const trades = await openGroupTrades(admin);
  if ("show" in tap)
    return tap.show === "confirm"
      ? { toast: "Check it, then tap Yes", panel: closePanel(trades, { confirming: tap.mode }) }
      : { toast: "Up to date", panel: closePanel(trades) };
  const winners = trades.filter(inProfit).map((t) => t.id);
  if (!winners.length)
    return {
      toast: "Nothing in profit right now",
      panel: closePanel(trades, { note: "Nothing is in profit right now." }),
    };
  const now = Date.now();
  if (tap.run === "profit") {
    await save(admin, CLOSE_ASK_KEY, { ids: winners, at: now });
  } else {
    const kept = parseIds(await setting(admin, HALF_KEY));
    const fresh = now - kept.at > HALF_KEEP_MS ? [] : kept.ids;
    await save(admin, HALF_KEY, { ids: [...new Set([...fresh, ...winners])], at: now });
  }
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: who.userId,
      action: tap.run === "profit" ? "close_in_profit" : "close_half",
      category: "signals",
      target_key: `${winners.length} trades`,
      metadata: { ids: winners },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return {
    toast: tap.run === "profit" ? "💰 Closing…" : "✂️ Half closing…",
    panel: closePanel(trades, {
      note:
        tap.run === "profit"
          ? `✅ Closing ${winners.length} trade${winners.length === 1 ? "" : "s"} in profit: the tracker closes them within seconds and every copier follows.`
          : `✅ Every copier banks half of ${winners.length} trade${winners.length === 1 ? "" : "s"} on its next check.`,
    }),
  };
}
