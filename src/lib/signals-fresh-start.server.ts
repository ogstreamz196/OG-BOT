// A fresh start for the signals chat, run once by the Boss (POST
// /api/public/signal-scan {"freshStart": true}): every message the bots can
// still delete there goes (Telegram only lets bots delete messages under 48
// hours old), the 70%+ record restarts from zero, the test account starts at
// the chosen balance, and the chat gets the Boss's Vantage invite and a note
// saying the test has begun. Then the normal signal flow carries on, every
// alert showing the test account's balance (paper-account.server.ts).
import { INVITE_LINK } from "./invite-promo.server";

type Admin = any;

/** How far back (in message ids) the sweep reaches. */
const SWEEP = 2000;

const usd = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const VANTAGE_INTRO =
  "🚀 This is the broker I trade every one of these signals on: Vantage. Open your account through the button below and you're taking the same trades I take. Standard account, same spreads as mine.";

export function testModeNote(start: number): string {
  return (
    `🧪 TEST MODE starts now. I'm putting ${usd(start)} on a fresh Vantage Standard account and trading every alert in here with it: 0.1 lot a trade, and 0.3 when I'm properly sure of a quick scalp. ` +
    "Spreads counted, no commission on Standard, no fiddling the numbers. Every card shows the balance as it stands. Let's see how we do."
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

  // 2. Forget what was posted there: running trades carry on quietly (their
  //    cards are gone), live alerts stop blocking new ones.
  const at = new Date(now).toISOString();
  await admin.from("signal_chat_messages").delete().eq("chat_id", chatId);
  await admin.from("trade_signals").update({ chat_id: null }).eq("chat_id", chatId);
  await admin.from("signal_broadcasts").update({ expires_at: at }).gt("expires_at", at);

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
