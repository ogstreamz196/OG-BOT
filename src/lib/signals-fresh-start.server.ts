// A fresh start for the signals chat, from the Boss's Purge button (Boss →
// OG Bot → Telegram) or POST /api/public/signal-scan {"freshStart": true}:
// every message the bots can still delete there goes (Telegram only lets bots
// delete messages under 48 hours old), every counter restarts (the 70%+
// record, the results post, the test account at the chosen balance), and the
// chat gets the Boss's Vantage invite and a note saying the test has begun.
// No stored data is deleted or changed: the purge time is noted
// (signals.chat.purgedAt) and older trades stay quiet in the chat while the
// AI keeps learning from them. Then the normal signal flow carries on, every
// alert showing the test account's balance (paper-account.server.ts).
import { INVITE_LINK } from "./invite-promo.server";

type Admin = any;

/** How far back (in message ids) the sweep reaches. */
const SWEEP = 2000;

/** Money with cents only when there are cents: $1,000, $1,042.30. */
const usd = (n: number) =>
  `$${n
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\.00$/, "")}`;

export const VANTAGE_INTRO =
  "🚀 This is the broker I trade every one of these signals on: Vantage. Open your account through the button below and you're taking the same trades I take. Standard account, same spreads as mine.";

export function testModeNote(start: number): string {
  return (
    `🧪 TEST MODE starts now. I'm putting ${usd(start)} on a fresh Vantage Standard account and trading every alert in here with it: 0.05 to 0.3 lot a trade, bigger when I'm properly sure and my calls like it have been paying, smaller after a loss. ` +
    "Spreads counted, no commission on Standard, no fiddling the numbers. The results at the bottom of the chat show the balance as it stands. Let's see how we do."
  );
}

export async function freshStart(
  admin: Admin,
  start: number,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const { signalsChatId } = await import("./signal-chat.server");
  const { workerApi } = await import("./telegram-worker.server");
  const chatId = await signalsChatId();
  if (chatId === null) return { ok: false, why: "the trade bot can't find the signals chat" };

  // 1. Clear the chat: a marker message tells us the latest id, then every id
  //    before it is swept in batches of 100 (missing ones are skipped).
  const marker = await workerApi<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text: "🧹 Clearing the decks…",
    disable_notification: true,
  });
  const last = marker?.ok ? Number(marker.result?.message_id) : NaN;
  if (!Number.isFinite(last))
    return {
      ok: false,
      why: `can't post in the signals chat (${marker?.description ?? "no answer"})`,
    };
  let swept = 0;
  let refused: string | null = null;
  for (let to = last; to > Math.max(0, last - SWEEP); to -= 100) {
    const ids = Array.from({ length: 100 }, (_, i) => to - i).filter((id) => id > 0);
    const res = await workerApi("deleteMessages", { chat_id: chatId, message_ids: ids });
    if (res?.ok) swept += ids.length;
    else refused ??= res?.description ?? "no answer";
  }

  // 2. Nothing stored is deleted or changed (the AI keeps learning from
  //    every past trade): the purge time is noted, and from now on what came
  //    before it stays quiet in the chat and stops counting there.
  const at = new Date(now).toISOString();
  const { PURGED_KEY } = await import("./signal-chat.server");
  await admin
    .from("site_content")
    .upsert({ key: PURGED_KEY, value: at, updated_at: at }, { onConflict: "key" });
  const { forgetCached } = await import("./server-cache");
  forgetCached("signals-chat-purged");

  // 3. The record from zero, and the test account at the start balance.
  const { data: owner } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  const { resetSignalRecord } = await import("./signal-record.server");
  const resetAt = owner ? await resetSignalRecord(admin, owner.user_id).catch(() => null) : null;
  const { startPaper } = await import("./paper-account.server");
  await startPaper(admin, start, now);
  // Standard STP: no commission, the spread is the whole cost (measured live).
  const { COMMISSION_KEY } = await import("./broker-quotes.server");
  await admin
    .from("site_content")
    .upsert({ key: COMMISSION_KEY, value: "0", updated_at: at }, { onConflict: "key" });

  // 4. The Boss's Vantage invite, then the test-mode note. The invite isn't
  //    the rotating promo, so the next promo won't delete it; the promo's
  //    clock restarts so it doesn't land straight after.
  const intro = await workerApi<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text: VANTAGE_INTRO,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 Open your Vantage account", url: INVITE_LINK }]],
    },
  });
  await admin
    .from("site_content")
    .upsert({ key: "promo.invite.lastAt", value: at, updated_at: at }, { onConflict: "key" });
  const note = await workerApi<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text: testModeNote(start),
    disable_web_page_preview: true,
  });

  // 5. The results post, from zero, at the bottom.
  const { refreshScore } = await import("./signal-chat.server");
  const score = await refreshScore(admin, chatId).catch(() => "failed");

  return {
    ok: true,
    swept,
    ...(refused ? { deleteRefused: refused } : {}),
    recordResetAt: resetAt,
    testAccount: { start, startedAt: at },
    vantageMessage: !!intro?.ok,
    testModeMessage: !!note?.ok,
    score,
  };
}

/**
 * Starts the demo account without a fresh start: the chat, the win/loss
 * counter and every past trade stay as they are. Starts the test account at
 * `start`, sets commission to 0 (Standard STP), has OG B0T post its "money
 * where my mouth is" announcement once, then refreshes the results post,
 * which shows the demo balance from then on. Refuses if a test account is
 * already running, so it only ever happens once.
 */
export async function demoStart(
  admin: Admin,
  start: number,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const pa = await import("./paper-account.server");
  const running = await pa.paperState(admin);
  if (running)
    return {
      ok: false,
      why: `the demo is already running (started ${running.startedAt} with $${running.start})`,
    };
  const { signalsChatId } = await import("./signal-chat.server");
  const chatId = await signalsChatId();
  if (chatId === null) return { ok: false, why: "the trade bot can't find the signals chat" };

  const at = new Date(now).toISOString();
  await pa.startPaper(admin, start, now);
  const { COMMISSION_KEY } = await import("./broker-quotes.server");
  await admin
    .from("site_content")
    .upsert({ key: COMMISSION_KEY, value: "0", updated_at: at }, { onConflict: "key" });

  // OG B0T says it (the trade bot only if OG B0T can't post there).
  const { telegramApi } = await import("./telegram-api.server");
  const { workerApi } = await import("./telegram-worker.server");
  const message = {
    chat_id: chatId,
    text: pa.demoAnnouncement(start),
    disable_web_page_preview: true,
  };
  let sent = await telegramApi<{ message_id?: number }>("sendMessage", message);
  if (!sent?.ok) sent = await workerApi<{ message_id?: number }>("sendMessage", message);

  const { refreshScore } = await import("./signal-chat.server");
  const { forgetCached } = await import("./server-cache");
  forgetCached("signal-record");
  const score = await refreshScore(admin, chatId).catch(() => "failed");
  return { ok: true, testAccount: { start, startedAt: at }, announced: !!sent?.ok, score };
}
