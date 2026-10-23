// Gives OG Bot live market data when a user asks for a trade signal on a
// pair. Prices come from free public feeds (Binance and Kraken for crypto and
// gold, Yahoo Finance for forex, indices, oil and stocks); indicators and the
// trade plan are computed in code (trade-signal.ts) so the bot quotes real
// numbers instead of guessing.
import {
  aggregate,
  buildPlan,
  decimalsFor,
  detectStyle,
  detectTradeIntent,
  readFrame,
  type Candle,
  type FrameRead,
  type Instrument,
  validityWindow,
  type Style,
} from "./trade-signal";

type Interval = "15m" | "1h" | "1d";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; OGBot/1.0)" };
const TIMEOUT_MS = 3500;
/** Start the next source if the current one hasn't answered by now. */
const HEDGE_MS = 900;
const NEWS_TIMEOUT_MS = 2500;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const clean = (cs: Candle[]) =>
  cs.filter((c) => [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0));

async function fromBinance(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
  const rows = (await getJson(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )) as unknown[][];
  return clean(
    rows.map((r) => ({
      t: Number(r[0]),
      o: +String(r[1]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
    })),
  );
}

async function fromKraken(pair: string, interval: Interval): Promise<Candle[]> {
  const mins = interval === "15m" ? 15 : interval === "1h" ? 60 : 1440;
  const json = (await getJson(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${mins}`,
  )) as { error?: string[]; result?: Record<string, unknown> };
  if (json.error?.length) throw new Error(json.error.join(", "));
  const key = Object.keys(json.result ?? {}).find((k) => k !== "last");
  const rows = (key ? json.result?.[key] : []) as unknown[][];
  return clean(
    rows.map((r) => ({
      t: Number(r[0]) * 1000,
      o: +String(r[1]),
      h: +String(r[2]),
      l: +String(r[3]),
      c: +String(r[4]),
    })),
  );
}

async function fromYahoo(symbol: string, interval: Interval): Promise<Candle[]> {
  const range = interval === "15m" ? "5d" : interval === "1h" ? "60d" : "1y";
  const json = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
  )) as {
    chart?: {
      result?: {
        timestamp?: number[];
        indicators?: {
          quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[] }[];
        };
      }[];
    };
  };
  const r = json.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error("no chart data");
  return clean(
    r.timestamp.map((t, i) => ({
      t: t * 1000,
      o: q.open?.[i] ?? NaN,
      h: q.high?.[i] ?? NaN,
      l: q.low?.[i] ?? NaN,
      c: q.close?.[i] ?? NaN,
    })),
  );
}

// Warm caches shared by every request on this server instance.
const CANDLE_TTL: Record<Interval, number> = { "1d": 10 * 60_000, "1h": 60_000, "15m": 30_000 };
const candleCache = new Map<string, { exp: number; value: { data: Candle[]; source: string } }>();
const inflight = new Map<string, Promise<{ data: Candle[]; source: string }>>();
/** Sources that refused us (e.g. a region block) are skipped for a while. */
const sourceDownUntil = new Map<string, number>();

function markDown(source: string, e: unknown) {
  const status = (e as { status?: number }).status;
  if (status === 451 || status === 403 || status === 429) {
    sourceDownUntil.set(source, Date.now() + (status === 429 ? 2 : 30) * 60_000);
  }
}

/**
 * Hedged fetch: sources are tried in preference order, but the next one
 * starts if the current one is slow, and the first good answer in preference
 * order wins. Results are cached per market and timeframe.
 */
async function candles(
  inst: Instrument,
  interval: Interval,
): Promise<{ data: Candle[]; source: string }> {
  const key = `${inst.code}:${interval}`;
  const hit = candleCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const running = inflight.get(key);
  if (running) return running;

  const limit = interval === "1d" ? 365 : interval === "1h" ? 1000 : 500;
  const tries: [string, () => Promise<Candle[]>][] = [];
  const { binance, kraken, yahoo } = inst;
  if (binance) tries.push(["Binance", () => fromBinance(binance, interval, limit)]);
  if (kraken) tries.push(["Kraken", () => fromKraken(kraken, interval)]);
  if (yahoo) tries.push(["Yahoo Finance", () => fromYahoo(yahoo, interval)]);
  const live = tries.filter(([src]) => (sourceDownUntil.get(src) ?? 0) < Date.now());
  const order = live.length ? live : tries;

  const job = (async () => {
    const results: Promise<Candle[] | null>[] = [];
    const start = (i: number) => {
      const [source, run] = order[i];
      results[i] = run()
        .then((d) => (d.length >= 60 ? d : null))
        .catch((e) => {
          markDown(source, e);
          console.warn(`[trade] ${source} ${inst.code} ${interval} failed:`, (e as Error).message);
          return null;
        });
      return results[i];
    };
    for (let i = 0; i < order.length; i++) {
      const p = start(i);
      // Wait for this source, but no longer than the hedge delay before
      // starting the next one (unless it's the last).
      const settled = await Promise.race([
        p.then((d) => ({ done: true as const, d })),
        new Promise<{ done: false }>((r) =>
          setTimeout(
            () => r({ done: false }),
            i === order.length - 1 ? TIMEOUT_MS + 500 : HEDGE_MS,
          ),
        ),
      ]);
      if (settled.done && settled.d) return { data: settled.d, source: order[i][0] };
    }
    // Everything has started; take the first good answer in preference order.
    for (let i = 0; i < results.length; i++) {
      const d = await results[i];
      if (d) return { data: d, source: order[i][0] };
    }
    return { data: [] as Candle[], source: "" };
  })();

  inflight.set(key, job);
  try {
    const value = await job;
    if (value.data.length) candleCache.set(key, { exp: Date.now() + CANDLE_TTL[interval], value });
    return value;
  } finally {
    inflight.delete(key);
  }
}

const newsCache = new Map<string, { exp: number; value: string | null }>();

async function marketNews(inst: Instrument): Promise<string | null> {
  if (!inst.yahoo) return null;
  const hit = newsCache.get(inst.code);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fetchNews(inst.yahoo);
  newsCache.set(inst.code, { exp: Date.now() + (value ? 10 : 2) * 60_000, value });
  return value;
}

/** Top 3 Yahoo Finance headlines for the market. Soft-fails to null. */
async function fetchNews(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=3&quotesCount=0`,
      { headers: UA, signal: AbortSignal.timeout(NEWS_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as {
      news?: { title?: string; publisher?: string; providerPublishTime?: number }[];
    };
    const items = (json.news ?? []).filter((n) => n.title).slice(0, 3);
    if (!items.length) return null;
    return items
      .map((n, i) => {
        const when = n.providerPublishTime
          ? ` (${new Date(n.providerPublishTime * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC)`
          : "";
        return `${i + 1}. ${n.title}${n.publisher ? `, ${n.publisher}` : ""}${when}`;
      })
      .join("\n");
  } catch {
    return null;
  }
}

type TradeSignalResult = { block: string; expiresAt: string | null; reply: string };
const cache = new Map<string, TradeSignalResult & { exp: number }>();

function frameLine(f: FrameRead, fmt: (n: number) => string): string {
  const e200 = Number.isFinite(f.ema200) ? `, 200 EMA ${fmt(f.ema200)}` : "";
  return `${f.name}: ${f.bias} (close ${fmt(f.close)}, 20 EMA ${fmt(f.ema20)}, 50 EMA ${fmt(f.ema50)}${e200}), RSI ${f.rsi.toFixed(0)}, ATR ${fmt(f.atr)}, MACD histogram ${f.macdHist >= 0 ? "+" : "−"} and ${f.macdRising ? "rising" : "falling"}`;
}

const HOW_TO_ANSWER = `TRADE SIGNAL MODE — the user wants a trade call. Rules:
- The user has already had an instant "hold on, checking the charts" message. Don't repeat that; open straight with the signal card.
- Use ONLY the prices, levels, confidence and times in the LIVE MARKET DATA block. Copy them exactly; never invent, round differently or "adjust" a price, stop, target, percentage or time.
- Always give the most likely direction. Lay it out as a clean signal card first (plain lines, no tables, no markdown headers):
  📊 PAIR — BUY or SELL
  Confidence: …% (Low/Medium/High)
  Entry: … (say if it's market or a pullback limit)
  SL: … (distance in pips/points if given)
  TP1 / TP2 / TP3: …
  R:R: …
  ⏳ Valid until: … (UK time) — say plainly that after this time the signal is stale and they should ask you again, and that an unfilled pullback entry should be cancelled by then.
  Then 2–4 short lines on WHY (trend across timeframes, momentum, the key level), what would cancel it early, and any news risk from the headlines given.
- If a CAUTION line is given, say the timeframes are mixed so it's a lean, and to go smaller.
- Explain that the confidence is how strongly the indicators agree, not a guaranteed win rate.
- Keep your usual voice for the commentary, but the numbers stay serious and exact.
- End with ONE short line: risk 1–2% per trade, move SL to entry after TP1, not financial advice. Don't lecture beyond that.
- Never claim a win rate, guarantee, or that you "know" where price is going.`;

const NO_DATA = (inst: Instrument) =>
  `TRADE SIGNAL MODE — the user asked about ${inst.label}, but live prices could not be loaded right now. Tell them straight that you can't pull a live chart for ${inst.label} this second, so you won't make up entry, stop or target levels. Offer a general read only if you're sure of it, and ask them to try again in a minute. Never invent current prices.`;

/**
 * Prompt block for a trade-signal question, or "" when the message isn't one.
 * Cached for 60s per market and style so a busy chat doesn't hammer the feeds.
 */
export async function buildTradeSignalContext(userText: string): Promise<string> {
  return (await buildTradeSignal(userText)).block;
}

/**
 * The prompt block plus when the signal stops being valid (null when no
 * signal was built), so the app can expire it at exactly the stated time.
 */
export async function buildTradeSignal(
  userText: string,
): Promise<TradeSignalResult> {
  const inst = detectTradeIntent(userText);
  if (!inst) return { block: "", expiresAt: null, reply: "" };
  const style: Style = detectStyle(userText);
  const key = `${inst.code}:${style}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return { block: hit.block, expiresAt: hit.expiresAt, reply: hit.reply };

  const entryIv: Interval = style === "scalp" ? "15m" : "1h";
  const [daily, hourly, fifteen, news] = await Promise.all([
    candles(inst, "1d"),
    candles(inst, "1h"),
    style === "scalp"
      ? candles(inst, "15m")
      : Promise.resolve({ data: [] as Candle[], source: "" }),
    marketNews(inst),
  ]);

  const h4 = aggregate(hourly.data, 4);
  let frames: [FrameRead | null, FrameRead | null, FrameRead | null];
  let entryCandles: Candle[];
  let middleCandles: Candle[];
  if (style === "swing") {
    frames = [
      readFrame("Weekly", aggregate(daily.data, 24 * 7)),
      readFrame("Daily", daily.data),
      readFrame("4H", h4),
    ];
    entryCandles = h4;
    middleCandles = daily.data;
  } else if (style === "scalp") {
    frames = [readFrame("4H", h4), readFrame("1H", hourly.data), readFrame("15M", fifteen.data)];
    entryCandles = fifteen.data;
    middleCandles = hourly.data;
  } else {
    frames = [readFrame("Daily", daily.data), readFrame("4H", h4), readFrame("1H", hourly.data)];
    entryCandles = hourly.data;
    middleCandles = h4;
  }
  // Weekly needs a year of dailies; fall back to Daily/4H/1H if it's short.
  if (style === "swing" && !frames[0]) {
    frames = [readFrame("Daily", daily.data), readFrame("4H", h4), readFrame("1H", hourly.data)];
    entryCandles = hourly.data;
    middleCandles = h4;
  }

  const [hi, mid, lo] = frames;
  if (!hi || !mid || !lo) {
    const value = NO_DATA(inst);
    const result = {
      block: value,
      expiresAt: null,
      reply: `I can't pull a live chart for ${inst.label} right now, so I won't make up entry, stop or target levels. Try again in a minute.`,
    };
    cache.set(key, { exp: Date.now() + 30_000, ...result });
    return result;
  }

  const plan = buildPlan(hi, mid, lo, entryCandles, middleCandles);
  const price = lo.close;
  const dp = decimalsFor(inst, price);
  const fmt = (n: number) =>
    n.toLocaleString("en-GB", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
      useGrouping: false,
    });
  const dist = (a: number, b: number) =>
    inst.pip ? `${(Math.abs(a - b) / inst.pip).toFixed(0)} pips` : `${fmt(Math.abs(a - b))} points`;

  const lastDay = daily.data[daily.data.length - 1];
  const prevDay = daily.data[daily.data.length - 2];
  const change = prevDay ? ((price - prevDay.c) / prevDay.c) * 100 : NaN;
  const asOf = new Date(entryCandles[entryCandles.length - 1]?.t ?? Date.now())
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const source = [hourly.source || daily.source, inst.sourceNote].filter(Boolean).join("; ");

  const lines = [
    `LIVE MARKET DATA — ${inst.label} (${style} view, entry timeframe ${entryIv === "15m" ? "15M" : style === "swing" ? "4H" : "1H"}; source: ${source}; last candle ${asOf} UTC)`,
    `Price now: ${fmt(price)}${Number.isFinite(change) ? ` (${change >= 0 ? "+" : ""}${change.toFixed(2)}% vs yesterday's close)` : ""}${lastDay ? `, today's range ${fmt(lastDay.l)} – ${fmt(lastDay.h)}` : ""}`,
    frameLine(hi, fmt),
    frameLine(mid, fmt),
    frameLine(lo, fmt),
    `Resistance: ${plan.resistance.map(fmt).join(", ") || "none nearby"}`,
    `Support: ${plan.support.map(fmt).join(", ") || "none nearby"}`,
    "",
    `SIGNAL ENGINE (computed from the data above — quote these exactly):`,
    `Direction: ${plan.direction}`,
  ];
  const valid = validityWindow(style);
  const ukTime = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  lines.push(
    `Confidence: ${plan.confidencePct}% (${plan.confidence})`,
    ...(plan.caution ? [`CAUTION: ${plan.caution}`] : []),
    `Entry: ${fmt(plan.entry)} — ${plan.entryNote}`,
    `Stop loss: ${fmt(plan.stop)} (${dist(plan.entry, plan.stop)})`,
    `TP1: ${fmt(plan.targets[0])}  TP2: ${fmt(plan.targets[1])}  TP3: ${fmt(plan.targets[2])}`,
    `Risk:reward: ${plan.rr}`,
    `Valid until: ${ukTime(valid.until)} UK time (${style} signal, good for ${valid.hours} hours). After that the read is stale; cancel an unfilled entry and ask again.`,
    `Cancel early if: ${plan.invalidation}`,
  );
  lines.push(
    `Confluence score: ${plan.score} of ±${plan.maxScore}`,
    `Reasons: ${plan.reasons.join("; ")}`,
  );
  if (news)
    lines.push("", "MARKET HEADLINES (Yahoo Finance; for context and news risk only):", news);

  const value = `${HOW_TO_ANSWER}\n\n${lines.join("\n")}`;
  const expiresAt = valid.until.toISOString();
  // Telegram gets the engine's actual card, not model-authored levels or a refusal.
  const reply = [
    `📊 ${inst.label} — ${plan.direction}`,
    `Confidence: ${plan.confidencePct}% (${plan.confidence})`,
    `Entry: ${fmt(plan.entry)} — ${plan.entryNote}`,
    `SL: ${fmt(plan.stop)} (${dist(plan.entry, plan.stop)})`,
    `TP1: ${fmt(plan.targets[0])} / TP2: ${fmt(plan.targets[1])} / TP3: ${fmt(plan.targets[2])}`,
    `R:R: ${plan.rr}`,
    `⏳ Valid until: ${ukTime(valid.until)} UK time — this reply self-destructs by then. Cancel any unfilled entry and ask for a fresh signal.`,
    "",
    `Here's the chart read: ${plan.reasons.join("; ")}.`,
    ...(plan.caution ? [plan.caution] : []),
    `Cancel early if: ${plan.invalidation}.`,
    `Source: ${source}; last candle ${asOf} UTC.`,
    ...(news ? ["", `News risk:\n${news}`] : []),
    "",
    "Confidence measures indicator agreement, not a win rate or guarantee.",
    "Risk 1–2% per trade, move SL to entry after TP1. Not financial advice; don't chase losses.",
  ].join("\n");
  const result = { block: value, expiresAt, reply };
  cache.set(key, { exp: Date.now() + 60_000, ...result });
  const oldest = cache.keys().next().value;
  if (cache.size > 200 && oldest) cache.delete(oldest);
  return result;
}

/** How often the Telegram clean-up job runs (sports-guide-reminders cron). */
const SWEEP_MS = 5 * 60_000;

/**
 * When a Telegram signal reply should self-destruct: as the signal expires.
 * The clean-up job runs every 5 minutes, so the delete is scheduled one sweep
 * early to make sure the message is gone by the valid-until time.
 */
export function tradeReplyTtlMs(userText: string): number {
  const ms = validityWindow(detectStyle(userText)).hours * 3600_000;
  return Math.max(SWEEP_MS, ms - SWEEP_MS);
}

/** Telegram chat replies go out as plain text, so drop markdown emphasis. */
export function plainForTelegram(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
}
