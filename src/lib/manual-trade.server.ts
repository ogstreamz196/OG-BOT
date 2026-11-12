// Places the Boss's manual trade (the partner's to-do #4, 2026-11-12): the
// draft from the Copy Trader B0T's card (manual-trade-bot.server.ts) becomes a
// real signal in the signals chat, through the same pieces as an automatic
// alert (buildScanDeps: the trade bot's post, the follow that tracks it, the
// demo account and MT5 hook), so the tracker follows it and every copier
// copies it at the Boss's lot. The Boss's own call: no gate, desk or
// concurrency checks. Server only. Never throws.
import { buildManualTrade, MARKET_LABEL } from "./manual-trade";
import type { Draft } from "./manual-trade-bot.server";

type Admin = any;

const PAIR = { XAUUSD: "XAU", BTCUSD: "BTC" } as const;

/** The card posted in the signals chat for a manual trade. Pure. */
export function manualCard(o: {
  market: "XAUUSD" | "BTCUSD";
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp: number;
  lot: number;
  fmt: (n: number) => string;
}): string {
  return [
    `${o.direction === "BUY" ? "🟢" : "🔴"} ${o.market} ${o.direction} NOW (${MARKET_LABEL[o.market]})`,
    `🎯 Entry: ${o.fmt(o.entry)} (market)`,
    `🛑 Stop: ${o.fmt(o.stop)}`,
    `💰 Take profit: ${o.fmt(o.tp)}`,
    `✋ Manual trade by the Boss · ${o.lot} lot`,
  ].join("\n");
}

export async function placeManualTrade(
  admin: Admin,
  draft: Draft,
): Promise<{ ok: boolean; text: string }> {
  try {
    const { signalsChannelReady } = await import("./signal-broadcast.server");
    if (!signalsChannelReady()) return { ok: false, text: "⚠️ The signals chat isn't set up." };
    const sc = await import("./signal-chat.server");
    const chatId = await sc.signalsChatId();
    if (chatId === null) return { ok: false, text: "⚠️ Can't find the signals chat." };
    // Golden rule: never post into a group OG B0T isn't in (channels are fine).
    const { managedGroup } = await import("./telegram-worker.server");
    const group = await managedGroup(admin, chatId);
    if (group && group.chat_type !== "channel" && !group.og_bot_present)
      return { ok: false, text: "⚠️ OG B0T isn't in the signals group, so nothing was posted." };

    const { buildScanDeps } = await import("./signal-scan.server");
    const deps = await buildScanDeps(admin, { chatId, startedAt: Date.now() });
    const { signalRequest } = await import("./telegram-signals");
    const signal = await deps.build(
      `${signalRequest(PAIR[draft.market], "5m")} manual:${draft.direction}:${draft.sl}:${draft.tp}`,
    );
    const plan = signal.plan as
      | (import("./trade-signal-context.server").SignalPlan & { feeds: Record<string, unknown> })
      | undefined;
    if (!plan?.feeds?.manual)
      return {
        ok: false,
        text: `⚠️ Not placed: ${signal.summary?.waitReason ?? "no confirmed price right now"}.`,
      };

    // The lot: the Boss's fixed lot, or the risk % of the test account.
    const pa = await import("./paper-account.server");
    const state = await pa.paperState(admin).catch(() => null);
    const balance = state ? await pa.paperBalance(admin, state).catch(() => null) : null;
    const trade = buildManualTrade({
      market: draft.market,
      direction: draft.direction,
      price: plan.entry,
      slDistance: draft.sl,
      tpDistance: draft.tp,
      ...(draft.lot ? { lot: draft.lot } : { riskPct: draft.riskPct ?? 1, balance: balance ?? 0 }),
    });
    if (!trade)
      return {
        ok: false,
        text: "⚠️ Not placed: that risk is too small for 0.01 lot at this stop.",
      };

    const dp = Number(plan.decimals) || 2;
    const fmt = (n: number) =>
      n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    plan.feeds = {
      ...plan.feeds,
      paper: { lots: trade.lot, ...(balance != null ? { balance } : {}), why: "manual trade" },
    };
    const card = manualCard({
      market: draft.market,
      direction: draft.direction,
      entry: plan.entry,
      stop: plan.stop,
      tp: plan.targets[0],
      lot: trade.lot,
      fmt,
    });
    const messageId = await deps.post(card);
    if (messageId === null)
      return { ok: false, text: "⚠️ Telegram didn't take the post. Try again." };
    await deps.follow({ ...signal, plan } as never, messageId, card);
    // Seen by the repeat and concurrency checks like any posted alert.
    await admin.from("signal_broadcasts").insert({
      market: plan.market,
      timeframe: "5M",
      direction: plan.direction,
      confidence_pct: plan.confidencePct,
      entry: plan.entry,
      expires_at: plan.expiresAt,
      message_id: messageId,
      created_at: new Date().toISOString(),
    });
    await admin
      .from("boss_audit_log")
      .insert({
        action: "manual_trade",
        category: "signals",
        target_key: `${plan.market} ${plan.direction}`,
        metadata: { lot: trade.lot, entry: plan.entry, stop: plan.stop, tp: plan.targets[0] },
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return {
      ok: true,
      text: `✅ Placed: ${MARKET_LABEL[draft.market]} ${draft.direction} ${trade.lot} lot at ${fmt(plan.entry)}, stop ${fmt(plan.stop)}, target ${fmt(plan.targets[0])}. It's in the signals chat and the copiers are taking it.`,
    };
  } catch (e) {
    console.warn("[manual-trade] failed", e instanceof Error ? e.message : "error");
    return { ok: false, text: "⚠️ Something went wrong placing it. Nothing was posted." };
  }
}

/* ── The card in the Copy Trader B0T (Boss only) ──────────────────────────── */

type Panel = { text: string; reply_markup: { inline_keyboard: unknown[][] } };

async function draftAndBalance(admin: Admin) {
  const bot = await import("./manual-trade-bot.server");
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", bot.DRAFT_KEY)
    .maybeSingle();
  const draft = bot.parseDraft((data as { value?: string } | null)?.value);
  const pa = await import("./paper-account.server");
  const state = await pa.paperState(admin).catch(() => null);
  const balance = state ? await pa.paperBalance(admin, state).catch(() => null) : null;
  return { bot, draft, balance };
}

async function saveDraft(admin: Admin, key: string, draft: Draft) {
  const at = new Date().toISOString();
  await admin
    .from("site_content")
    .upsert({ key, value: JSON.stringify(draft), updated_at: at }, { onConflict: "key" });
}

/** "/trade" or the ✋ Manual trade button from the Boss: the card. Null for anyone else. */
export async function manualTradeReply(
  admin: Admin,
  chatId: number,
  text: string,
): Promise<Panel | null> {
  const t = text.trim();
  const { MANUAL_BUTTON } = await import("./manual-trade-bot.server");
  if (t !== MANUAL_BUTTON && !/^\/trade(?:@\w+)?$/i.test(t)) return null;
  const { isBossChat } = await import("./copy-settings-bot.server");
  if (!(await isBossChat(admin, chatId).catch(() => ({ ok: false }))).ok) return null;
  const { bot, draft, balance } = await draftAndBalance(admin);
  const fresh = { ...draft, confirming: false };
  await saveDraft(admin, bot.DRAFT_KEY, fresh);
  return { text: bot.manualText(fresh, balance), reply_markup: bot.manualKeyboard(fresh) };
}

/** A tap on the manual trade card ("mt:…"), Boss only: the toast and the card to show. */
export async function manualTradeTap(
  admin: Admin,
  fromId: number,
  data: string,
): Promise<{ toast: string; panel: Panel | null }> {
  const { isBossChat } = await import("./copy-settings-bot.server");
  const boss = await isBossChat(admin, fromId).catch(() => ({ ok: false }));
  if (!boss.ok) return { toast: "Only the Boss can place trades.", panel: null };
  const { bot, draft, balance } = await draftAndBalance(admin);
  if (data === "mt:noop") return { toast: "", panel: null };
  const res = bot.applyManualTap(draft, data);
  if (!res.draft) {
    await saveDraft(admin, bot.DRAFT_KEY, { ...draft, confirming: false });
    return {
      toast: res.toast,
      panel: {
        text: "✋ Manual trade cancelled. Nothing was placed.",
        reply_markup: { inline_keyboard: [] },
      },
    };
  }
  await saveDraft(admin, bot.DRAFT_KEY, res.draft);
  if (res.place) {
    const placed = await placeManualTrade(admin, res.draft);
    return {
      toast: placed.ok ? "✅ Placed" : "⚠️ Not placed",
      panel: {
        text: bot.manualText(res.draft, balance, placed.text),
        reply_markup: bot.manualKeyboard(res.draft),
      },
    };
  }
  return {
    toast: res.toast,
    panel: {
      text: bot.manualText(res.draft, balance),
      reply_markup: bot.manualKeyboard(res.draft),
    },
  };
}
