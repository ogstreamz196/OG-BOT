// Auto-trading the Boss's own Vantage MT5 account through MetaApi.
//
// Every 70%+ gold or bitcoin alert the scanner posts to the signals chat
// places one trade: 0.01 lot, the bot's stop loss, and its Quick Scalp as the
// take profit (market orders now; limit and stop entries as pending orders
// that expire with the signal). The minute watcher then follows each trade to
// its close and the copy-trade bot announces opens and closes.
//
// Off until the Boss switches it on (site_content "mt5.autotrade" = "on").
// Needs METAAPI_TOKEN and METAAPI_ACCOUNT_ID (the account is added and
// deployed in the MetaApi dashboard, so the MT5 password never touches this
// app); METAAPI_REGION defaults to new-york. Broker symbols can be renamed
// with MT5_SYMBOL_XAUUSD / MT5_SYMBOL_BTCUSD (Vantage default: same names).
// Never throws into the signal flow, and never logs the token.
import type { SignalPlan } from "./trade-signal-context.server";

type Admin = any;

export const MT5_TABLE = "mt5_trades";
export const AUTOTRADE_KEY = "mt5.autotrade";
export const COPY_LINK_KEY = "mt5.copyLink";
export const AUTOTRADE_LOT = 0.01;
export const AUTOTRADE_MIN_CONFIDENCE = 70;
const MARKETS = ["XAUUSD", "BTCUSD"];

export type Mt5Trade = {
  id: string;
  setup_key: string;
  market: string;
  label: string;
  symbol: string;
  direction: "BUY" | "SELL";
  order_type: string;
  volume: number;
  entry: number;
  stop_loss: number;
  take_profit: number;
  confidence_pct: number | null;
  ticket: string | null;
  status: "pending" | "open" | "closed" | "cancelled" | "failed";
  error: string | null;
  profit: number | null;
  expires_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
};

/* ── MetaApi ──────────────────────────────────────────────────────────── */

export function metaApiConfigured(): boolean {
  return !!process.env["METAAPI_TOKEN"] && !!process.env["METAAPI_ACCOUNT_ID"];
}

function base(): string {
  const region = (process.env["METAAPI_REGION"] || "new-york").replace(/[^a-z0-9-]/gi, "");
  const account = encodeURIComponent(process.env["METAAPI_ACCOUNT_ID"] ?? "");
  return `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${account}`;
}

/** One MetaApi call; `{ ok, data }` and never throws. The token is never logged. */
export async function metaApi<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const token = process.env["METAAPI_TOKEN"];
  if (!token || !process.env["METAAPI_ACCOUNT_ID"]) return { ok: false, status: 0, data: null };
  try {
    const res = await fetch(`${base()}${path}`, {
      method: init.method ?? "GET",
      headers: { "auth-token": token, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export type AccountInfo = {
  balance?: number;
  equity?: number;
  currency?: string;
  broker?: string;
  server?: string;
  login?: number;
};

/* ── Settings ─────────────────────────────────────────────────────────── */

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

export async function autotradeOn(admin: Admin): Promise<boolean> {
  return (await setting(admin, AUTOTRADE_KEY)) === "on";
}

export async function copyLink(admin: Admin): Promise<string | null> {
  const v = await setting(admin, COPY_LINK_KEY);
  return v && /^https:\/\//.test(v) ? v : null;
}

export function brokerSymbol(market: string): string {
  return (process.env[`MT5_SYMBOL_${market}`] || market).trim();
}

/* ── Placing a trade ──────────────────────────────────────────────────── */

const round = (n: number, dp: number) => Number(n.toFixed(Math.max(0, Math.min(8, dp))));

/** The MetaApi trade request for a signal (pure, so it can be tested). */
export function tradeRequest(plan: SignalPlan, symbol: string, ticketTag: string) {
  const buy = plan.direction === "BUY";
  const dp = plan.decimals;
  const actionType =
    plan.entryType === "market"
      ? buy
        ? "ORDER_TYPE_BUY"
        : "ORDER_TYPE_SELL"
      : plan.entryType === "limit"
        ? buy
          ? "ORDER_TYPE_BUY_LIMIT"
          : "ORDER_TYPE_SELL_LIMIT"
        : buy
          ? "ORDER_TYPE_BUY_STOP"
          : "ORDER_TYPE_SELL_STOP";
  return {
    actionType,
    symbol,
    volume: AUTOTRADE_LOT,
    stopLoss: round(plan.stop, dp),
    // Quick Scalp: the first target, the one a win is counted on.
    takeProfit: round(plan.targets[0], dp),
    ...(plan.entryType === "market"
      ? {}
      : {
          openPrice: round(plan.entry, dp),
          expiration: { type: "ORDER_TIME_SPECIFIED", time: plan.expiresAt },
        }),
    comment: "OG B0T",
    clientId: ticketTag.slice(0, 20),
  };
}

type TradeReply = {
  numericCode?: number;
  stringCode?: string;
  message?: string;
  orderId?: string;
  positionId?: string;
};

const DONE = new Set(["TRADE_RETCODE_DONE", "TRADE_RETCODE_PLACED", "TRADE_RETCODE_DONE_PARTIAL"]);

/**
 * Called when the scanner has just posted an alert: places the Boss's trade
 * for it, once per setup. Never throws.
 */
export async function placeAutoTrade(admin: Admin, plan: SignalPlan): Promise<string> {
  try {
    if (!metaApiConfigured()) return "skipped: MetaApi not set up";
    if (plan.feeds?.bias) return "skipped: bias call";
    if (!MARKETS.includes(plan.market)) return "skipped: market";
    if (plan.confidencePct < AUTOTRADE_MIN_CONFIDENCE) return "skipped: under 70%";
    if (!(await autotradeOn(admin))) return "skipped: switched off";
    const { setupKey } = await import("./signal-results.server");
    const key = setupKey({
      id: "",
      market: plan.market,
      label: plan.label,
      direction: plan.direction,
      entry: plan.entry,
      stop: plan.stop,
      tp1: plan.targets[0],
      tp2: plan.targets[1],
      tp3: plan.targets[2],
      pip: plan.pip,
      decimals: plan.decimals,
    });
    const symbol = brokerSymbol(plan.market);
    const request = tradeRequest(plan, symbol, `ogb${Date.now().toString(36)}`);
    // Claim the setup first, so a retry or a second scan can't trade it twice.
    const { data: row, error: claimErr } = await admin
      .from(MT5_TABLE)
      .insert({
        setup_key: key,
        market: plan.market,
        label: plan.label,
        symbol,
        direction: plan.direction,
        order_type: request.actionType,
        volume: request.volume,
        entry: round(plan.entry, plan.decimals),
        stop_loss: request.stopLoss,
        take_profit: request.takeProfit,
        confidence_pct: plan.confidencePct,
        status: "pending",
        expires_at: plan.expiresAt,
      })
      .select("*")
      .maybeSingle();
    if (claimErr || !row) return "skipped: already traded";
    const res = await metaApi<TradeReply>("/trade", { method: "POST", body: request });
    const code = res.data?.stringCode ?? "";
    const ticket = res.data?.positionId || res.data?.orderId || null;
    const now = new Date().toISOString();
    if (!res.ok || !DONE.has(code) || !ticket) {
      const why = (res.data?.message || code || `MetaApi answered ${res.status}`).slice(0, 300);
      await admin
        .from(MT5_TABLE)
        .update({ status: "failed", error: why, updated_at: now })
        .eq("id", row.id);
      return `failed: ${why}`;
    }
    const market = plan.entryType === "market";
    const placed: Mt5Trade = {
      ...(row as Mt5Trade),
      ticket,
      status: market ? "open" : "pending",
      opened_at: market ? now : null,
    };
    await admin
      .from(MT5_TABLE)
      .update({
        ticket,
        status: placed.status,
        opened_at: placed.opened_at,
        updated_at: now,
      })
      .eq("id", row.id);
    if (market) await announce(admin, placed, "opened");
    return market ? "opened" : "pending order placed";
  } catch (e) {
    console.warn("[mt5] auto-trade failed", e instanceof Error ? e.message : "error");
    return "failed: error";
  }
}

/* ── Following trades ─────────────────────────────────────────────────── */

type Position = { id: string; profit?: number };
type Order = { id: string };
type Deal = {
  positionId?: string;
  profit?: number;
  swap?: number;
  commission?: number;
  entryType?: string;
};

/** The trade's realised result from its deals (profit, swap and commission). */
export function dealResult(deals: Deal[]): number {
  return (
    Math.round(
      deals.reduce(
        (n, d) => n + (Number(d.profit) || 0) + (Number(d.swap) || 0) + (Number(d.commission) || 0),
        0,
      ) * 100,
    ) / 100
  );
}

/**
 * One pass over the Boss's live trades (the minute watcher calls this):
 * pending orders that filled or expired, and positions that closed. Never throws.
 */
export async function followAutoTrades(admin: Admin, now = Date.now()): Promise<number> {
  try {
    if (!metaApiConfigured()) return 0;
    const { data, error } = await admin
      .from(MT5_TABLE)
      .select("*")
      .in("status", ["pending", "open"])
      .limit(50);
    if (error || !data?.length) return 0;
    const trades = data as Mt5Trade[];
    const [positions, orders] = await Promise.all([
      metaApi<Position[]>("/positions"),
      metaApi<Order[]>("/orders"),
    ]);
    // Without a clean read, judge nothing (a blip mustn't close trades).
    if (
      !positions.ok ||
      !orders.ok ||
      !Array.isArray(positions.data) ||
      !Array.isArray(orders.data)
    )
      return 0;
    const open = new Set(positions.data.map((p) => String(p.id)));
    const waiting = new Set(orders.data.map((o) => String(o.id)));
    let changed = 0;
    for (const t of trades) {
      if (!t.ticket) continue;
      const iso = new Date(now).toISOString();
      if (t.status === "pending") {
        if (waiting.has(t.ticket)) continue;
        if (open.has(t.ticket)) {
          await admin
            .from(MT5_TABLE)
            .update({ status: "open", opened_at: iso, updated_at: iso })
            .eq("id", t.id);
          await announce(admin, { ...t, status: "open" }, "opened");
          changed++;
          continue;
        }
      } else if (open.has(t.ticket)) continue;
      // Gone from both lists: closed, or a pending order that expired unfilled.
      const deals = await metaApi<Deal[]>(
        `/history-deals/position/${encodeURIComponent(t.ticket)}`,
      );
      if (!deals.ok || !Array.isArray(deals.data)) continue;
      if (!deals.data.length) {
        if (t.status === "pending") {
          await admin
            .from(MT5_TABLE)
            .update({ status: "cancelled", closed_at: iso, updated_at: iso })
            .eq("id", t.id);
          changed++;
        }
        continue;
      }
      const profit = dealResult(deals.data);
      const closed: Mt5Trade = { ...t, status: "closed", profit, closed_at: iso };
      await admin
        .from(MT5_TABLE)
        .update({ status: "closed", profit, closed_at: iso, updated_at: iso })
        .eq("id", t.id);
      // A pending order that filled and closed between two checks: open, then close.
      if (t.status === "pending") await announce(admin, { ...t, status: "open" }, "opened");
      await announce(admin, closed, "closed");
      changed++;
    }
    return changed;
  } catch (e) {
    console.warn("[mt5] follow failed", e instanceof Error ? e.message : "error");
    return 0;
  }
}

/* ── The copy-trade bot ───────────────────────────────────────────────── */

const usd = (n: number) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** What the copy bot posts (pure, so it can be tested). */
export function announceText(t: Mt5Trade, event: "opened" | "closed"): string {
  const dp = String(t.entry).split(".")[1]?.length ?? 2;
  const f = (n: number) => Number(n).toFixed(Math.min(dp, 5));
  if (event === "opened")
    return [
      `🤖 COPY BOT · ${t.direction === "BUY" ? "🟢 BOUGHT" : "🔴 SOLD"} ${t.symbol} ${t.volume} lot`,
      `▶️ ${f(t.entry)} · 🛑 SL ${f(t.stop_loss)} · 🎯 TP ${f(t.take_profit)}`,
      `The Boss's account just took this one. Copy it and ride along, or don't and cry later.`,
    ].join("\n");
  const won = Number(t.profit) > 0;
  return [
    `🤖 COPY BOT · ${won ? "✅ CLOSED IN PROFIT" : Number(t.profit) < 0 ? "🛑 CLOSED AT A LOSS" : "⚖️ CLOSED FLAT"}`,
    `${t.symbol} ${t.direction} ${t.volume} lot · ${usd(Number(t.profit) || 0)}`,
    won ? "Bag secured. Copiers got paid too." : "Took the hit, moving on. That's trading.",
  ].join("\n");
}

/** The enabled copy-trade worker, if one is set up. */
async function copyBot(admin: Admin): Promise<{ id: string } | null> {
  const { data } = await admin
    .from("telegram_worker_bots")
    .select("id")
    .eq("role", "copy")
    .eq("enabled", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Posts a trade to the signals chat as the copy bot, with the copy link. */
async function announce(admin: Admin, t: Mt5Trade, event: "opened" | "closed") {
  try {
    const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
    if (!key) return;
    const bot = await copyBot(admin);
    if (!bot) return;
    const { signalsChatId } = await import("./signal-chat.server");
    const chatId = await signalsChatId();
    if (chatId === null) return;
    const f = await import("./telegram-fleet.server");
    // Golden rule: in a group the worker only posts where the Gaffer is and it's on duty.
    if (chatId < 0) {
      const { managedGroup } = await import("./telegram-worker.server");
      const group = await managedGroup(admin, chatId);
      if (group && group.chat_type !== "channel" && !(await f.fleetAllowed(bot.id, chatId))) return;
    }
    const link = await copyLink(admin);
    await f.fleetApi(
      bot.id,
      "sendMessage",
      {
        chat_id: chatId,
        text: announceText(t, event),
        disable_web_page_preview: true,
        ...(link
          ? { reply_markup: { inline_keyboard: [[{ text: "📋 Copy my trades", url: link }]] } }
          : {}),
      },
      key,
    );
  } catch {
    /* announcing is best effort */
  }
}

/** What the copy bot says when someone talks to it. */
export async function copyBotReply(admin: Admin): Promise<{ text: string; link: string | null }> {
  const link = await copyLink(admin);
  return {
    text: link
      ? "🤖 I'm the Boss's copy bot. Every trade the Boss's account takes on the OG B0T signals gets copied to yours automatically. Tap below to set up copy trading on Vantage."
      : "🤖 I'm the Boss's copy bot. Copy trading opens soon; watch this space.",
    link,
  };
}
