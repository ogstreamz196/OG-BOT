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

let resolved: { raw: string; id: number | null } | null = null;

/**
 * The signals chat's numeric id. SIGNALS_CHANNEL_ID may be saved as digits or
 * as an @name; an @name is looked up once with the trade bot (getChat).
 */
export async function signalsChatId(): Promise<number | null> {
  const target = normaliseChannelId(process.env.SIGNALS_CHANNEL_ID);
  if (!target) return null;
  if (/^-?\d+$/.test(target)) return Number(target);
  if (resolved?.raw === target) return resolved.id;
  const res = await workerApi<{ id?: number }>("getChat", { chat_id: target });
  const id = res?.ok && typeof res.result?.id === "number" ? res.result.id : null;
  // Only a real answer is remembered; a failed lookup is tried again next time.
  if (id !== null) resolved = { raw: target, id };
  return id;
}

/** Whether this chat is the signals chat the alerts go to. */
export async function isSignalsChat(chatId: number | null | undefined): Promise<boolean> {
  if (chatId == null) return false;
  return (await signalsChatId()) === Number(chatId);
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
 * A new alert for `market` went out: deletes that pair's older finished alert cards and
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
    // The pair's cards, including ones posted before this table existed.
    const { data: cards } = await admin
      .from("trade_signals")
      .select("message_id, status")
      .eq("chat_id", chatId)
      .eq("market", market)
      .gte("created_at", new Date(Date.now() - 48 * 3_600_000).toISOString())
      .limit(100);
    // Signals still in play stay, with their updates, and keep being followed here.
    const { ACTIVE_STATUSES, oldSignalMessages } = await import("./trade-signal-outcome");
    const rows = (cards ?? []) as { message_id: number | null; status: string }[];
    const live = (r: { status: string }) => ACTIVE_STATUSES.includes(r.status as never);
    const old = oldSignalMessages({
      tracked: [...ids],
      active: rows.filter((r) => r.message_id && live(r)).map((r) => Number(r.message_id)),
      finished: rows.filter((r) => r.message_id && !live(r)).map((r) => Number(r.message_id)),
      keep: [keep],
    }).slice(-100);
    if (old.length) await workerApi("deleteMessages", { chat_id: chatId, message_ids: old });
    await admin
      .from("trade_signals")
      .update({ chat_id: null })
      .eq("chat_id", chatId)
      .eq("market", market)
      .not("status", "in", `(${ACTIVE_STATUSES.join(",")})`);
    if (old.length) await admin.from(TABLE).delete().eq("chat_id", chatId).in("message_id", old);
  } catch (e) {
    console.warn("[signals] clearing the older alert failed", (e as Error).message);
  }
}

/**
 * Sends today's score as the last message in the chat, replacing the old one.
 * Says what happened ("posted", or why not), for the watcher's response.
 */
export async function refreshScore(
  admin: Admin,
  chatId: number,
  now = Date.now(),
): Promise<string> {
  try {
    // Without the table the old scoreboard couldn't be removed: post none.
    const { error: missing } = await admin.from(TABLE).select("message_id").limit(1);
    if (missing) return "skipped: signal_chat_messages can't be read";
    const today = await todayScore(admin, now);
    if (today === null) return "skipped: signal_results can't be read";
    // The 70%+ record runs underneath, counted since the Boss last reset it.
    const { signalRecord, recordText } = await import("./signal-record.server");
    // Cached a minute: the scoreboard is refreshed after every alert and update.
    const { cached } = await import("./server-cache");
    const record = await cached("signal-record", 60_000, () => signalRecord(admin)).catch(
      () => null,
    );
    // Nothing closed today: just the record, no "nothing closed yet" line.
    const text = [today, record ? recordText(record) : ""].filter(Boolean).join("\n\n");
    if (!text) return "skipped: nothing to show yet";
    const sent = await workerApi<{ message_id?: number }>("sendMessage", {
      chat_id: chatId,
      text,
      disable_notification: true,
      disable_web_page_preview: true,
    });
    const id = sent?.ok ? sent.result?.message_id : undefined;
    if (!id) {
      const why = sent?.description ?? "no answer from Telegram";
      console.warn(`[signals] score not posted: ${why}`);
      return `failed: trade bot couldn't post (${why})`;
    }
    await trackSignalMessage(admin, chatId, id, null, "score");
    // Only the newest scoreboard stays (two refreshes at once settle on one).
    const { data: all, error } = await admin
      .from(TABLE)
      .select("message_id")
      .eq("chat_id", chatId)
      .eq("kind", "score");
    if (error) return "posted";
    const ids = ((all ?? []) as { message_id: number }[]).map((r) => Number(r.message_id));
    const newest = Math.max(id, ...ids);
    const old = ids.filter((m) => m !== newest).slice(-100);
    if (old.length) {
      await workerApi("deleteMessages", { chat_id: chatId, message_ids: old });
      await admin.from(TABLE).delete().eq("chat_id", chatId).in("message_id", old);
    }
    return "posted";
  } catch (e) {
    console.warn("[signals] score refresh failed", (e as Error).message);
    return `failed: ${(e as Error).message}`;
  }
}

/** At UK midnight the score starts a fresh day (called by the minute watcher). */
export async function rollScoreDay(admin: Admin, now = Date.now()): Promise<string> {
  if (!process.env.SIGNALS_CHANNEL_ID || !process.env.SIGNALS_BOT_TOKEN)
    return "skipped: signals bot or chat not set up";
  const chatId = await signalsChatId();
  if (chatId === null) return "skipped: the trade bot can't find the signals chat";
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("created_at")
      .eq("chat_id", chatId)
      .eq("kind", "score")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return "skipped: signal_chat_messages can't be read";
    const last = ((data ?? []) as { created_at: string }[])[0];
    // No score yet, or yesterday's still showing: post today's.
    if (!last || Date.parse(last.created_at) < ukDayStart(now))
      return await refreshScore(admin, chatId, now);
    return "up to date";
  } catch (e) {
    // Tried again next minute.
    return `failed: ${(e as Error).message}`;
  }
}
