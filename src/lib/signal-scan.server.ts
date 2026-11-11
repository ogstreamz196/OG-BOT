// The shared signal-scan deps, used by the minute cron route
// (src/routes/api/public/signal-scan.ts) and the Boss's manual "send a signal
// now" button (signal-send.functions.ts). Pulling the deps out here means both
// post through the exact same path — same gate, concurrency, desk confirm,
// tracking and MT5/copy follow — so a hand-triggered signal is posted and
// followed identically to an automatic one. Server only.
import type { ScanDeps } from "./signal-broadcast.server";

// Admin is `any` in signal-broadcast.server (the service-role client).
type Admin = any;

/**
 * Build the full set of scan deps (everything scanAndBroadcast / the desk / the
 * random poster need). `chatId` is the signals chat (null when not set up).
 * `startedAt` bounds how long the AI desk may be asked, as in the cron.
 */
export async function buildScanDeps(
  admin: Admin,
  opts: { chatId: number | null; startedAt: number },
) {
  const { chatId, startedAt } = opts;
  const sc = await import("./signal-chat.server");
  const { buildTradeSignal, deskRead, economicCalendar } =
    await import("./trade-signal-context.server");
  const { recordShadow } = await import("./signal-shadows.server");
  const { takeDeskRun } = await import("./signal-ai-budget.server");
  const { alertBar } = await import("./signal-alert-bar.server");
  const { deskConfirmer } = await import("./signal-broadcast.server");
  const { postToSignalsChannel } = await import("./signal-broadcast.server");

  type SignalPlan = import("./trade-signal-context.server").SignalPlan;

  const follow: NonNullable<ScanDeps["follow"]> = async (signal, messageId, card) => {
    if (!signal.plan || chatId === null) return;
    const { alertTiming } = await import("./signal-timing.server");
    const timing = await alertTiming(signal, Date.now()).catch(() => null);
    if (timing) signal.plan.feeds = { ...(signal.plan.feeds ?? {}), timing };
    await sc.clearOlderPair(admin, chatId, signal.plan.market, messageId);
    await sc.trackSignalMessage(admin, chatId, messageId, signal.plan.market, "card");
    await sc.refreshScore(admin, chatId);
    const { placeAutoTrade } = await import("./mt5-autotrade.server");
    await placeAutoTrade(admin, signal.plan as SignalPlan);
    const { data: owner } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (!owner) return;
    const { recordSignal } = await import("./trade-signal-tracker.server");
    await recordSignal({
      userId: owner.user_id,
      chatId,
      messageId,
      card,
      plan: signal.plan as SignalPlan,
      senderWorker: "trade",
    });
  };

  const budgeted = async (ask: string, onlyWithSignal: boolean) => {
    const s = await buildTradeSignal(ask);
    if (onlyWithSignal && !s.plan) return { signal: s, desk: null };
    if (!(await takeDeskRun(admin))) return { signal: s, desk: null };
    return deskRead(ask, { onlyWithSignal });
  };

  const paper: NonNullable<ScanDeps["paper"]> = async (s) => {
    const pa = await import("./paper-account.server");
    const state = await pa.paperState(admin);
    if (!state || !s.plan || !s.summary) return s;
    // The Boss's MT5 account when the copier's reporting it (the Boss,
    // 2026-11-11: "attach my mt5, copy same lot size"), else the test account.
    const { mt5Account, drawdownPct } = await import("./mt5-account.server");
    const mt5 = await mt5Account(admin);
    const balance = mt5 ? mt5.balance : await pa.paperBalance(admin, state);
    const big = pa.bigOne({
      confidencePct: s.plan.confidencePct,
      timeframe: s.summary.timeframe,
      desk: String(s.plan.feeds?.desk ?? ""),
    });
    const learned = await pa.lotInputs(admin, state, s.plan.market, s.plan.confidencePct);
    if (mt5) learned.drawdownPct = drawdownPct(mt5);
    const { lots, why } = pa.chooseLot({
      market: s.plan.market,
      entry: s.plan.entry,
      stop: s.summary.stop,
      balance,
      confidencePct: s.plan.confidencePct,
      big,
      ...learned,
    });
    const { CARD_LOT } = await import("./trade-bias");
    return {
      ...s,
      reply: [
        pa.rescaleCardMoney(s.reply, CARD_LOT, lots),
        ...pa.paperLines(balance, lots, why, mt5 ? "MT5 balance" : undefined),
      ].join("\n"),
      plan: { ...s.plan, feeds: { ...(s.plan.feeds ?? {}), paper: { lots, balance, why } } },
    };
  };

  const gate: NonNullable<ScanDeps["gate"]> = async (s) => {
    if (!s.plan || !s.summary) return null;
    const pa = await import("./paper-account.server");
    const rnd = await import("./signal-random.server");
    const { postDecision } = await import("./signal-gate");
    const { engineConfig } = await import("./engine-config.server");
    const cfg = await engineConfig();
    const state = await pa.paperState(admin);
    const learned = await pa.lotInputs(
      admin,
      state ?? { start: 0, startedAt: new Date().toISOString() },
      s.plan.market,
      s.plan.confidencePct,
    );
    const stats = await rnd.signalStats(admin);
    const strategy = rnd.strategyOf(s.plan.feeds ?? null);
    const chart = s.summary.timeframe.toLowerCase() as import("./signal-random.server").RandomFrame;
    const { data: lastPost } = await admin
      .from("trade_signals")
      .select("created_at")
      .eq("sender_worker", "trade")
      .order("created_at", { ascending: false })
      .limit(1);
    const lastAt = Date.parse(
      (lastPost as { created_at?: string }[] | null)?.[0]?.created_at ?? "",
    );
    const d = postDecision(
      {
        confidencePct: s.plan.confidencePct,
        ...learned,
        minutesSinceLastPost: Number.isFinite(lastAt) ? (Date.now() - lastAt) / 60_000 : null,
        strategy: stats.strategies[strategy],
        chart: stats.frames[chart],
        strategyName: rnd.STRATEGY_NAMES[strategy],
        chartName: `${s.summary.timeframe} chart`,
      },
      cfg.gate,
    );
    return d.post ? null : d.why;
  };

  const shadow: NonNullable<ScanDeps["shadow"]> = (s, why) => recordShadow(admin, s.summary, why);

  const confirm = deskConfirmer(admin, (ask) => budgeted(ask, false), {
    now: Date.now,
    askUntil: startedAt + 20_000,
    onVeto: (s) => recordShadow(admin, s.summary, "desk_no"),
    skipDesk: async (market) => {
      const { relaxedFilters } = await import("./signal-filter-learning.server");
      return (await relaxedFilters(market)).has("desk_no");
    },
  });

  return {
    build: buildTradeSignal,
    read: (ask: string) => budgeted(ask, true),
    news: economicCalendar,
    alertBar: (market: string) => alertBar(admin, market),
    post: postToSignalsChannel,
    follow,
    confirm,
    paper,
    gate,
    shadow,
    now: Date.now,
  };
}

const PAIR: Record<string, import("@/lib/telegram-signals").SignalPair> = {
  BTCUSD: "BTC",
  XAUUSD: "XAU",
};

/**
 * Boss: send a real signal for one market now, through the exact live path
 * (same gate, concurrency, desk confirm, tracking and MT5/copy follow as the
 * minute cron). Tries a few scalp frames in turn and stops at the first post;
 * if nothing passes the gate right now it posts nothing and says so.
 */
export async function runManualScan(
  admin: Admin,
  opts: { market: string; frames?: import("@/lib/telegram-signals").SignalTimeframe[] },
): Promise<{ ok: boolean; posted: string[]; checked: number; reason?: string }> {
  const pair = PAIR[opts.market];
  if (!pair) return { ok: false, posted: [], checked: 0, reason: "unknown_market" };
  const { scanAndBroadcast, signalsChannelReady } = await import("./signal-broadcast.server");
  if (!signalsChannelReady())
    return { ok: false, posted: [], checked: 0, reason: "not_configured" };
  const sc = await import("./signal-chat.server");
  const chatId = await sc.signalsChatId();
  // Golden rule: never post into a group OG B0T isn't in (channels are fine).
  if (chatId !== null) {
    const { managedGroup } = await import("./telegram-worker.server");
    const group = await managedGroup(admin, chatId);
    if (group && group.chat_type !== "channel" && !group.og_bot_present)
      return { ok: false, posted: [], checked: 0, reason: "gaffer_not_in_group" };
  }
  const deps = await buildScanDeps(admin, { chatId, startedAt: Date.now() });
  const frames = opts.frames ?? ["5m", "15m", "1h"];
  let checked = 0;
  for (const frame of frames) {
    const res = await scanAndBroadcast(admin, { ...deps, frames: [frame], markets: [pair] });
    checked += res.checked;
    if (res.posted.length) return { ok: true, posted: res.posted, checked };
  }
  return { ok: true, posted: [], checked };
}
