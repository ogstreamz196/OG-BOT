// Places manual trades from the Copy Trader B0T's card (manual-trade-bot.server.ts).
// The Boss's (the partner's to-do #4, 2026-11-12) becomes a real signal in the
// signals chat, through the same pieces as an automatic alert (buildScanDeps:
// the trade bot's post, the follow that tracks it, the demo account and MT5
// hook), so the tracker follows it and every copier copies it at his lot; no
// gate, desk or concurrency checks. A member's (2026-11-22) is theirs alone:
// tracked by the same tracker, sent only to their own copier (feeds.owner),
// with updates in their private chat. Both carry a hidden stop (never on the
// broker's order book) and, when on, the hidden trailing stop (feeds.trail).
// Server only. Never throws.
import { buildManualTrade, MARKET_LABEL } from "./manual-trade";
import type { Draft } from "./manual-trade-bot.server";
import type { CopierKey } from "./copier-keys";

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
  trail?: boolean;
  /** Whose trade: the Boss's (in the signals chat) or the member's own. */
  own?: boolean;
}): string {
  return [
    `${o.direction === "BUY" ? "🟢" : "🔴"} ${o.market} ${o.direction} NOW (${MARKET_LABEL[o.market]})`,
    `🎯 Entry: ${o.fmt(o.entry)} (market)`,
    `🛑 Stop: ${o.fmt(o.stop)} (hidden: never on the order book)`,
    `💰 Take profit: ${o.fmt(o.tp)}`,
    ...(o.trail ? ["🫥 Hidden trailing stop on"] : []),
    o.own ? `✋ Your manual trade · ${o.lot} lot` : `✋ Manual trade by the Boss · ${o.lot} lot`,
  ].join("\n");
}

/**
 * The hidden stop and (when on) the hidden trailing stop on a manual trade's
 * feeds: the trail follows a stop's distance behind (the tracker's TRAIL: to
 * the entry once a full stop in profit, then a stop behind the best price),
 * closing at the target; the profit lock is replaced by it. Pure.
 */
export function manualFeeds(
  feeds: Record<string, unknown>,
  draft: Pick<Draft, "trail" | "sl">,
): Record<string, unknown> {
  const { lock: _lock, ...rest } = feeds;
  return draft.trail
    ? { ...rest, hiddenStop: true, trail: { risk: draft.sl } }
    : { ...feeds, hiddenStop: true };
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
      ...manualFeeds(plan.feeds, draft),
      // The test account mirrors the copier: the Boss's lot, unless the
      // copier wouldn't take it (paused, market off, at its most open).
      paper: await (async () => {
        const { mirrorCopier } = await import("./copy-mirror.server");
        const m = await mirrorCopier(admin, {
          market: plan.market,
          botLots: trade.lot,
          manual: true,
        });
        return {
          lots: m.lots,
          botLots: trade.lot,
          ...(balance != null ? { balance } : {}),
          why: m.why ?? "manual trade",
        };
      })(),
    };
    const card = manualCard({
      market: draft.market,
      direction: draft.direction,
      entry: plan.entry,
      stop: plan.stop,
      tp: plan.targets[0],
      lot: trade.lot,
      fmt,
      trail: draft.trail,
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

/**
 * A member's own manual trade: checked against their token (active, not
 * paused), built at the live price, sized by a fixed lot or a risk % of the
 * balance their copier last reported, posted in their private chat (post),
 * and tracked like any trade, but only their copier is sent it (feeds.owner).
 */
export async function placeOwnTrade(
  admin: Admin,
  o: {
    userId: string;
    chatId: number;
    botId: string;
    key: CopierKey;
    draft: Draft;
    post: (text: string) => Promise<number | null>;
  },
): Promise<{ ok: boolean; text: string }> {
  try {
    const { isExpired } = await import("./copier-keys");
    if (o.key.revoked) return { ok: false, text: "⚠️ Your OG SIGNAL BOT is switched off." };
    if (isExpired(o.key, Date.now()))
      return { ok: false, text: "⚠️ Your access has run out. Renew at ogbot.co.uk/copier." };
    if (o.key.paused)
      return { ok: false, text: "⚠️ You've paused new trades. Resume them on 📟 My copier first." };
    const { buildTradeSignal } = await import("./trade-signal-context.server");
    const { signalRequest } = await import("./telegram-signals");
    const draft = o.draft;
    const signal = await buildTradeSignal(
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
    const balance = o.key.balance ?? null;
    if (!draft.lot && !(balance && balance > 0))
      return {
        ok: false,
        text: "⚠️ Not placed: risk % needs your copier's balance. Start it once, or pick a lot.",
      };
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
      ...manualFeeds(plan.feeds, draft),
      owner: o.key.id,
      paper: { lots: trade.lot, why: "your manual trade" },
    };
    const card = manualCard({
      market: draft.market,
      direction: draft.direction,
      entry: plan.entry,
      stop: plan.stop,
      tp: plan.targets[0],
      lot: trade.lot,
      fmt,
      trail: draft.trail,
      own: true,
    });
    const messageId = await o.post(card);
    const { recordSignal } = await import("./trade-signal-tracker.server");
    await recordSignal({
      userId: o.userId,
      senderWorker: o.botId,
      chatId: o.chatId,
      messageId,
      card,
      plan,
    });
    await admin
      .from("boss_audit_log")
      .insert({
        actor_id: o.userId,
        action: "member_manual_trade",
        category: "signals",
        target_key: `${plan.market} ${plan.direction}`,
        metadata: {
          key: o.key.id,
          lot: trade.lot,
          entry: plan.entry,
          stop: plan.stop,
          tp: plan.targets[0],
          trail: draft.trail,
        },
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return {
      ok: true,
      text: `✅ Placed: ${MARKET_LABEL[draft.market]} ${draft.direction} ${trade.lot} lot at ${fmt(plan.entry)}, stop ${fmt(plan.stop)}, target ${fmt(plan.targets[0])}${draft.trail ? ", hidden trailing stop on" : ""}. Your copier opens it on its next check (keep it running).`,
    };
  } catch (e) {
    console.warn("[manual-trade] member trade failed", e instanceof Error ? e.message : "error");
    return { ok: false, text: "⚠️ Something went wrong placing it. Nothing was placed." };
  }
}

/* ── The card in the Copy Trader B0T (the Boss and members, same card) ────── */

type Panel = { text: string; reply_markup: { inline_keyboard: unknown[][] } };

type Trader =
  | { scope: "group"; draftKey: string }
  | { scope: "own"; draftKey: string; userId: string; key: CopierKey };

/** Who's using the card: the Boss (his trades go to the group) or a member with a token. */
async function traderOf(admin: Admin, chatId: number): Promise<Trader | null> {
  const bot = await import("./manual-trade-bot.server");
  const { isBossChat } = await import("./copy-settings-bot.server");
  if ((await isBossChat(admin, chatId).catch(() => ({ ok: false }))).ok)
    return { scope: "group", draftKey: bot.DRAFT_KEY };
  const { memberKeyForChat } = await import("./copier-keys.server");
  const m = await memberKeyForChat(admin, chatId).catch(() => null);
  return m ? { scope: "own", draftKey: `${bot.DRAFT_KEY}.${m.key.id}`, ...m } : null;
}

async function draftAndBalance(admin: Admin, who: Trader) {
  const bot = await import("./manual-trade-bot.server");
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", who.draftKey)
    .maybeSingle();
  const draft = bot.parseDraft((data as { value?: string } | null)?.value);
  if (who.scope === "own") return { bot, draft, balance: who.key.balance ?? null };
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

/**
 * "/trade" or the ✋ Manual trade button: the card, the same for the Boss and
 * for members with a token. Null for anyone else.
 */
export async function manualTradeReply(
  admin: Admin,
  chatId: number,
  text: string,
): Promise<Panel | null> {
  const t = text.trim();
  const { MANUAL_BUTTON } = await import("./manual-trade-bot.server");
  if (t !== MANUAL_BUTTON && !/^\/trade(?:@\w+)?$/i.test(t)) return null;
  const who = await traderOf(admin, chatId);
  if (!who) return null;
  const { bot, draft, balance } = await draftAndBalance(admin, who);
  const fresh = { ...draft, confirming: false };
  await saveDraft(admin, who.draftKey, fresh);
  return {
    text: bot.manualText(fresh, balance, undefined, who.scope),
    reply_markup: bot.manualKeyboard(fresh),
  };
}

/**
 * A tap on the manual trade card ("mt:…"): the toast and the card to show.
 * The Boss's trade goes to the signals chat; a member's to their own copier,
 * with its card posted in their chat (where: the copy bot and the chat).
 */
export async function manualTradeTap(
  admin: Admin,
  fromId: number,
  data: string,
  where?: { botId: string; chatId: number; post: (text: string) => Promise<number | null> },
): Promise<{ toast: string; panel: Panel | null }> {
  const who = await traderOf(admin, fromId);
  if (!who)
    return { toast: "Get the OG SIGNAL BOT at ogbot.co.uk/copier to place trades.", panel: null };
  const { bot, draft, balance } = await draftAndBalance(admin, who);
  if (data === "mt:noop") return { toast: "", panel: null };
  const res = bot.applyManualTap(draft, data);
  if (!res.draft) {
    await saveDraft(admin, who.draftKey, { ...draft, confirming: false });
    return {
      toast: res.toast,
      panel: {
        text: "✋ Manual trade cancelled. Nothing was placed.",
        reply_markup: { inline_keyboard: [] },
      },
    };
  }
  await saveDraft(admin, who.draftKey, res.draft);
  if (res.place) {
    const placed =
      who.scope === "group"
        ? await placeManualTrade(admin, res.draft)
        : where
          ? await placeOwnTrade(admin, {
              userId: who.userId,
              chatId: where.chatId,
              botId: where.botId,
              key: who.key,
              draft: res.draft,
              post: where.post,
            })
          : { ok: false, text: "⚠️ Not placed. Try again." };
    return {
      toast: placed.ok ? "✅ Placed" : "⚠️ Not placed",
      panel: {
        text: bot.manualText(res.draft, balance, placed.text, who.scope),
        reply_markup: bot.manualKeyboard(res.draft),
      },
    };
  }
  return {
    toast: res.toast,
    panel: {
      text: bot.manualText(res.draft, balance, undefined, who.scope),
      reply_markup: bot.manualKeyboard(res.draft),
    },
  };
}
