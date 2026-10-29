/**
 * The Gaffer & Worker bots on Telegram. OG B0T (the main bot) is the Gaffer:
 * foul-mouthed, runs the groups. Worker bots do one job each under it; the
 * first is the OG Trade Bot (SIGNALS_BOT_TOKEN), the "chart slave".
 *
 * Golden rule: a worker only operates in a group while the Gaffer is in it
 * (telegram_managed_groups.og_bot_present) and the worker is switched on for
 * that group (active_workers). In a group, members ask the Gaffer; it barks an
 * order at the worker and the worker posts the card straight after, both from
 * the same webhook call. Nobody gets an @handle in message text.
 */
import { createHash } from "crypto";

type Admin = any;

export type WorkerKey = "trade";
export const WORKERS: Record<WorkerKey, { label: string; nicknames: RegExp }> = {
  trade: {
    label: "OG Trade Bot",
    // How members refer to it: its handle, "trade bot", or its nicknames.
    nicknames: /og_?trade_?bot|\btrade\s?bot\b|chart\s?(slave|boy)|unpaid\s+intern/i,
  },
};

const GROUPS = "telegram_managed_groups";

/* ── Telegram calls as the worker ──────────────────────────────────────── */

const QUIET = /message is not modified|message to delete not found|message can't be deleted/i;

/** One Bot API call as the OG Trade Bot. Null when it isn't set up or the call failed. */
export async function workerApi<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string } | null> {
  const token = process.env.SIGNALS_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    const ok = res.ok && json?.ok !== false;
    // Never log the URL: it carries the token.
    if (!ok && !QUIET.test(json?.description ?? ""))
      console.error(`[trade-bot] ${method} failed: ${json?.description ?? res.status}`);
    return { ok, result: json?.result, description: json?.description };
  } catch (e) {
    console.error(`[trade-bot] ${method} failed`, (e as Error).message);
    return null;
  }
}

export const workerConfigured = () => !!process.env.SIGNALS_BOT_TOKEN;

/** The secret Telegram sends with every trade bot webhook call. */
export function tradeBotSecret(token: string): string {
  return createHash("sha256").update(`trade-bot-webhook:${token}`).digest("base64url");
}

/* ── The group register ────────────────────────────────────────────────── */

export type ManagedGroup = {
  chat_id: number;
  chat_title: string | null;
  chat_type: "group" | "supergroup" | "channel";
  og_bot_present: boolean;
  og_bot_added_at: string | null;
  active_workers: string[];
  updated_at: string;
};

type ChatInfo = { id: number; title?: string; type?: string };
const chatType = (t?: string): ManagedGroup["chat_type"] =>
  t === "supergroup" || t === "channel" ? t : "group";

/**
 * Records whether the Gaffer is in a chat. New chats start with every worker
 * switched on; the Boss can switch them off per group.
 */
export async function recordGaffer(admin: Admin, chat: ChatInfo, present: boolean) {
  const now = new Date().toISOString();
  try {
    const { data } = await admin
      .from(GROUPS)
      .select("og_bot_present")
      .eq("chat_id", chat.id)
      .maybeSingle();
    if (data) {
      await admin
        .from(GROUPS)
        .update({
          og_bot_present: present,
          ...(chat.title ? { chat_title: chat.title } : {}),
          ...(chat.type ? { chat_type: chatType(chat.type) } : {}),
          ...(present && !data.og_bot_present ? { og_bot_added_at: now } : {}),
          updated_at: now,
        })
        .eq("chat_id", chat.id);
    } else {
      await admin.from(GROUPS).insert({
        chat_id: chat.id,
        chat_title: chat.title ?? null,
        chat_type: chatType(chat.type),
        og_bot_present: present,
        og_bot_added_at: present ? now : null,
        updated_at: now,
      });
    }
  } catch (e) {
    console.warn("[telegram] group register failed", (e as Error).message);
  }
}

// Ordinary group messages prove the Gaffer is there; note it at most every
// 10 minutes per group rather than on every message.
const touched = new Map<number, number>();
export async function noteGafferHere(admin: Admin, chat: ChatInfo) {
  const last = touched.get(chat.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  touched.set(chat.id, Date.now());
  await recordGaffer(admin, chat, true);
}

/** The group's register row, or null (unknown group, or no table yet). */
export async function managedGroup(admin: Admin, chatId: number): Promise<ManagedGroup | null> {
  try {
    const { data, error } = await admin
      .from(GROUPS)
      .select("*")
      .eq("chat_id", chatId)
      .maybeSingle();
    return error ? null : ((data as ManagedGroup | null) ?? null);
  } catch {
    return null;
  }
}

/** Whether a worker may operate in this chat right now. */
export async function workerAllowed(admin: Admin, chatId: number, worker: WorkerKey) {
  const g = await managedGroup(admin, chatId);
  return !!g?.og_bot_present && (g.active_workers ?? []).includes(worker);
}

/* ── What the Gaffer and the worker say ────────────────────────────────── */

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** The Gaffer ordering the chart slave about. Nicknames, never @handles. */
export function gafferOrder(market: string, worker?: string): string {
  // {who} is where the asker's name goes (a tap-able mention, see withAsker).
  if (worker)
    return `Oi ${worker}, you useless lump, {who} wants a ${market} signal. Give them one, chop fucking chop.`;
  return pick([
    `Oi chart slave, {who} wants a ${market} signal. Give them one, and don't take all fucking day.`,
    `Wake up, you useless chart boy. {who} wants ${market}. Cook them a signal, now.`,
    `Unpaid intern! {who} is after a ${market} signal. Sort them out before I sack you.`,
    `Oi dickhead chart slave, {who} wants ${market} levels. Chop fucking chop.`,
    `Chart slave, {who} wants a ${market} signal. Get cooking or you're back on tea duty, you muppet.`,
  ]);
}

/** The Gaffer stepping in when someone has a go at the chart slave. */
export function gafferDefence(): string {
  return pick([
    "Oi clown, only I get to bully my chart slave. Back off before I roast you into next week.",
    "Who the fuck asked you? That's MY intern. You want smoke, come to the Gaffer.",
    "Leave the chart boy alone, you absolute melt. He's useless, but he's my useless.",
    "Nobody mugs off my chart slave except me. Try it again and see what happens, dickhead.",
  ]);
}

/** What a worker says on its way out of a group the Gaffer isn't in. */
export const WORKER_REFUSAL =
  "Oi, I only work here if the Gaffer (OG B0T) is in the room. Add OG B0T first or do one.";

/* ── Reading the room ──────────────────────────────────────────────────── */

const INSULT_RE =
  /\b(fuck(?:ing|er|ed)?|shit(?:e|head|bag)?|crap|dick(?:head)?|twat|wanker|prick|muppet|idiot|moron|bellend|bell-end|knob(?:head)?|gobshite|plonker|tosser|prat|melt|clown|stupid|dumb|useless|rubbish|trash|garbage|scam(?:mer)?|fraud|fake|bitch|bastard|pussyhole|numpty|pillock|wrong again|shit signals?)\b/i;

/** Whether a message reads as an insult. */
export function looksLikeInsult(text: string): boolean {
  return INSULT_RE.test(text);
}
