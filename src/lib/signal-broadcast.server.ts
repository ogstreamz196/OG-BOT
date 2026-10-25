/**
 * Auto-posted scalp signals. Every minute (pg_cron → /api/public/signal-scan)
 * the gold and bitcoin 5-minute scalps are built with the same engine as the
 * bot, and any that reach the top confidence score are posted to the signals
 * channel by the separate signals bot.
 *
 * Confidence is indicator agreement (see buildPlan in trade-signal.ts), never a
 * win rate, and it tops out at 90%: a 90% signal is one where every timeframe
 * agrees and nothing (chop, momentum against, light volume, a quiet session)
 * knocks points off.
 *
 * A market isn't posted again while its last post is still valid, unless the
 * new signal goes the other way. Needs the SIGNALS_BOT_TOKEN and
 * SIGNALS_CHANNEL_ID secrets; without them the scan does nothing.
 */
import { signalRequest, type SignalPair } from "@/lib/telegram-signals";

type Admin = any;

/** The lowest confidence that gets posted (90% is the engine's top score). */
export const BROADCAST_MIN_CONFIDENCE = 90;
export const BROADCAST_MARKETS: SignalPair[] = ["XAU", "BTC"];
const POSTS = "signal_broadcasts";

type Built = {
  reply: string;
  plan?: {
    market: string;
    label: string;
    direction: "BUY" | "SELL";
    confidencePct: number;
    entry: number;
    expiresAt: string;
  };
};

export type ScanDeps = {
  build: (ask: string) => Promise<Built>;
  /** Posts to the channel; resolves with the message id, or null if it didn't go. */
  post: (text: string) => Promise<number | null>;
  now: () => number;
};

/** The card as posted: nothing in the channel follows up, so it doesn't promise to. */
export function channelCard(reply: string, confidencePct: number): string {
  const card = reply.replace(/🔔 I'll update you here · /, "");
  return (
    `🚨 ${confidencePct}% SCALP ALERT\n\n${card}\n\n` +
    "Confidence = how many of the indicators agree, not a win rate."
  );
}

export async function scanAndBroadcast(
  admin: Admin,
  deps: ScanDeps,
): Promise<{ checked: number; posted: string[] }> {
  const posted: string[] = [];
  let checked = 0;
  for (const pair of BROADCAST_MARKETS) {
    let signal: Built;
    try {
      signal = await deps.build(signalRequest(pair, "5m"));
    } catch (e) {
      console.warn(`[signals] scan of ${pair} failed`, e);
      continue;
    }
    checked++;
    const plan = signal.plan;
    if (!plan || plan.confidencePct < BROADCAST_MIN_CONFIDENCE) continue;

    // Still-valid post for this market going the same way: don't repeat it.
    const nowIso = new Date(deps.now()).toISOString();
    const { data: live, error } = await admin
      .from(POSTS)
      .select("direction")
      .eq("market", plan.market)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1);
    // Without the table there's no way to tell repeats apart: post nothing.
    if (error) {
      console.warn("[signals] broadcast check failed", error.message);
      continue;
    }
    const last = ((live ?? []) as { direction: string }[])[0];
    if (last && last.direction === plan.direction) continue;

    const messageId = await deps.post(channelCard(signal.reply, plan.confidencePct));
    if (messageId === null) continue;
    await admin.from(POSTS).insert({
      market: plan.market,
      timeframe: "5M",
      direction: plan.direction,
      confidence_pct: plan.confidencePct,
      entry: plan.entry,
      expires_at: plan.expiresAt,
      message_id: messageId,
    });
    posted.push(`${plan.market} ${plan.direction}`);
  }
  return { checked, posted };
}

/** Posts to the signals channel with the signals bot. Null when not set up or it failed. */
export async function postToSignalsChannel(text: string): Promise<number | null> {
  const token = process.env.SIGNALS_BOT_TOKEN;
  const chatId = process.env.SIGNALS_CHANNEL_ID;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    } | null;
    if (!json?.ok) {
      // Never log the URL: it carries the token.
      console.error(`[signals] channel post failed: ${json?.description ?? res.status}`);
      return null;
    }
    return json.result?.message_id ?? null;
  } catch (e) {
    console.error("[signals] channel post failed", (e as Error).message);
    return null;
  }
}

export const signalsChannelReady = () =>
  !!process.env.SIGNALS_BOT_TOKEN && !!process.env.SIGNALS_CHANNEL_ID;
