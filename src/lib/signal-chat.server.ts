/**
 * Keeps the signals chat (SIGNALS_CHANNEL_ID, where the OG Trade Bot posts
 * the top scalp alerts) clutter free:
 *
 * - A new alert for a pair deletes that pair's older alert and every update
 *   posted under it; the other pair's alert stays put.
 * - Today's score (wins, losses and pips, UK day) sits as the last message:
 *   after anything the signal flow posts there, the old scoreboard is deleted
 *   and a fresh one is sent underneath, and at midnight it starts a new day.
 *
 * Everything the flow posts there is remembered in signal_chat_messages
 * (card, update or score). Without that table the chat just isn't tidied.
 */
import { normaliseChannelId } from "./signal-broadcast.server";
import { todayScore, ukDayStart } from "./signal-results.server";
import { workerApi } from "./telegram-worker.server";

type Admin = any;
const TABLE = "signal_chat_messages";

/** Whether this chat is the signals chat the alerts go to. */
export function isSignalsChat(chatId: number | string | null | undefined): boolean {
  const target = normaliseChannelId(process.env.SIGNALS_CHANNEL_ID);
  return !!target && chatId != null && String(chatId) === target;
}

/** Remembers a message the signal flow posted in the signals chat. Never throws. */
export async function trackSignalMessage(
  admin: Admin,
  chatId: number,
  messageId: number,
  market: string | null,
  kind: "card" | "update" | "score",
) {
  try {
    await admin
      .from(TABLE)
      .upsert(
        { chat_id: chatId, message_id: messageId, market, kind },
        { onConflict: "chat_id,message_id" },
      );
  } catch {
    /* no table yet: nothing tidied */
  }
}

/**
 * A new alert for `market` went out: deletes that pair's older alert cards and
 * their updates, and stops the older signals messaging this chat (they're still
 * followed quietly, so their results still count).
 */
export async function clearOlderPair(admin: Admin, chatId: number, market: string, keep: number) {
  try {
    const ids = new Set<number>();
    const { data: tracked, error } = await admin
      .from(TABLE)
      .select("message_id")
      .eq("chat_id", chatId)
      .eq("market", market)
      .in("kind", ["card", "update"]);
    if (error) return;
    for (const r of (tracked ?? []) as { message_id: number }[]) ids.add(Number(r.message_id));
    // Cards posted before this table existed.
    const { data: cards } = await admin
      .from("trade_signals")
      .select("message_id")
      .eq("chat_id", chatId)
      .eq("market", market)
      .gte("created_at", new Date(Date.now() - 48 * 3_600_000).toISOString())
      .limit(100);
    for (const c of (cards ?? []) as { message_id: number | null }[])
      if (c.message_id) ids.add(Number(c.message_id));
    ids.delete(keep);
    const old = [...ids].slice(-100);
    if (old.length) await workerApi("deleteMessages", { chat_id: chatId, message_ids: old });
    await admin
      .from("trade_signals")
      .update({ chat_id: null })
      .eq("chat_id", chatId)
      .eq("market", market);
    if (old.length) await admin.from(TABLE).delete().eq("chat_id", chatId).in("message_id", old);
  } catch (e) {
    console.warn("[signals] clearing the older alert failed", (e as Error).message);
  }
}

/** Sends today's score as the last message in the chat, replacing the old one. */
export async function refreshScore(admin: Admin, chatId: number, now = Date.now()) {
  try {
    // Without the table the old scoreboard couldn't be removed: post none.
    const { error: missing } = await admin.from(TABLE).select("message_id").limit(1);
    if (missing) return;
    const text = await todayScore(admin, now);
    if (!text) return;
    const sent = await workerApi<{ message_id?: number }>("sendMessage", {
      chat_id: chatId,
      text,
      disable_notification: true,
      disable_web_page_preview: true,
    });
    const id = sent?.ok ? sent.result?.message_id : undefined;
    if (!id) return;
    await trackSignalMessage(admin, chatId, id, null, "score");
    // Only the newest scoreboard stays (two refreshes at once settle on one).
    const { data: all, error } = await admin
      .from(TABLE)
      .select("message_id")
      .eq("chat_id", chatId)
      .eq("kind", "score");
    if (error) return;
    const ids = ((all ?? []) as { message_id: number }[]).map((r) => Number(r.message_id));
    const newest = Math.max(id, ...ids);
    const old = ids.filter((m) => m !== newest).slice(-100);
    if (old.length) {
      await workerApi("deleteMessages", { chat_id: chatId, message_ids: old });
      await admin.from(TABLE).delete().eq("chat_id", chatId).in("message_id", old);
    }
  } catch (e) {
    console.warn("[signals] score refresh failed", (e as Error).message);
  }
}

/** At UK midnight the score starts a fresh day (called by the minute watcher). */
export async function rollScoreDay(admin: Admin, now = Date.now()) {
  const target = normaliseChannelId(process.env.SIGNALS_CHANNEL_ID);
  if (!target || !/^-?\d+$/.test(target) || !process.env.SIGNALS_BOT_TOKEN) return;
  const chatId = Number(target);
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("created_at")
      .eq("chat_id", chatId)
      .eq("kind", "score")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return;
    const last = ((data ?? []) as { created_at: string }[])[0];
    // No score yet, or yesterday's still showing: post today's.
    if (!last || Date.parse(last.created_at) < ukDayStart(now))
      await refreshScore(admin, chatId, now);
  } catch {
    /* tried again next minute */
  }
}
