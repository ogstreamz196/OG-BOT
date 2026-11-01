/**
 * Keeps the signals chat (SIGNALS_CHANNEL_ID, where the OG Trade Bot posts
 * the top scalp alerts) clutter free:
 *
 * - A new alert for a pair deletes that pair's older alert and every update
 *   posted under it; the other pair's alert stays put.
 * - The OG Trade Bot's results (its record and current streak, announced by
 *   OG B0T) sit as the last message: after anything the signal flow posts
 *   there, the old results post is deleted and a fresh one sent underneath.
 *
 * Everything the flow posts there is remembered in signal_chat_messages
 * (card, update or score). Without that table the chat just isn't tidied.
 */
import { normaliseChannelId } from "./signal-broadcast.server";
import { telegramApi } from "./telegram-api.server";
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
 * Posts the OG Trade Bot's results as the last message in the chat, replacing
 * the old post. OG B0T announces them; the trade bot only posts them when OG
 * B0T can't post there. Says what happened ("posted", or why not).
 */
/**
 * The Copy Trader B0T (worker fleet role "copy"), when one is switched on
 * and on duty in this chat (the worker golden rule), with a way to post as it.
 */
async function copyBot(admin: Admin, chatId: number) {
  try {
    const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
    if (!key) return null;
    const { data } = await admin
      .from("telegram_worker_bots")
      .select("id")
      .eq("role", "copy")
      .eq("enabled", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    const id = (data as { id?: string } | null)?.id;
    if (!id) return null;
    const f = await import("./telegram-fleet.server");
    if (chatId < 0 && !(await f.fleetAllowed(id, chatId))) return null;
    return {
      id,
      send: <T = unknown>(method: string, body: Record<string, unknown>) =>
        f.fleetApi<T>(id, method, body, key) as Promise<{
          ok: boolean;
          result?: T;
          description?: string;
        }>,
    };
  } catch {
    return null;
  }
}

export async function refreshScore(admin: Admin, chatId: number): Promise<string> {
  try {
    // Without the table the old post couldn't be removed: post none.
    const { error: missing } = await admin.from(TABLE).select("message_id").limit(1);
    if (missing) return "skipped: signal_chat_messages can't be read";
    const { signalRecord, resultsAnnouncement } = await import("./signal-record.server");
    // Cached a minute: the results are refreshed after every alert and update.
    const { cached } = await import("./server-cache");
    const record = await cached("signal-record", 60_000, () => signalRecord(admin)).catch(
      () => null,
    );
    if (!record) return "skipped: the signal record can't be read";
    // While the demo runs, the whole post comes from its own trades (the
    // counter, each market in cash and the balance), so it always adds up.
    const pa = await import("./paper-account.server");
    const state = await pa.paperState(admin).catch(() => null);
    const tally = state ? await pa.demoResults(admin, state).catch(() => null) : null;
    // The Copy Trader B0T keeps the tally when it's set up (the Boss's split):
    // it posts the post, with the trades it's copying right now on top.
    const copier = await copyBot(admin, chatId);
    const copying =
      copier && state ? await pa.copyingNow(admin, state).catch(() => [] as string[]) : [];
    const message = {
      chat_id: chatId,
      text: tally
        ? resultsAnnouncement(
            { ...record, wins: tally.wins, losses: tally.losses, form: tally.form },
            pa.demoLine(state!.start, tally.balance),
            tally.byMarket,
            copier ? { copying } : null,
          )
        : resultsAnnouncement(record, null, null, copier ? { copying } : null),
      disable_notification: true,
      disable_web_page_preview: true,
    };
    let sent: { ok: boolean; result?: { message_id?: number }; description?: string } | null =
      copier ? await copier.send<{ message_id?: number }>("sendMessage", message) : null;
    if (!sent?.ok) sent = await telegramApi<{ message_id?: number }>("sendMessage", message);
    if (!sent?.ok) sent = await workerApi<{ message_id?: number }>("sendMessage", message);
    const id = sent?.ok ? sent.result?.message_id : undefined;
    if (!id) {
      const why = sent?.description ?? "no answer from Telegram";
      console.warn(`[signals] results not posted: ${why}`);
      return `failed: couldn't post the results (${why})`;
    }
    await trackSignalMessage(admin, chatId, id, null, "score");
    // Only the newest results post stays (two refreshes at once settle on one).
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
      // Older posts may be the copy bot's, OG B0T's or the trade bot's: each
      // removes its own.
      const gone = { chat_id: chatId, message_ids: old };
      await Promise.all([
        telegramApi("deleteMessages", gone),
        workerApi("deleteMessages", gone),
        copier?.send("deleteMessages", gone),
      ]);
      await admin.from(TABLE).delete().eq("chat_id", chatId).in("message_id", old);
    }
    return "posted";
  } catch (e) {
    console.warn("[signals] results refresh failed", (e as Error).message);
    return `failed: ${(e as Error).message}`;
  }
}

/* ── The Copy Trader B0T taking over the tally ─────────────────────────── */

/** Which bot has the tally now (site_content), so the switch happens once. */
export const SCORE_BY_KEY = "signals.score.by";

/**
 * Run each minute by the tracker. The first time the Copy Trader B0T is set
 * up and on duty in the signals chat, it takes over at once instead of
 * waiting for the next trade: the trade bot's closed cards since the last
 * purge are redrawn without money, and the copy bot posts the tally. Then it's noted
 * (SCORE_BY_KEY) and does nothing again unless a different copy bot is set up.
 */
export async function ensureCopyTally(admin: Admin): Promise<string> {
  try {
    const chatId = await signalsChatId();
    if (chatId === null) return "no signals chat";
    const copier = await copyBot(admin, chatId);
    if (!copier) return "no copy bot";
    const { data: mark } = await admin
      .from("site_content")
      .select("value")
      .eq("key", SCORE_BY_KEY)
      .maybeSingle();
    const want = `copy:${copier.id}`;
    if ((mark as { value?: string } | null)?.value === want) return "copy bot has it";

    // The trade bot's closed cards since the last purge, redrawn without
    // money (open ones are redrawn by the tracker). Stored rows aren't changed.
    const since = await chatPurgedAt();
    const { data: rows } = await admin
      .from("trade_signals")
      .select("message_id, card, feeds, entered_at, status")
      .eq("sender_worker", "trade")
      .eq("chat_id", chatId)
      .gte("created_at", new Date(since ?? 0).toISOString())
      .not("message_id", "is", null)
      .limit(200);
    const { chatJournal, journalCard } = await import("./trade-signal-tracker.server");
    const { isActive } = await import("./trade-signal-outcome");
    let tidied = 0;
    for (const r of (rows ?? []) as {
      message_id: number;
      card: string | null;
      feeds: { log?: string[] } | null;
      entered_at: string | null;
      status: string;
    }[]) {
      if (!r.card || isActive(r.status as never)) continue;
      const log = r.feeds?.log ?? [];
      const was = journalCard(r.card, log, null, !!r.entered_at);
      const shown = chatJournal(r.card, log);
      const text = journalCard(shown.card, shown.log, null, !!r.entered_at);
      if (text === was) continue;
      await workerApi("editMessageText", {
        chat_id: chatId,
        message_id: r.message_id,
        text,
        disable_web_page_preview: true,
      });
      tidied++;
    }

    const score = await refreshScore(admin, chatId);
    if (score !== "posted") return `tidied ${tidied}, tally not posted yet (${score})`;
    const at = new Date().toISOString();
    await admin
      .from("site_content")
      .upsert({ key: SCORE_BY_KEY, value: want, updated_at: at }, { onConflict: "key" });
    return `copy bot took over (tidied ${tidied})`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}

/* ── Fresh starts ─────────────────────────────────────────────────────── */

/** When the Boss last purged the signals chat (ISO), in site_content. */
export const PURGED_KEY = "signals.chat.purgedAt";

/**
 * The last purge of the signals chat (ms), or null. Nothing is deleted at a
 * purge: what came before it is kept for learning, it just stops speaking
 * in the chat or counting there. Cached a minute.
 */
export async function chatPurgedAt(): Promise<number | null> {
  try {
    const { cached } = await import("./server-cache");
    return await cached("signals-chat-purged", 60_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await (supabaseAdmin as Admin)
        .from("site_content")
        .select("value")
        .eq("key", PURGED_KEY)
        .maybeSingle();
      const t = Date.parse((data as { value?: string } | null)?.value ?? "");
      return Number.isFinite(t) ? t : null;
    });
  } catch {
    return null;
  }
}
