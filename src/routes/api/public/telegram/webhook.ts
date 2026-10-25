import { cached } from "@/lib/server-cache";
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { buildSystemPrompt, detectSongIntent } from "@/lib/og-persona.server";
import { pickCatchphrases, catchphraseNote, toneFor } from "@/lib/og-catchphrases.server";
import type { UserContextSummary } from "@/lib/og-persona-public";
import { SPORTS_GUIDE_CHAT_ID, detectSport, detectEventTime } from "@/lib/sports-guide-parse";
import {
  BACK_BUTTON,
  ONE_MINUTE_RE,
  SIGNAL_BUTTONS,
  SIGNALS_BUTTON,
  SIGNALS_TEXT,
  parseSignalAction,
  signalButtonRows,
  signalRequest,
  withoutOneMinute,
} from "@/lib/telegram-signals";
import { escapeTelegramHtml as esc, telegramApi } from "@/lib/telegram-api.server";
import { mapPool } from "@/lib/map-pool";
import type { FoulAccess } from "@/lib/foul-access.server";

// Accepted tokens:
//   - Rotated, single-use: "t_" + 32 lowercase hex chars (matched against
//     profiles.telegram_link_token).
//   - Legacy deterministic: 24 lowercase hex (first 24 chars of profiles.id
//     without dashes).
const TOKEN_RE = /^(t_[a-f0-9]{32}|[a-f0-9]{24})$/;
const BOSS_TELEGRAM_USERNAMES = ["ogstreamz", "ogstreamz196"] as const;
const BOSS_EMAIL = "ogstreamz196@gmail.com";

function deriveSecret(key: string): string {
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const la = Buffer.from(a);
  const lb = Buffer.from(b);
  return la.length === lb.length && timingSafeEqual(la, lb);
}

// Telegram's reply when the call worked, else null (failures are logged).
async function tg(method: string, body: Record<string, unknown>) {
  const res = await telegramApi(method, body);
  return res?.ok ? res : null;
}

/**
 * Sends one of the member's own tracks into the chat as an audio file they
 * can keep. Same rule as downloading in the app: the full track once it's
 * unlocked (Boss and admins always), otherwise the free preview with a way
 * to unlock.
 */
async function sendTrackAudio(chat_id: number, songId: string) {
  const admin = await loadAdmin();
  const { data: me } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chat_id)
    .maybeSingle();
  if (!me) {
    await reply(chat_id, "Link your OG B0T account first.");
    return;
  }
  const [{ data: song }, { roles }, { data: unlock }] = await Promise.all([
    admin
      .from("songs")
      .select("id, title, style, audio_path, sample_path, status")
      .eq("id", songId)
      .eq("user_id", me.id)
      .maybeSingle(),
    isAdmin(admin, me.id),
    admin
      .from("unlocked_songs")
      .select("id")
      .eq("user_id", me.id)
      .eq("song_id", songId)
      .maybeSingle(),
  ]);
  if (!song || song.status !== "completed") {
    await reply(chat_id, "I couldn't find that track in your library.");
    return;
  }
  const full = !!unlock || roles.some((r) => r === "admin" || r === "boss");
  const path = full ? song.audio_path : song.sample_path;
  if (!path) {
    await reply(chat_id, "That track's file isn't ready yet. Try again in a minute.");
    return;
  }
  const { data: signed } = await admin.storage.from("song-files").createSignedUrl(path, 600);
  const { telegramSignInLinker } = await import("@/lib/telegram-signin.server");
  const unlockUrl = await telegramSignInLinker(admin, me.id)(`/library/${song.id}`);
  const title = song.title || "OG B0T track";
  const sent = signed?.signedUrl
    ? await tg("sendAudio", {
        chat_id,
        audio: signed.signedUrl,
        title: full ? title : `${title} (preview)`,
        performer: "OG B0T",
        caption: full
          ? `🎧 <b>${esc(title)}</b>`
          : `🔒 <b>Preview.</b> Unlock the full track in the app, then tap ⬇️ again for the whole thing.`,
        parse_mode: "HTML",
        ...(full
          ? {}
          : {
              reply_markup: {
                inline_keyboard: [[{ text: "🔓 Unlock full track", url: unlockUrl }]],
              },
            }),
      })
    : null;
  if (!sent) {
    // Too big for Telegram to fetch, or the link failed: open it in the app instead.
    await reply(chat_id, `I couldn't send <b>${esc(title)}</b> here. Open it in the app instead.`, {
      reply_markup: { inline_keyboard: [[{ text: "▶️ Open track", url: unlockUrl }]] },
    });
  }
}

// Inline buttons: the signals picker, the menu panel, track downloads, Clear
// chat, and Boss's "✅ Acknowledge" on a new yearly VIP DM.
async function handleCallbackQuery(cq: {
  id: string;
  data?: string;
  from?: { id?: number; first_name?: string; username?: string };
  message?: {
    chat?: { id?: number };
    message_id?: number;
    text?: string;
    message_thread_id?: number;
    is_topic_message?: boolean;
  };
}) {
  const answer = (text: string) =>
    tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  // A signal button in a group: the member who tapped gets the signal there.
  const groupSignal = /^gsig:(XAU|BTC):(1h|5m)$/.exec(cq.data ?? "");
  if (groupSignal) {
    const chatId = cq.message?.chat?.id;
    if (!chatId || chatId > 0) {
      await answer("");
      return Response.json({ ok: true, ignored: true });
    }
    const admin = await loadAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_chat_id", cq.from?.id ?? 0)
      .maybeSingle();
    if (!profile) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "You're not connected to OG B0T yet. Send me /start in a private chat and I'll give you the link.",
        show_alert: true,
      });
      return Response.json({ ok: true, unlinked: true });
    }
    await answer("Checking the live charts…");
    const { roles } = await isAdmin(admin, profile.id);
    await runChatAI(
      admin,
      profile.id,
      chatId,
      signalRequest(groupSignal[1] as "XAU" | "BTC", groupSignal[2] as "1h" | "5m"),
      roles,
      {
        replyTo: cq.message?.message_id,
        thread: cq.message?.is_topic_message ? cq.message.message_thread_id : undefined,
        name: cq.from?.first_name,
        user: cq.from,
      },
    );
    return Response.json({ ok: true, group: "signal" });
  }
  if (cq.data?.startsWith("signals:")) {
    const action = parseSignalAction(cq.data);
    const chatId = cq.message?.chat?.id;
    // Signals are private and retain the bot's existing linked-account access.
    if (!action || !chatId || chatId <= 0 || cq.from?.id !== chatId) {
      await answer("Open Signals in your private chat with OG B0T.");
      return Response.json({ ok: true, ignored: true });
    }
    const admin = await loadAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();
    if (!profile) {
      await answer("Link your OG B0T account first.");
      return Response.json({ ok: true, unlinked: true });
    }
    const { admin: staff, roles } = await isAdmin(admin, profile.id);
    // An old picker can still show 1 min to a member: that one's Boss-only now.
    const memberOneMinute = action.kind === "run" && action.timeframe === "1m" && !staff;
    await answer(
      memberOneMinute
        ? "1 min signals are Boss-only. Try a scalp."
        : action.kind === "run"
          ? "Checking the live charts…"
          : "",
    );
    if (action.kind !== "run" || memberOneMinute) {
      // An old in-chat picker: signals live in the bottom bar now.
      await setKeys(chatId, SIGNALS_TEXT, kb(signalButtonRows(staff)));
      await tidyScreens(chatId);
    } else {
      // The picker and anything else from the menu go; the signal comes next.
      await tidyScreens(chatId);
      try {
        await runChatAI(
          admin,
          profile.id,
          chatId,
          signalRequest(action.pair, action.timeframe),
          roles,
        );
      } catch (error) {
        console.error("[telegram] button signal failed", error);
        await reply(
          chatId,
          "⚠️ I couldn't finish that live signal. Tap the timeframe again in a moment.",
        );
      }
    }
    return Response.json({ ok: true, signals: action.kind });
  }
  const menuKey = /^menu:(\w+)$/.exec(cq.data ?? "")?.[1];
  const chatHere = cq.message?.chat?.id;
  const privateChat = !!chatHere && chatHere > 0 && cq.from?.id === chatHere;
  if (menuKey === "foul" && privateChat) {
    const admin = await loadAdmin();
    const { data: me } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_chat_id", chatHere)
      .maybeSingle();
    if (!me) {
      await answer("Link your OG B0T account first.");
      return Response.json({ ok: true, unlinked: true });
    }
    const { admin: isBoss, roles } = await isAdmin(admin, me.id);
    const { foulAccess, setFoulMouth } = await import("@/lib/foul-access.server");
    const { telegramSignInLinker } = await import("@/lib/telegram-signin.server");
    const siteLink = telegramSignInLinker(admin, me.id);
    const foul = await foulAccess(admin, me.id, roles);
    if (!foul.allowed) {
      await answer("Foul mouth is a VIP perk");
      await screen(
        chatHere,
        "🔒 <b>Foul mouth is a VIP perk.</b>\nVIP lets OG B0T swear back, no filter.",
        withMenuBack({
          reply_markup: {
            inline_keyboard: [[{ text: "👑 Get VIP", url: await siteLink("/store") }]],
          },
        }),
      );
      return Response.json({ ok: true, foul: "locked" });
    }
    const next = !foul.on;
    await setFoulMouth(admin, me.id, next);
    await answer(next ? "Foul mouth on 🤬" : "Foul mouth off 😇");
    // Redraw the menu in place with the new setting.
    if (cq.message?.message_id) {
      await tg("editMessageReplyMarkup", {
        chat_id: chatHere,
        message_id: cq.message.message_id,
        reply_markup: menuPanel(isBoss, await siteLink("/"), { allowed: true, on: next }),
      });
    }
    return Response.json({ ok: true, foul: next });
  }
  if (menuKey && Object.hasOwn(MENU_ACTIONS, menuKey) && privateChat) {
    // Same as typing the command, so menu buttons and commands never drift apart.
    await answer("");
    const admin = await loadAdmin();
    return handleTelegramUpdate(admin, chatHere, MENU_ACTIONS[menuKey as MenuKey], {
      chat: { id: chatHere, type: "private" },
      from: { id: chatHere },
      viaMenu: menuKey !== "open",
    });
  }
  const trackId = /^track:([0-9a-f-]{36})$/.exec(cq.data ?? "")?.[1];
  if (trackId && privateChat) {
    await answer("Sending your track…");
    await sendTrackAudio(chatHere, trackId);
    return Response.json({ ok: true, track: true });
  }
  if (cq.data === "clearchat" && cq.message?.chat?.id && cq.message.message_id) {
    const chatId = cq.message.chat.id;
    await answer("Chat cleared 🧹");
    await clearRecentChat(chatId, cq.message.message_id);
    await forgetScreens(chatId);
    const admin = await loadAdmin();
    const { data: me } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();
    if (me?.id) await admin.from("og_messages").delete().eq("user_id", me.id);
    await sendIntro(chatId);
    return Response.json({ ok: true, cleared: true });
  }
  const m = /^vipack:([0-9a-f-]{36})$/.exec(cq.data ?? "");
  if (!m) {
    await answer("Unknown action");
    return Response.json({ ok: true });
  }
  const admin = await loadAdmin();
  const fromId = Number(cq.from?.id);
  const { data: me } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", fromId)
    .maybeSingle();
  const { roles } = me ? await isAdmin(admin, me.id) : { roles: [] as string[] };
  if (!me || !roles.some((r) => r === "admin" || r === "boss")) {
    await answer("Boss only");
    return Response.json({ ok: true });
  }
  await admin
    .from("vip_acknowledgements")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: me.id })
    .eq("user_id", m[1])
    .is("acknowledged_at", null);
  await answer("Added to verified OG VIPs ✅");
  if (cq.message?.chat?.id && cq.message.message_id) {
    await tg("editMessageReplyMarkup", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: "✅ Acknowledged", callback_data: "noop" }]] },
    });
  }
  return Response.json({ ok: true });
}

// Bot replies self-destruct: default ~48h (Telegram's bot delete window),
// Vault credentials after 1h. Pass ttlMs: 0 to keep forever (welcome intro).
const DEFAULT_TTL_MS = 47 * 60 * 60 * 1000;
export const VAULT_TTL_MS = 60 * 60 * 1000;

async function scheduleDelete(chat_id: number, payload: unknown, ttlMs: number) {
  const mid = (payload as { result?: { message_id?: number } } | null)?.result?.message_id;
  if (!mid || ttlMs <= 0) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("telegram_ephemeral_messages" as never).upsert(
      {
        chat_id,
        message_id: mid,
        delete_at: new Date(Date.now() + ttlMs).toISOString(),
      } as never,
      { onConflict: "chat_id,message_id" },
    );
  } catch (e) {
    console.error("[tg] schedule delete failed", e);
  }
}

async function reply(
  chat_id: number,
  text: string,
  extra?: Record<string, unknown>,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  const res = await tg("sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(extra ?? {}),
  });
  await scheduleDelete(chat_id, res, ttlMs);
  return res;
}

/* ── Screens: one button-driven message on show at a time ─────────────── */
// What the bot shows when a member taps a button (menu, VIP, Vault, tracks,
// "hold on" lines, "no trade" cards) is a screen: the next one replaces it,
// so hunting for signals stays clutter-free. Typed questions and their
// answers and followed signal cards are never screens.
//
// The bottom bar belongs to the message that set it: delete that message and
// Telegram hides the bar. So the message carrying the current bar is a
// "keys" row that tidying never touches; it's only swapped when the bar
// changes (Signals, Back, /start). The welcome carries the bar too, as a
// "welcome" row: the first tap swaps it for a one-line holder so the intro
// clears but the buttons stay.
//
// Needs the telegram_screen_messages table (and its kind column); until then
// nothing is tidied and everything else works as before.
const SCREENS = "telegram_screen_messages" as never;
type ScreenRow = { message_id: number; kind?: string };

async function screenRows(chat_id: number): Promise<ScreenRow[]> {
  const admin = await loadAdmin();
  const withKind = await admin
    .from(SCREENS)
    .select("message_id, kind")
    .eq("chat_id" as never, chat_id)
    .limit(100);
  if (!withKind.error) return (withKind.data ?? []) as ScreenRow[];
  // Before the kind column exists every row is an ordinary screen.
  const plain = await admin
    .from(SCREENS)
    .select("message_id")
    .eq("chat_id" as never, chat_id)
    .limit(100);
  return plain.error ? [] : ((plain.data ?? []) as ScreenRow[]);
}

async function dropMessages(chat_id: number, ids: number[]) {
  if (!ids.length) return;
  await tg("deleteMessages", { chat_id, message_ids: ids });
  const admin = await loadAdmin();
  await admin
    .from(SCREENS)
    .delete()
    .eq("chat_id" as never, chat_id)
    .in("message_id" as never, ids as never);
}

/** Deletes the chat's earlier screens; the bottom bar's message stays. */
async function tidyScreens(chat_id: number, opts: { keepWelcome?: boolean } = {}) {
  try {
    const rows = await screenRows(chat_id);
    if (!opts.keepWelcome && rows.some((r) => r.kind === "welcome")) {
      // The intro goes, but the buttons it carried must not.
      await setKeys(chat_id, MAIN_KEYS_TEXT, USER_KEYBOARD);
    }
    await dropMessages(
      chat_id,
      rows.filter((r) => (r.kind ?? "screen") === "screen").map((r) => Number(r.message_id)),
    );
  } catch (e) {
    console.warn("[telegram] tidy screens failed", e);
  }
}

/** Marks a sent message as a screen, so the next screen replaces it. */
async function rememberScreen(chat_id: number, sent: unknown) {
  const message_id = (sent as { result?: { message_id?: number } } | null)?.result?.message_id;
  if (!message_id) return;
  try {
    const admin = await loadAdmin();
    await admin.from(SCREENS).upsert({ chat_id, message_id } as never, {
      onConflict: "chat_id,message_id",
    });
  } catch {
    /* table not there yet: nothing to tidy later */
  }
}

/**
 * Sets the bottom bar: sends `text` carrying it, then deletes the message
 * that carried the previous bar. Never auto-deleted, so the bar never drops.
 */
async function setKeys(
  chat_id: number,
  text: string,
  keyboard: ReturnType<typeof kb>,
  kind: "keys" | "welcome" = "keys",
) {
  const sent = await reply(chat_id, text, { reply_markup: keyboard }, 0);
  const message_id = (sent as { result?: { message_id?: number } } | null)?.result?.message_id;
  if (!message_id) return sent;
  try {
    const rows = await screenRows(chat_id);
    await dropMessages(
      chat_id,
      rows
        .filter((r) => r.kind === "keys" || r.kind === "welcome")
        .map((r) => Number(r.message_id))
        .filter((id) => id !== message_id),
    );
    // If this can't be stored (kind column not there yet) the message just
    // stays, which keeps the bar showing.
    const admin = await loadAdmin();
    await admin.from(SCREENS).upsert({ chat_id, message_id, kind } as never, {
      onConflict: "chat_id,message_id",
    });
  } catch (e) {
    console.warn("[telegram] set keys failed", e);
  }
  return sent;
}

/**
 * A new signal wipes out the last: earlier signal cards and their updates
 * ("signal" rows, plus cards recorded in trade_signals) are deleted, and the
 * earlier trades stop messaging this chat. They're still followed quietly,
 * so their results keep counting towards the track record.
 */
async function replaceOldSignals(chat_id: number, keep: number[]) {
  try {
    const admin = await loadAdmin();
    const ids = new Set<number>();
    const rows = await screenRows(chat_id);
    for (const r of rows) if (r.kind === "signal") ids.add(Number(r.message_id));
    const { data: cards } = await admin
      .from("trade_signals" as never)
      .select("message_id")
      .eq("chat_id" as never, chat_id)
      .gte("created_at" as never, new Date(Date.now() - 48 * 3_600_000).toISOString())
      .limit(100);
    for (const c of (cards ?? []) as { message_id: number | null }[]) {
      if (c.message_id) ids.add(Number(c.message_id));
    }
    for (const id of keep) ids.delete(id);
    // Telegram deletes up to 100 at a time; anything older has expired anyway.
    await dropMessages(chat_id, [...ids].slice(-100));
    await admin
      .from("trade_signals" as never)
      .update({ chat_id: null } as never)
      .eq("chat_id" as never, chat_id);
    // The new card is a signal row, so the next signal can wipe it.
    for (const message_id of keep) {
      await admin.from(SCREENS).upsert({ chat_id, message_id, kind: "signal" } as never, {
        onConflict: "chat_id,message_id",
      });
    }
  } catch (e) {
    console.warn("[telegram] replace old signals failed", e);
  }
}

/** Forgets everything remembered for a chat (after clearing it). */
async function forgetScreens(chat_id: number) {
  try {
    const admin = await loadAdmin();
    await admin
      .from(SCREENS)
      .delete()
      .eq("chat_id" as never, chat_id);
  } catch {
    /* nothing remembered */
  }
}

/** Shows a screen: clears the previous ones, then sends this one. */
async function screen(
  chat_id: number,
  text: string,
  extra?: Record<string, unknown>,
  ttlMs?: number,
) {
  await tidyScreens(chat_id);
  const res = await reply(chat_id, text, extra, ttlMs);
  await rememberScreen(chat_id, res);
  return res;
}

// The welcome after /start or a clear, in OG B0T's foul-mouthed voice. The
// first tap clears it (see tidyScreens); the buttons stay.
const INTRO_TEXT =
  "<b>OG B0T here.</b> No filter, no bullshit, and no wasting my fucking time.\n\n" +
  "🧠 <b>Ask anything</b>: advice, ideas, homework, whatever's on your mind.\n" +
  "⚽ <b>Sports</b>: fixtures, scores and kick-off times.\n" +
  "📈 <b>Signals</b>: live gold and bitcoin setups.\n" +
  "🔥 <b>Roast me</b>: go on, try me. I'll rip you a new one.\n\n" +
  "Type something or smash the buttons below.";

const LINK_STEPS =
  "🔗 <b>Link your account to unlock everything:</b>\n" +
  "1. Open ogbot.co.uk and sign in\n" +
  "2. Go to Settings → <b>Connect Telegram</b>\n" +
  "3. Tap your personal link, it brings you straight back here";

/**
 * Someone without an OG B0T account, in their private chat with the bot: a
 * one-time link to ogbot.co.uk that links this Telegram to the account they
 * sign in to or create (see telegram-connect.server.ts). Private chats only,
 * so the link is only ever seen by its owner.
 */
async function sendConnectLink(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chat_id: number,
  msg: { chat?: { type?: string }; from?: { id?: number; username?: string; first_name?: string } },
  heading = "🔗 <b>Connect your Telegram</b>",
) {
  const own = msg.chat?.type === "private" && Number(msg.from?.id) === chat_id;
  const { createConnectToken, SITE_CONNECT_URL } = await import("@/lib/telegram-connect.server");
  const token = own
    ? await createConnectToken(admin, {
        id: chat_id,
        username: msg.from?.username,
        first_name: msg.from?.first_name,
      })
    : null;
  if (!token) {
    await reply(chat_id, `${heading}\n\n${LINK_STEPS}`, { reply_markup: UNLINKED_KEYBOARD });
    return;
  }
  await reply(
    chat_id,
    `${heading}\n\nTap below and create your free OG B0T account, or sign in if you've got one. ` +
      "This Telegram links itself, and I'm all yours.\n\n" +
      "<i>The link works once, for 24 hours. Don't share it.</i>",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Create account or sign in", url: `${SITE_CONNECT_URL}#${token}` }],
        ],
      },
    },
    24 * 3_600_000,
  );
}

// The one line left holding the main bar once the intro has cleared.
const MAIN_KEYS_TEXT = "🤖 <b>OG B0T</b> · type anything or tap below 👇";

// The intro carries the bottom bar, so it's always there after /start or a clear.
async function sendIntro(chat_id: number) {
  await setKeys(chat_id, INTRO_TEXT, USER_KEYBOARD, "welcome");
  await tidyScreens(chat_id, { keepWelcome: true });
}

// Deletes up to the last 100 messages (bots may delete private-chat messages <48h old).
async function clearRecentChat(chat_id: number, upToMessageId: number) {
  const ids: number[] = [];
  for (let i = upToMessageId; i > 0 && ids.length < 100; i--) ids.push(i);
  if (ids.length) await tg("deleteMessages", { chat_id, message_ids: ids });
}

// The bottom bar is always showing: Menu, Signals and Clear chat. Menu opens
// one panel of the important things (inline buttons under the message).
const kb = (rows: string[][]) => ({
  keyboard: rows.map((r) => r.map((text) => ({ text }))),
  resize_keyboard: true,
  is_persistent: true,
});
const MENU = "📂 Menu";
const CLEAR = "🧹 Clear chat";
const SITE = "🌐 OGBOT.CO.UK";
const USER_KEYBOARD = kb([[MENU, SIGNALS_BUTTON, CLEAR]]);
// Before linking there's nothing to open yet, so just the basics.
const UNLINKED_KEYBOARD = kb([[CLEAR, SITE]]);
// Buttons from the old category menu, still on some members' screens.
const OLD_MENU_BUTTONS = new Set([
  "🔙 Categories",
  "💷 Coins & Store",
  "🎧 Music & VIP",
  "🔐 Access",
  "🛠 Boss tools",
]);

/** What each menu button runs (callback_data "menu:<key>"). */
const MENU_ACTIONS = {
  vip: "/vip",
  vault: "/vault",
  tracks: "/tracks",
  balance: "/balance",
  buy: "/buy",
  sports: "/sports",
  me: "/me",
  help: "/help",
  stats: "/stats",
  users: "/users",
  open: "/menu",
} as const;
type MenuKey = keyof typeof MENU_ACTIONS;
const menuButton = (text: string, key: MenuKey) => ({ text, callback_data: `menu:${key}` });

const MENU_TEXT = "📂 <b>OG Menu</b>\nEverything important, one tap away 👇";

// Screens opened from the menu get a way straight back to it.
const MENU_BACK_ROW = [menuButton("⬅️ Menu", "open")];
function withMenuBack(extra: Record<string, unknown> | undefined) {
  const markup = extra?.reply_markup as { inline_keyboard?: unknown[][] } | undefined;
  if (markup && !markup.inline_keyboard) return extra; // a bottom-bar keyboard: leave it
  return {
    ...extra,
    reply_markup: { inline_keyboard: [...(markup?.inline_keyboard ?? []), MENU_BACK_ROW] },
  };
}

function menuPanel(isBoss: boolean, siteUrl: string, foul: FoulAccess) {
  const foulText = !foul.allowed
    ? "🔒 Foul mouth (VIP)"
    : foul.on
      ? "🤬 Foul mouth: ON · tap to turn off"
      : "😇 Foul mouth: OFF · tap to turn on";
  return {
    inline_keyboard: [
      [{ text: foulText, callback_data: "menu:foul" }],
      [menuButton("👑 VIP expiry", "vip"), menuButton("🔐 Vault pass", "vault")],
      [menuButton("🎧 My tracks", "tracks"), menuButton("💰 Balance", "balance")],
      [menuButton("🛒 Buy coins", "buy"), menuButton("⚽ Sports Guide", "sports")],
      [menuButton("👤 My profile", "me"), menuButton("❓ Help", "help")],
      ...(isBoss ? [[menuButton("📊 Stats", "stats"), menuButton("👥 Users", "users")]] : []),
      [{ text: "🌐 Open OGBOT.CO.UK", url: siteUrl }],
    ],
  };
}

const HELP_USER = `🤖 <b>OG B0T</b>

Just type to chat with me, same brain as the in-app messenger. Or use the buttons below: 📂 Menu has everything here plus the foul mouth switch, 📈 Signals swaps in the signal buttons until you tap Back.

💰 <b>Coins</b>
/balance  your OG coin balance
/buy  top up OG coins

🎧 <b>Music, VIP & Vault</b>
/tracks  your latest tracks to download and share
/vip  your VIP status and expiry date
/vault  your OG Vault login

📈 <b>Signals & sports</b>
/signals  live gold and bitcoin signals
/sports  the Sports Guide (try <code>/sports arsenal</code>)

👤 <b>You</b>
/me  your linked profile
/menu  the OG Menu
/clear  wipe this chat and start fresh

👥 <b>Groups</b>
Add me to a group chat: /og asks me anything, /signal drops a live signal, /roast if you dare.`;

const HELP_ADMIN = `${HELP_USER}

👑 <b>Boss tools</b>
/user &lt;email|uuid|@handle&gt;  account snapshot
/users [search]  latest or matching profiles
/addcoins &lt;who&gt; &lt;amount&gt; [reason]  add or take coins
/setcoins &lt;who&gt; &lt;amount&gt; [reason]  set an exact balance
/stats  platform snapshot
/broadcast &lt;message&gt;  DM every linked member`;

type AdminProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  coin_balance: number | null;
  telegram_chat_id: number | null;
  telegram_username: string | null;
};

const PROFILE_COLS = "id, display_name, email, coin_balance, telegram_chat_id, telegram_username";

async function findProfile(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  needle: string,
): Promise<AdminProfile | null> {
  const v = needle.trim().replace(/^@/, "");
  // UUID?
  if (/^[0-9a-f-]{32,36}$/i.test(v)) {
    const { data } = await admin.from("profiles").select(PROFILE_COLS).eq("id", v).maybeSingle();
    if (data) return data as AdminProfile;
  }
  const safe = filterSafe(v);
  if (!safe) return null;
  const { data } = await admin
    .from("profiles")
    .select(PROFILE_COLS)
    .or(`email.ilike.${safe},display_name.ilike.${safe},telegram_username.ilike.${safe}`)
    .limit(2);
  if (data && data.length === 1) return data[0] as AdminProfile;
  return null;
}

// Search text goes inside a filter string, where commas, brackets, quotes
// and wildcards would change the query itself, so they're dropped.
function filterSafe(v: string): string {
  return v
    .replace(/[,()"'\\%*]/g, "")
    .trim()
    .slice(0, 100);
}

async function loadAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isAdmin(admin: Awaited<ReturnType<typeof loadAdmin>>, userId: string) {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role);
  return { admin: roles.some((r) => r === "admin" || r === "boss" || r === "dev"), roles };
}

async function verifyTelegramChat(chat_id: number): Promise<boolean> {
  const verifyJson = (await tg("getChat", { chat_id })) as {
    ok?: boolean;
    result?: { id?: number };
  } | null;
  return verifyJson?.ok === true && Number(verifyJson.result?.id) === Number(chat_id);
}

async function maybeBootstrapBossTelegram(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chat_id: number,
  msg: {
    chat?: { type?: string };
    from?: { id?: number; username?: string; first_name?: string };
  },
): Promise<boolean> {
  if (chat_id <= 0 || msg?.chat?.type !== "private" || Number(msg?.from?.id) !== chat_id) {
    return false;
  }

  const username = msg?.from?.username?.trim().replace(/^@/, "").toLowerCase();
  if (
    !username ||
    !BOSS_TELEGRAM_USERNAMES.includes(username as (typeof BOSS_TELEGRAM_USERNAMES)[number])
  )
    return false;

  const { data: boss } = await admin
    .from("profiles")
    .select("id, display_name, email, coin_balance")
    .eq("email", BOSS_EMAIL)
    .maybeSingle();
  if (!boss?.id) return false;

  const { admin: isBoss } = await isAdmin(admin, boss.id as string);
  if (!isBoss) return false;

  const chatVerified = await verifyTelegramChat(chat_id);
  if (!chatVerified) {
    await reply(
      chat_id,
      "⚠️ I found Boss, but Telegram chat verification failed. Tap Start again in a moment.",
    );
    return true;
  }

  const { error } = await admin
    .from("profiles")
    .update({
      telegram_chat_id: chat_id,
      telegram_username: msg?.from?.username ?? username,
      telegram_linked_at: new Date().toISOString(),
      telegram_link_token: null,
    })
    .eq("id", boss.id as string);

  if (error) {
    console.error("[telegram] boss link failed", error);
    await reply(
      chat_id,
      "⚠️ I found Boss, but couldn't link this chat. Tap Start again in a moment.",
    );
    return true;
  }

  await admin
    .from("telegram_sign_in_events")
    .insert({
      user_id: boss.id as string,
      chat_id,
      telegram_username: msg?.from?.username ?? username,
      telegram_first_name: (msg?.from?.first_name as string | undefined) ?? null,
      event_kind: "boss_link",
      source: "webhook_start",
    })
    .then(
      () => undefined,
      () => undefined,
    );

  await setKeys(
    chat_id,
    `👑 <b>Boss verified.</b> OG B0T is wired to this Telegram now.\n\n💰 <b>${boss.coin_balance ?? 0}</b> OG coins\n🛠 Boss tools are under 📂 Menu, and /help lists every command.`,
    USER_KEYBOARD,
  );
  return true;
}

function fmtProfile(p: AdminProfile): string {
  return [
    `👤 <b>${esc(p.display_name ?? "(no name)")}</b>`,
    p.email ? `📧 ${esc(p.email)}` : null,
    `💰 <b>${p.coin_balance ?? 0}</b> OG coins`,
    p.telegram_username
      ? `✈️ @${esc(p.telegram_username)}`
      : `✈️ Telegram ${p.telegram_chat_id ? "linked" : "not linked"}`,
    `🆔 <code>${p.id}</code>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function noMatch(needle: string): string {
  return `No single member matches "${esc(needle)}". Try their email or /users ${esc(needle)}.`;
}

async function runAdminCommand(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chat_id: number,
  text: string,
  viaMenu = false,
): Promise<boolean> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  // Opened from the menu panel: a screen with a way back to the menu. Typed
  // Boss commands stay as ordinary messages to scroll back through.
  const out = (body: string) =>
    viaMenu ? screen(chat_id, body, withMenuBack(undefined)) : reply(chat_id, body);

  if (cmd === "/user" || cmd === "/inspect" || cmd === "/whois") {
    if (!arg) {
      await reply(chat_id, `Usage: ${cmd} &lt;email|uuid|@handle&gt;`);
      return true;
    }
    const p = await findProfile(admin, arg);
    await reply(chat_id, p ? fmtProfile(p) : noMatch(arg));
    return true;
  }

  if (cmd === "/users" || cmd === "/find") {
    const q = filterSafe(arg);
    let query = admin.from("profiles").select(PROFILE_COLS);
    query = q
      ? query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%,telegram_username.ilike.%${q}%`)
      : query.order("created_at", { ascending: false });
    const { data, error } = await query.limit(10);
    if (error) {
      console.error("[telegram] /users failed", error);
      await out("⚠️ Search failed. Try again in a moment.");
      return true;
    }
    const rows = (data ?? []) as AdminProfile[];
    if (!rows.length) {
      await out(q ? `No profiles match "${esc(q)}".` : "No profiles yet.");
      return true;
    }
    const list = rows
      .map(
        (p, i) =>
          `${i + 1}. <b>${esc(p.display_name ?? "(no name)")}</b>${p.telegram_chat_id ? " ✈️" : ""}\n` +
          `    ${esc(p.email ?? "no email")} · 💰 ${p.coin_balance ?? 0}\n` +
          `    <code>${p.id}</code>`,
      )
      .join("\n\n");
    const title = q ? `👥 <b>Profiles matching "${esc(q)}"</b>` : "👥 <b>Newest profiles</b>";
    await out(`${title}\n\n${list}\n\n✈️ = Telegram linked · /user &lt;email&gt; for more`);
    return true;
  }

  if (cmd === "/addcoins" || cmd === "/setcoins") {
    const m = arg.match(/^(\S+)\s+(-?\d+)(?:\s+(.+))?$/);
    if (!m) {
      await reply(chat_id, `Usage: ${cmd} &lt;email|uuid&gt; &lt;amount&gt; [reason]`);
      return true;
    }
    const [, who, amtStr, reason] = m;
    const amount = parseInt(amtStr, 10);
    const target = await findProfile(admin, who);
    if (!target) {
      await reply(chat_id, noMatch(who));
      return true;
    }
    const note = (reason ?? `telegram_${cmd.slice(1)}`).slice(0, 200);
    // Balance and ledger move by the same amount: an atomic increment, then a
    // ledger row for exactly what was applied (balances never go below 0).
    if (cmd === "/addcoins" && amount === 0) {
      await reply(chat_id, "Amount must be non-zero.");
      return true;
    }
    if (cmd !== "/addcoins" && amount < 0) {
      await reply(chat_id, "Balance must be 0 or positive.");
      return true;
    }
    const current = target.coin_balance ?? 0;
    const delta = cmd === "/addcoins" ? Math.max(amount, -current) : amount - current;
    let newBalance: number = current;
    if (delta !== 0) {
      const { data: updated, error: upErr } = await admin.rpc("increment_coin_balance", {
        _user_id: target.id,
        _delta: delta,
      });
      if (upErr) {
        console.error("[telegram] coin update failed", upErr);
        await reply(chat_id, "⚠️ The balance didn't change. Try again in a moment.");
        return true;
      }
      await admin.from("coin_transactions").insert({
        user_id: target.id,
        amount: delta,
        type: delta > 0 ? "admin_mint" : "admin_deduct",
        reference: note,
      });
      newBalance = typeof updated === "number" ? updated : current + delta;
    }
    const change = delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta}`;
    await reply(
      chat_id,
      `✅ <b>${esc(target.display_name ?? target.email ?? target.id)}</b>\n💰 ${current} → <b>${newBalance}</b> OG coins (${change})`,
    );
    // DM the member too if they're linked and something actually changed.
    if (target.telegram_chat_id && delta !== 0) {
      await reply(
        target.telegram_chat_id,
        `💰 <b>Boss ${delta > 0 ? "topped up" : "adjusted"} your OG coins</b>\nNew balance: <b>${newBalance}</b> OG coins.`,
      );
    }
    return true;
  }

  if (cmd === "/stats") {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [{ count: users }, { count: newToday }, { count: linked }, { data: coinAgg }] =
      await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }),
        admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gte("created_at", dayAgo),
        admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .not("telegram_chat_id", "is", null),
        // Only members holding coins matter for the total.
        admin.from("profiles").select("coin_balance").gt("coin_balance", 0),
      ]);
    const totalCoins = (coinAgg ?? []).reduce(
      (a: number, r: { coin_balance: number | null }) => a + (r.coin_balance ?? 0),
      0,
    );
    const n = (v: number | null) => (v ?? 0).toLocaleString("en-GB");
    await out(
      `📊 <b>OG Streamz right now</b>\n\n` +
        `👥 Members: <b>${n(users)}</b> (+${n(newToday)} in the last 24h)\n` +
        `✈️ On Telegram: <b>${n(linked)}</b>\n` +
        `💰 Coins held: <b>${n(totalCoins)}</b>`,
    );
    return true;
  }

  if (cmd === "/broadcast") {
    if (!arg.trim()) {
      await reply(chat_id, "Usage: /broadcast &lt;message&gt;");
      return true;
    }
    const { data } = await admin
      .from("profiles")
      .select("telegram_chat_id")
      .not("telegram_chat_id", "is", null);
    const rows = ((data ?? []) as { telegram_chat_id: number }[]).filter(
      (r) => r.telegram_chat_id !== chat_id,
    );
    // Boss gets the message first as a preview. If Telegram rejects the
    // formatting (a stray < or &), everyone gets it as plain text instead.
    let body = `📣 <b>OG Streamz</b>\n\n${arg}`;
    if (!(await reply(chat_id, body))) {
      body = `📣 <b>OG Streamz</b>\n\n${esc(arg)}`;
      await reply(chat_id, body);
    }
    await reply(chat_id, `☝️ Preview. Sending to ${rows.length} members…`);
    // A few at a time keeps well inside Telegram's ~30 messages a second.
    const results = await mapPool(rows, 8, (row) =>
      reply(row.telegram_chat_id, body).catch(() => null),
    );
    const sent = results.filter(Boolean).length;
    const failed = rows.length - sent;
    await reply(
      chat_id,
      `✅ Broadcast delivered to <b>${sent}</b> members` +
        (failed ? `\n⚠️ ${failed} couldn't be reached (they may have blocked the bot).` : "."),
    );
    return true;
  }

  return false;
}

async function runChatAI(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  profileId: string,
  chat_id: number,
  userText: string,
  roles: string[],
  group?: GroupContext,
) {
  // In a group, OG B0T answers the member's message in the thread, starting
  // with a mention of them.
  const threaded = group ? groupSendExtra(group) : {};
  const mentioned = (text: string) => withMentions(text, group?.user ? [group.user] : []);
  // Resolve short follow-ups before entering generic chat. The card itself
  // comes from live candles and the deterministic engine, not an AI model.
  const trade = await import("@/lib/trade-signal");
  let tradeText = trade.resolveTradeRequest(userText, []);
  const staff = ["admin", "boss", "dev"].some((role) => roles.includes(role));
  if (
    !group &&
    !tradeText &&
    /\b(signals?|setups?|entry|entries|sl|tp|scalp|swing|bullish|bearish)\b/i.test(userText)
  ) {
    const { data: recent } = await admin
      .from("og_messages")
      .select("role, content, created_at")
      .eq("user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    tradeText = trade.resolveTradeRequest(userText, recent ?? []);
  }
  // 1-minute calls are Boss-only (see ONE_MINUTE_RE); members get the 15-minute read.
  const movedFromOneMinute = !!tradeText && !staff && ONE_MINUTE_RE.test(tradeText);
  if (tradeText && movedFromOneMinute) tradeText = withoutOneMinute(tradeText);
  if (tradeText) {
    const timer = setInterval(() => {
      void tg("sendChatAction", { chat_id, action: "typing" });
    }, 4000);
    try {
      void tg("sendChatAction", { chat_id, action: "typing" });
      const market = trade.detectTradeIntent(tradeText);
      if (!market) return;
      const { buildTradeSignal } = await import("@/lib/trade-signal-context.server");
      const signalJob = buildTradeSignal(tradeText);
      const { pickTradeHold } = await import("@/lib/trade-hold.server");
      const { foulAccess } = await import("@/lib/foul-access.server");
      const tone = (await foulAccess(admin, profileId, roles)).on ? "foul" : "cheeky";
      const picked = await pickTradeHold(admin as never, profileId, market, tone).catch(() =>
        trade.holdingMessage(market, tone),
      );
      const hold = movedFromOneMinute
        ? `1 min calls are Boss-only (too noisy at that speed), so here's the 5 min scalp.\n${picked}`
        : picked;
      const held = await tg("sendMessage", {
        chat_id,
        text: hold,
        disable_web_page_preview: true,
        ...threaded,
      });
      if (!group) await rememberScreen(chat_id, held);
      const signal = await signalJob;
      const ttl = signal.expiresAt
        ? Math.max(1, Date.parse(signal.expiresAt) - Date.now() - 5 * 60_000)
        : 5 * 60_000;
      await scheduleDelete(chat_id, held, ttl);
      const chunks = signal.reply.match(/[\s\S]{1,3800}/g) ?? [signal.reply];
      let firstMessageId: number | null = null;
      const cardIds: number[] = [];
      for (const [i, text] of chunks.entries()) {
        const sent = await tg("sendMessage", {
          chat_id,
          ...(i === 0 ? mentioned(text) : { text }),
          disable_web_page_preview: true,
          ...threaded,
        });
        if (!sent) throw new Error("Signal delivery failed");
        // "No trade right now" cards aren't followed, so the next screen clears them.
        if (!signal.plan && !group) await rememberScreen(chat_id, sent);
        const id = (sent as { result?: { message_id?: number } }).result?.message_id ?? null;
        firstMessageId ??= id;
        if (id) cardIds.push(id);
        await scheduleDelete(chat_id, sent, ttl);
      }
      // Follow it: fills, targets, stops and time-up get a reply under the card.
      if (signal.plan) {
        // A new signal wipes out the last one (see replaceOldSignals).
        await replaceOldSignals(chat_id, cardIds);
      }
      // Group signals are a snapshot: the follow-ups and the member's chat
      // history belong to their private chat.
      if (group) return;
      if (signal.plan) {
        const { recordSignal } = await import("@/lib/trade-signal-tracker.server");
        await recordSignal({
          userId: profileId,
          chatId: chat_id,
          messageId: chunks.length === 1 ? firstMessageId : null,
          card: signal.reply,
          plan: signal.plan,
        });
      }
      const content = signal.expiresAt
        ? trade.tagSignalExpiry(signal.reply, signal.expiresAt)
        : signal.reply;
      await admin.from("og_messages").insert([
        { user_id: profileId, role: "user", content: tradeText },
        { user_id: profileId, role: "assistant", content },
      ]);
    } finally {
      clearInterval(timer);
    }
    return;
  }
  const { aiChatTarget, fetchAiChat, liveFactsMessage, streamAiChat } =
    await import("@/lib/ai-endpoint.server");
  const ai = aiChatTarget(profileId);
  if (!ai) {
    await reply(chat_id, "AI not configured.");
    return;
  }

  // Show "typing…" straight away and keep it alive every 4s (Telegram drops
  // it after ~5s) until the first words of the reply are on screen.
  void tg("sendChatAction", { chat_id, action: "typing" }).catch(() => {});
  const typingTimer = setInterval(() => {
    void tg("sendChatAction", { chat_id, action: "typing" }).catch(() => {});
  }, 4000);
  // Memory, football data and live web facts start now, alongside everything else.
  // Trade requests never get here (they take the signal path above).
  const { startGrounding, checkFigures } = await import("@/lib/og-smarts.server");
  const grounding = startGrounding(admin as never, profileId, userText, false);
  // In a group everyone can read the reply: nothing from the member's account,
  // memory, private history, promo codes or the paid Sports Guide goes in.
  const vp = await import("@/lib/vip-promo.server");
  const { loadUserDossier } = await import("@/lib/og-user-dossier.server");
  const { buildSportsGuideContext } = await import("@/lib/sports-guide-context.server");
  // The full account dossier is heavy — only load it when they ask about their account.
  const wantsAccount =
    !group &&
    /\b(coin|coins|balance|vip|vault|song|songs|track|tracks|account|subscription|plan|bought|purchase|refund|paid|pay|wallet|referr|cashback|expire|status|my id|username)\b/i.test(
      userText,
    );
  const { foulAccess } = await import("@/lib/foul-access.server");
  const [profileRes, foul, siteRes, historyRes, dossier, promo, sportsBlock] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name, email, coin_balance")
      .eq("id", profileId)
      .maybeSingle(),
    foulAccess(admin, profileId, roles),
    cached(
      "og-persona-content",
      60_000,
      async () =>
        await admin
          .from("site_content")
          .select("key, value")
          .in("key", ["og_persona.script", "og_persona.voice", "og_persona.dictionary"]),
    ),
    group
      ? Promise.resolve({ data: [] as { role: string; content: string }[] })
      : admin
          .from("og_messages")
          .select("role, content")
          .eq("user_id", profileId)
          .order("created_at", { ascending: false })
          .limit(20),
    wantsAccount ? loadUserDossier(admin, profileId).catch(() => null) : Promise.resolve(null),
    !group && vp.detectPromoIntent(userText)
      ? vp
          .getOrCreateVipPromo(admin, profileId, { isPaidVip: roles.includes("vip") })
          .catch(() => null)
      : Promise.resolve(null),
    group
      ? Promise.resolve("")
      : buildSportsGuideContext(admin, profileId, userText).catch((e) => {
          console.warn("[telegram] sports guide context failed", e);
          return "";
        }),
  ]);
  const profile = profileRes.data;
  if (!profile) {
    clearInterval(typingTimer);
    await reply(chat_id, "Profile not found.");
    return;
  }

  // Same rule as the website: VIPs, staff, VIP trials and the free-access promo.
  const isVip = foul.allowed;
  const isAdminUser = roles.includes("admin") || roles.includes("boss");

  const personaMap = new Map<string, string>(
    (siteRes.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  );
  const foulMouth = foul.on;

  const userCtx: UserContextSummary = group
    ? {
        display_name: group.name ?? profile.display_name,
        email: null,
        coin_balance: 0,
        is_admin: false,
        is_vip: isVip,
        page_context: "a Telegram group chat",
      }
    : {
        display_name: profile.display_name,
        email: profile.email,
        coin_balance: profile.coin_balance ?? 0,
        is_admin: isAdminUser,
        is_vip: isVip,
        page_context: "telegram",
      };

  const promoNote = promo ? vp.promoPromptNote(promo) : "";
  const sportsNote = sportsBlock ? `${sportsBlock}\n\n` : "";
  const { memoryNote } = await import("@/lib/og-memory");
  const [memories, footballBlock, catchphrases] = await Promise.all([
    grounding.memories,
    grounding.football,
    pickCatchphrases(admin as never, profileId, toneFor("og", foulMouth)),
  ]);

  const system =
    sportsNote +
    promoNote +
    buildSystemPrompt({
      mode: "og",
      foulMouth,
      bossScript: personaMap.get("og_persona.script") ?? null,
      bossVoice: personaMap.get("og_persona.voice") ?? null,
      bossDictionary: personaMap.get("og_persona.dictionary") ?? null,
      learnedInsults: [],
      language: "English",
      user: userCtx,
      songIntent: detectSongIntent(userText),
      dossier,
    }) +
    catchphraseNote(catchphrases) +
    (group ? GROUP_NOTE : memoryNote(memories)) +
    (footballBlock ? `\n\n${footballBlock}` : "");

  const history = group
    ? // Replying to one of OG B0T's group messages: that message is the context.
      group.quoted
      ? [{ role: "assistant" as const, content: group.quoted }]
      : []
    : trade
        .cleanTradeHistory(
          ((historyRes.data ?? []) as { role: string; content: string }[]).reverse(),
        )
        .map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        }));

  // Save user message without holding up the reply (private chat only).
  if (!group)
    void admin
      .from("og_messages")
      .insert({ user_id: profileId, role: "user", content: userText })
      .then(() => {});

  try {
    let currentUserText = userText;
    const research = !sportsNote ? await grounding.research : null;
    if (research) currentUserText = liveFactsMessage(research, userText);
    const chatMessages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: currentUserText },
    ];
    const aiOpts = { foulMouth, smart: true };
    // The reply streams in: first words go out straight away and the message
    // grows as OG Bot writes; it's set to the final text at the end.
    const { createLiveReply } = await import("@/lib/telegram-live-reply");
    // The first message carries the mention (kept on every edit).
    let firstLiveId: number | null = null;
    const live = createLiveReply({
      send: async (text) => {
        const first = firstLiveId === null;
        const res = await tg("sendMessage", {
          chat_id,
          ...(first ? mentioned(text) : { text }),
          disable_web_page_preview: true,
          ...threaded,
        });
        if (first)
          firstLiveId =
            (res as { result?: { message_id?: number } } | null)?.result?.message_id ?? null;
        return res;
      },
      edit: (message_id, text) =>
        tg("editMessageText", {
          chat_id,
          message_id,
          ...(message_id === firstLiveId ? mentioned(text) : { text }),
          disable_web_page_preview: true,
        }),
      onFirst: () => clearInterval(typingTimer),
    });
    const { text: streamed } = await streamAiChat(
      { temperature: foulMouth ? 0.9 : 0.75, messages: chatMessages },
      profileId,
      aiOpts,
      (d) => live.push(d),
    );
    let replyText = streamed.trim() || "…";
    // Self-check: replies built on live data must only quote figures from it.
    if (footballBlock || research) {
      replyText = await checkFigures(
        replyText,
        [system, research ?? "", userText, ...history.map((m) => m.content)],
        async (note) => {
          const { response } = await fetchAiChat(
            {
              temperature: foulMouth ? 0.9 : 0.75,
              messages: [
                ...chatMessages,
                { role: "assistant", content: replyText },
                { role: "user", content: note },
              ],
            },
            profileId,
            aiOpts,
          );
          if (!response.ok) return null;
          const j = (await response.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
          };
          return (j.choices?.[0]?.message?.content ?? "").trim() || null;
        },
      );
    }
    // Remember anything lasting the member just told us (never blocks the
    // reply). Memory only ever learns from private chat.
    if (!group)
      void import("@/lib/og-memory.server").then((m) =>
        m.learnFromMessage(admin as never, profileId, userText, memories),
      );
    if (foulMouth) {
      const { ensureFoulFlavour } = await import("@/lib/og-persona.server");
      replyText = ensureFoulFlavour(replyText);
    }
    if (promo) replyText = vp.ensureCodeInReply(replyText, promo).replace(/\*\*/g, "");

    // Save the reply while it goes out, rather than before.
    const saved = group
      ? Promise.resolve()
      : admin
          .from("og_messages")
          .insert({ user_id: profileId, role: "assistant", content: replyText })
          .then(
            () => {},
            (e: unknown) => console.warn("[telegram] saving reply failed", e),
          );

    // Show the final text in the live message (and any overflow after it).
    const sentLive = await live.finish(replyText);
    for (const res of sentLive) await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
    if (!sentLive.length) {
      // Nothing went out live: send it the normal way.
      // Telegram caps messages at ~4096 chars
      const chunks = replyText.match(/[\s\S]{1,3800}/g) ?? [replyText];
      for (const [i, c] of chunks.entries()) {
        const res = await tg("sendMessage", {
          chat_id,
          ...(i === 0 ? mentioned(c) : { text: c }),
          disable_web_page_preview: true,
          ...threaded,
        });
        await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
      }
    }
    await saved;
  } catch (err) {
    console.error("[telegram] chat reply failed", err);
    await reply(
      chat_id,
      "🛠️ My wires got crossed on that one, fam. Not your fault. Send it again in a sec.",
    );
  } finally {
    clearInterval(typingTimer);
  }
}

/* ── Groups ───────────────────────────────────────────────────────────── */
// OG B0T in Telegram groups. With Telegram's default privacy mode the bot only
// sees commands, replies to its own messages and service messages; it answers
// /og, /signal, /roast and /help, a reply to one of its messages, and an
// @mention (seen when it's a group admin). Everything else is ignored, even
// when it can see it. Only linked members get answers, and account things
// (coins, VIP, Vault, tracks, the paid Sports Guide) stay in the private chat.

type GroupContext = {
  /** The member's message being answered. */
  replyTo?: number;
  /** Forum topic, so answers land in the right one. */
  thread?: number;
  /** Text of OG B0T's own message the member replied to. */
  quoted?: string;
  /** The member's Telegram first name. */
  name?: string;
  /** Who's being answered: their name in the reply is a tap-able mention. */
  user?: TgUser;
};

type TgUser = { id?: number; first_name?: string; username?: string };

/**
 * Starts a group message with a mention of each person it's for (a tap-able
 * name that notifies them, as a Telegram "text_mention"), so everyone can see
 * who OG B0T is answering. Plain text only: entities replace parse_mode.
 */
function withMentions(text: string, users: TgUser[] = []) {
  let prefix = "";
  const entities: Record<string, unknown>[] = [];
  for (const u of users) {
    if (!u.id) continue;
    const label = `@${(u.username || u.first_name || "you").trim()}`;
    entities.push({
      type: "text_mention",
      offset: prefix.length,
      length: label.length,
      user: { id: u.id },
    });
    prefix += `${label} `;
  }
  return entities.length ? { text: prefix + text, entities } : { text };
}

type GroupMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type?: string };
  from?: { id?: number; is_bot?: boolean; first_name?: string; username?: string };
  reply_to_message?: { text?: string; from?: { is_bot?: boolean; username?: string } };
  message_thread_id?: number;
  is_topic_message?: boolean;
  new_chat_members?: { id?: number; is_bot?: boolean; username?: string; first_name?: string }[];
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
};

function groupSendExtra(g: GroupContext) {
  return {
    ...(g.replyTo
      ? { reply_parameters: { message_id: g.replyTo, allow_sending_without_reply: true } }
      : {}),
    ...(g.thread ? { message_thread_id: g.thread } : {}),
  };
}

const GROUP_NOTE =
  "\n\nGROUP CHAT: you're answering one person in a Telegram group, and everyone in it can read your reply. " +
  "Never mention their coins, VIP status, account, email, purchases or anything else private; if they ask, tell them to DM you. " +
  "Keep it short and punchy, a few lines at most.";

const GROUP_HELP =
  "🤖 <b>OG B0T in the group</b>\n\n" +
  "🔥 Say anything and I'll come for you. Gang up if you want, I'll take the lot of you.\n" +
  "🎯 <b>/roast</b> @someone to set me on them\n" +
  "👋 New members get initiated the second they walk in\n" +
  "💬 <b>/og</b> then a proper question\n" +
  "📈 <b>/signal</b> gold or btc, holding or scalp (<code>/signal gold scalp</code>)\n\n" +
  "I only answer people connected to OG B0T. Not connected? I'll give you the link. Coins, VIP, the Vault and your tracks stay private in my DM.";

const CONNECT_NUDGE =
  "👋 I don't know you yet. Connect your Telegram to OG B0T and I'm all yours. " +
  "Free account, takes a minute 👇";

const connectButton = async () => ({
  inline_keyboard: [
    [{ text: "🔗 Connect to OG B0T", url: `https://t.me/${await botUsername()}?start=connect` }],
  ],
});

/** The OG B0T account linked to this Telegram user, if any. */
async function linkedProfileId(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  telegramUserId: number | undefined,
): Promise<string | null> {
  if (!telegramUserId) return null;
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", telegramUserId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// Asked to connect at most once a day per group (telegram_group_nudges; this
// map stands in until that table exists).
const NUDGE_EVERY_MS = 24 * 3_600_000;
const NUDGES = "telegram_group_nudges" as never;
const nudgedFallback = new Map<string, number>();

async function markNudged(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chatId: number,
  userId: number,
) {
  const { error } = await admin
    .from(NUDGES)
    .upsert(
      { chat_id: chatId, telegram_user_id: userId, nudged_at: new Date().toISOString() } as never,
      { onConflict: "chat_id,telegram_user_id" },
    );
  if (error) nudgedFallback.set(`${chatId}:${userId}`, Date.now());
}

/** Whether to ask this person to connect now; records it if so. */
async function shouldNudge(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const { data, error } = await admin
    .from(NUDGES)
    .select("nudged_at")
    .eq("chat_id" as never, chatId)
    .eq("telegram_user_id" as never, userId)
    .maybeSingle();
  const last = error
    ? nudgedFallback.get(`${chatId}:${userId}`)
    : data
      ? Date.parse((data as { nudged_at: string }).nudged_at)
      : undefined;
  if (last && Date.now() - last < NUDGE_EVERY_MS) return false;
  await markNudged(admin, chatId, userId);
  return true;
}

/** Sends a roast-battle line in a group (plain text, as the AI wrote it). */
async function sendGroupBattleLine(
  chat_id: number,
  text: string,
  ctx: GroupContext,
  extra: Record<string, unknown> = {},
) {
  const res = await tg("sendMessage", {
    chat_id,
    ...withMentions(text.slice(0, 3900), ctx.user ? [ctx.user] : []),
    disable_web_page_preview: true,
    ...groupSendExtra(ctx),
    ...extra,
  });
  await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
}

const GROUP_HELLO = "<b>OG B0T's in the chat.</b> Behave yourselves. Or don't.\n\n";
const GROUP_NOT_BOSS = "🚫 Only the Boss can add OG B0T to groups. I'm off ✌️";

/** Whether this Telegram user is linked to a Boss (or admin) account. */
async function isBossTelegramUser(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  telegramUserId: number | undefined,
): Promise<boolean> {
  if (!telegramUserId) return false;
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", telegramUserId)
    .maybeSingle();
  if (!profile) return false;
  return (await isAdmin(admin, profile.id)).admin;
}

const GROUP_SIGNAL_TEXT = "📈 <b>Live signals</b>\nPick one 👇";
const GROUP_SIGNAL_BUTTONS = {
  inline_keyboard: [
    [
      { text: "🥇 Gold · Holding", callback_data: "gsig:XAU:1h" },
      { text: "🥇 Gold · Scalp", callback_data: "gsig:XAU:5m" },
    ],
    [
      { text: "₿ BTC · Holding", callback_data: "gsig:BTC:1h" },
      { text: "₿ BTC · Scalp", callback_data: "gsig:BTC:5m" },
    ],
  ],
};

// Commands about the member's own account: answered in the DM only.
const PRIVATE_COMMANDS = new Set([
  "balance",
  "buy",
  "vip",
  "vault",
  "tracks",
  "library",
  "me",
  "menu",
  "clear",
  "sports",
  "stats",
  "users",
  "user",
  "find",
  "inspect",
  "whois",
  "addcoins",
  "setcoins",
  "broadcast",
]);

const BOT_USERNAME_FALLBACK = "OGStreamzBot";
function botUsername(): Promise<string> {
  return cached("telegram-bot-username", 6 * 3_600_000, async () => {
    const me = (await tg("getMe", {})) as { result?: { username?: string } } | null;
    return me?.result?.username || BOT_USERNAME_FALLBACK;
  });
}

const dmButton = async (text: string) => ({
  inline_keyboard: [[{ text, url: `https://t.me/${await botUsername()}` }]],
});

async function handleGroupMessage(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  msg: GroupMessage,
): Promise<Response> {
  const chat_id = msg.chat.id;
  const ignored = () => Response.json({ ok: true, ignored: "group" });
  const me = (await botUsername()).toLowerCase();
  const thread = msg.is_topic_message ? msg.message_thread_id : undefined;

  // Just added to a group (or a group was created with OG B0T in it). Only
  // the Boss can do that: anyone else gets a line and the bot leaves.
  const addedMe =
    msg.new_chat_members?.some((u) => u.is_bot && u.username?.toLowerCase() === me) ||
    msg.group_chat_created ||
    msg.supergroup_chat_created;
  if (addedMe) {
    const inTopic = thread ? { message_thread_id: thread } : {};
    if (!(await isBossTelegramUser(admin, msg.from?.id))) {
      await reply(chat_id, GROUP_NOT_BOSS, inTopic, 0);
      await tg("leaveChat", { chat_id });
      return Response.json({ ok: true, group: "left_not_boss" });
    }
    await reply(chat_id, GROUP_HELLO + GROUP_HELP, inTopic, 0);
    return Response.json({ ok: true, group: "hello" });
  }

  // New people joined: OG B0T initiates them, Battle Zone style. Anyone without
  // an OG B0T account gets a Connect button with it.
  const newcomers = (msg.new_chat_members ?? []).filter((u) => !u.is_bot);
  if (newcomers.length) {
    const unknown: typeof newcomers = [];
    for (const u of newcomers) if (!(await linkedProfileId(admin, u.id))) unknown.push(u);
    const { newMemberRoast } = await import("@/lib/telegram-group-battle.server");
    const roast = await newMemberRoast(admin, chat_id, newcomers).catch((e) => {
      console.warn("[telegram] new member roast failed", e);
      return null;
    });
    const connect = unknown.length ? { reply_markup: await connectButton() } : {};
    const joined = { replyTo: msg.message_id, thread };
    if (!roast && !unknown.length) return Response.json({ ok: true, group: "quiet" });
    const res = await tg("sendMessage", {
      chat_id,
      ...withMentions(roast ? roast.slice(0, 3900) : CONNECT_NUDGE, roast ? newcomers : unknown),
      disable_web_page_preview: true,
      ...groupSendExtra(joined),
      ...connect,
    });
    await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
    for (const u of unknown) if (u.id) await markNudged(admin, chat_id, u.id);
    return Response.json({ ok: true, group: roast ? "initiated" : "quiet" });
  }

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text || msg.from?.is_bot) return ignored();
  const command = /^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text);
  // Another bot's command.
  if (command?.[2] && command[2].toLowerCase() !== me) return ignored();
  const repliedToMe =
    !!msg.reply_to_message?.from?.is_bot &&
    msg.reply_to_message.from.username?.toLowerCase() === me;
  const mention = new RegExp(`@${me}\\b`, "gi");
  const mentioned = new RegExp(`@${me}\\b`, "i").test(text);
  const withoutMention = (t: string) =>
    t
      .replace(mention, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

  const ctx: GroupContext = {
    replyTo: msg.message_id,
    thread,
    name: msg.from?.first_name,
    user: msg.from,
    quoted: repliedToMe ? msg.reply_to_message?.text?.slice(0, 1500) : undefined,
  };
  const answer = (body: string, extra: Record<string, unknown> = {}) =>
    reply(chat_id, body, { ...groupSendExtra(ctx), ...extra });

  // OG B0T answers everyone connected to OG B0T. Anyone else is asked to
  // connect (once a day per group) and otherwise left alone.
  const fromId = msg.from?.id;
  const nudge = async () => {
    if (!fromId || !(await shouldNudge(admin, chat_id, fromId)))
      return Response.json({ ok: true, group: "quiet_unknown" });
    const res = await tg("sendMessage", {
      chat_id,
      ...withMentions(CONNECT_NUDGE, ctx.user ? [ctx.user] : []),
      ...groupSendExtra(ctx),
      reply_markup: await connectButton(),
    });
    await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
    return Response.json({ ok: true, group: "nudged" });
  };
  // A roast battle, Battle Zone style.
  const battle = async (line: string) => {
    if (!(await linkedProfileId(admin, fromId))) return nudge();
    void tg("sendChatAction", {
      chat_id,
      action: "typing",
      ...(thread ? { message_thread_id: thread } : {}),
    });
    const { groupBattleReply } = await import("@/lib/telegram-group-battle.server");
    const clapback = await groupBattleReply(admin, {
      chatId: chat_id,
      name: ctx.name ?? null,
      text: line,
      quoted: ctx.quoted,
    }).catch((e) => {
      console.warn("[telegram] group battle failed", e);
      return null;
    });
    if (clapback) await sendGroupBattleLine(chat_id, clapback, ctx);
    return Response.json({ ok: true, group: clapback ? "battle" : "quiet" });
  };

  let ask: string;
  if (command) {
    const cmd = command[1].toLowerCase();
    const arg = withoutMention(command[3] ?? "");
    if (cmd === "og" || cmd === "ask") {
      if (!arg) {
        await answer(GROUP_HELP);
        return Response.json({ ok: true, group: "help" });
      }
      ask = arg;
    } else if (cmd === "start" || cmd === "help") {
      await answer(GROUP_HELP);
      return Response.json({ ok: true, group: "help" });
    } else if (cmd === "signal" || cmd === "signals") {
      const pair = /\b(gold|xau)/i.test(arg) ? "XAU" : /\b(btc|bitcoin)/i.test(arg) ? "BTC" : null;
      if (!pair) {
        await answer(GROUP_SIGNAL_TEXT, { reply_markup: GROUP_SIGNAL_BUTTONS });
        return Response.json({ ok: true, group: "signals" });
      }
      ask = signalRequest(pair, /\b(scalp|5\s?m)\b/i.test(arg) ? "5m" : "1h");
    } else if (cmd === "roast") {
      return battle(arg ? `roast ${arg}` : "roast me");
    } else if (PRIVATE_COMMANDS.has(cmd)) {
      await answer("🔒 That's between you and me. Ask me in our DM 👇", {
        reply_markup: await dmButton("💬 Open my DM"),
      });
      return Response.json({ ok: true, group: "private" });
    } else {
      // Not one of ours (another bot's command without its @name).
      return ignored();
    }
  } else {
    // Anything else said in the group gets an answer, unless it's a reply to
    // someone else (people talking to each other) without an @mention.
    if (msg.reply_to_message && !repliedToMe && !mentioned) return ignored();
    const line = withoutMention(text);
    if (!line) {
      await answer(GROUP_HELP);
      return Response.json({ ok: true, group: "help" });
    }
    return battle(line);
  }

  // /og and /signal answers come from the member's own account.
  const profileId = await linkedProfileId(admin, fromId);
  if (!profileId) return nudge();
  const { roles } = await isAdmin(admin, profileId);
  await runChatAI(admin, profileId, chat_id, ask, roles, ctx);
  return Response.json({ ok: true, group: "answered" });
}

function startMatchKind(text: string | undefined): string {
  if (typeof text !== "string") return "non_text";
  const t = text.trim();
  if (/^\/start\b/i.test(t)) return "start";
  if (/^\//.test(t)) return "command";
  return "message";
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const tgKey = process.env.TELEGRAM_API_KEY;
        if (!tgKey) return new Response("not_configured", { status: 500 });

        const expected = deriveSecret(tgKey);
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, expected)) return new Response("unauthorized", { status: 401 });

        const update = await request.json().catch(() => null);
        const updateId: number | undefined =
          typeof update?.update_id === "number" ? update.update_id : undefined;
        if (update?.callback_query) {
          // Claim callbacks too: retries must not generate duplicate signals.
          const callbackChat = update.callback_query.message?.chat?.id;
          if (typeof updateId === "number" && typeof callbackChat === "number") {
            const admin = await loadAdmin();
            const { error } = await admin
              .from("telegram_processed_updates")
              .insert({ update_id: updateId, chat_id: callbackChat, kind: "callback" });
            if (error?.code === "23505") {
              await tg("answerCallbackQuery", { callback_query_id: update.callback_query.id });
              return Response.json({ ok: true, duplicate: true });
            }
            if (error) return Response.json({ ok: false }, { status: 503 });
          }
          return await handleCallbackQuery(update.callback_query);
        }
        // ---- Sports Guide feed: mirror posts from the sports channel/group.
        const sgPost =
          update?.channel_post ??
          update?.edited_channel_post ??
          (update?.message?.chat?.id === SPORTS_GUIDE_CHAT_ID ? update.message : null) ??
          (update?.edited_message?.chat?.id === SPORTS_GUIDE_CHAT_ID
            ? update.edited_message
            : null);
        if (sgPost) {
          if (sgPost.chat?.id !== SPORTS_GUIDE_CHAT_ID) {
            return Response.json({ ok: true, ignored: "other_channel" });
          }
          const body: string = (sgPost.text ?? sgPost.caption ?? "").trim();
          if (body) {
            const sgAdmin = await loadAdmin();
            const { error: sgErr } = await sgAdmin.from("sports_guide_posts").upsert(
              {
                chat_id: SPORTS_GUIDE_CHAT_ID,
                telegram_message_id: sgPost.message_id,
                raw_text: body.slice(0, 8000),
                sport_category: detectSport(body),
                event_time: detectEventTime(body),
                posted_at: new Date((sgPost.date ?? Date.now() / 1000) * 1000).toISOString(),
              },
              { onConflict: "chat_id,telegram_message_id" },
            );
            if (sgErr) console.error("[telegram] sports guide upsert failed", sgErr);
          }
          return Response.json({ ok: true, sports_guide: true });
        }

        const msg = update?.message ?? update?.edited_message;
        const chat_id: number | undefined = msg?.chat?.id;
        const text: string | undefined = msg?.text;
        if (!chat_id) return Response.json({ ok: true, ignored: true });

        const admin = await loadAdmin();

        // ---- Idempotency: claim this update_id atomically. Telegram retries
        // on slow handlers, so without this a single /start could link twice
        // or a chat message could be charged twice.
        if (typeof updateId === "number") {
          const { error: dupErr } = await admin
            .from("telegram_processed_updates")
            .insert({ update_id: updateId, chat_id, kind: startMatchKind(text) });
          if (dupErr) {
            const code = (dupErr as { code?: string }).code;
            if (code === "23505") {
              return Response.json({ ok: true, duplicate: true, update_id: updateId });
            }
            console.error("[telegram] processed_updates insert failed", dupErr);
          }
        }

        try {
          // Groups get their own, quieter handling (see handleGroupMessage).
          if (msg.chat?.type === "group" || msg.chat?.type === "supergroup") {
            if (!update?.message) return Response.json({ ok: true, ignored: "group_edit" });
            return await handleGroupMessage(admin, msg);
          }
          return await handleTelegramUpdate(admin, chat_id, text, msg);
        } catch (err) {
          console.error("[telegram] handler error", err);
          await reply(
            chat_id,
            "🛠️ My wires got crossed on that one, fam — not your fault. Give it a sec and send it again.",
          ).catch(() => undefined);
          return Response.json(
            { ok: false, error: (err as Error)?.message ?? "handler_error" },
            { status: 200 },
          );
        }
      },
    },
  },
});

async function handleTelegramUpdate(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chat_id: number,
  text: string | undefined,
  msg: {
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string; first_name?: string };
    /** Came from a menu panel button: the screen gets a "⬅️ Menu" button. */
    viaMenu?: boolean;
  },
): Promise<Response> {
  // Look up linked profile by chat_id FIRST so already-linked users
  // get full chat + admin commands without needing /start.
  const { data: linkedProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chat_id)
    .maybeSingle();

  const startMatch = typeof text === "string" ? text.match(/^\/start\s+(\S+)/i) : null;

  // ===== Linked user path =====
  if (linkedProfile && typeof text === "string") {
    let trimmed = text.trim();
    const { admin: isBoss, roles } = await isAdmin(admin, linkedProfile.id);
    // Buttons to the site sign the member straight into this account (see
    // telegram-signin.server.ts), so Telegram's browser never starts a new one.
    const { telegramSignInLinker } = await import("@/lib/telegram-signin.server");
    const siteLink = telegramSignInLinker(admin, linkedProfile.id);
    const show = (body: string, extra?: Record<string, unknown>, ttlMs?: number) =>
      screen(chat_id, body, msg.viaMenu ? withMenuBack(extra) : extra, ttlMs);

    // Map emoji-keyboard button taps → slash commands
    const buttonMap: Record<string, string> = {
      "💰 Balance": "/balance",
      "🎧 Library": "/library",
      "🛒 Buy Coins": "/buy",
      "👤 My Profile": "/me",
      "👑 VIP Status": "/vip",
      "❓ Help": "/help",
      "⚽ Sports Guide": "/sports",
      [CLEAR]: "/clear",
      "🔐 Vault ID": "/vault",
      ...(isBoss ? { "📊 Stats": "/stats", "👥 Users": "/users" } : {}),
    };
    if (buttonMap[trimmed]) trimmed = buttonMap[trimmed];

    // A tap on a bottom-bar or old menu button (or a menu command) is tidied
    // away too; anything the member actually wrote stays.
    const tapped =
      trimmed !== text.trim() ||
      [MENU, SIGNALS_BUTTON, SITE, BACK_BUTTON].includes(trimmed) ||
      Object.hasOwn(SIGNAL_BUTTONS, trimmed) ||
      OLD_MENU_BUTTONS.has(trimmed) ||
      /^\/(menu|signals|help|sports|balance|tracks|library|buy|me|vault|vip)(@\w+)?$/i.test(
        trimmed,
      );
    const tapId = (msg as { message_id?: number }).message_id;
    if (tapped && tapId && trimmed !== "/clear") {
      void tg("deleteMessage", { chat_id, message_id: tapId });
    }

    // Signals swap the bottom bar for the signal buttons, which then stay put
    // however many signals are run, until Back.
    if (trimmed === SIGNALS_BUTTON || /^\/signals(?:@\w+)?$/i.test(trimmed)) {
      await setKeys(chat_id, SIGNALS_TEXT, kb(signalButtonRows(isBoss)));
      await tidyScreens(chat_id);
      return Response.json({ ok: true, signals: "menu" });
    }
    // A signal button in the bottom bar: straight to the live signal.
    const signalButton = Object.hasOwn(SIGNAL_BUTTONS, trimmed) ? SIGNAL_BUTTONS[trimmed] : null;
    if (signalButton && (!signalButton.bossOnly || isBoss)) {
      await tidyScreens(chat_id);
      await runChatAI(
        admin,
        linkedProfile.id,
        chat_id,
        signalRequest(signalButton.pair, signalButton.timeframe),
        roles,
      );
      return Response.json({ ok: true, signals: "run" });
    }
    if (trimmed === BACK_BUTTON) {
      await setKeys(chat_id, MAIN_KEYS_TEXT, USER_KEYBOARD);
      await tidyScreens(chat_id);
      return Response.json({ ok: true, menu: "back" });
    }
    if (trimmed === MENU || /^\/menu\b/i.test(trimmed) || OLD_MENU_BUTTONS.has(trimmed)) {
      // An old category keyboard gets swapped back to the normal bottom bar first.
      if (OLD_MENU_BUTTONS.has(trimmed)) await setKeys(chat_id, MAIN_KEYS_TEXT, USER_KEYBOARD);
      const { foulAccess } = await import("@/lib/foul-access.server");
      const foul = await foulAccess(admin, linkedProfile.id, roles);
      await screen(chat_id, MENU_TEXT, {
        reply_markup: menuPanel(isBoss, await siteLink("/"), foul),
      });
      return Response.json({ ok: true, menu: true });
    }

    if (trimmed === SITE) {
      await screen(chat_id, "🌐 <b>OG B0T on the web</b>\nYou'll be signed straight in.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🌐 Open OGBOT.CO.UK", url: await siteLink("/") }]],
        },
      });
      return Response.json({ ok: true, site: true });
    }

    if (/^\/start\b/i.test(trimmed)) {
      await sendIntro(chat_id);
      return Response.json({ ok: true, intro: true });
    }
    if (/^\/clear\b/i.test(trimmed)) {
      const mid = (msg as { message_id?: number }).message_id;
      if (mid) await clearRecentChat(chat_id, mid);
      await forgetScreens(chat_id);
      await admin.from("og_messages").delete().eq("user_id", linkedProfile.id);
      await sendIntro(chat_id);
      return Response.json({ ok: true, cleared: true });
    }
    if (/^\/help\b/i.test(trimmed)) {
      await show(isBoss ? HELP_ADMIN : HELP_USER);
      return Response.json({ ok: true, help: true });
    }
    if (/^\/sports\b/i.test(trimmed)) {
      const { quickSportsReply } = await import("@/lib/sports-guide-context.server");
      const q = trimmed.replace(/^\/sports(@\w+)?/i, "").trim();
      let body = "⚽ <b>OG Sports Guide</b>";
      try {
        body = await quickSportsReply(admin, linkedProfile.id, q);
      } catch (e) {
        console.warn("[telegram] quick sports failed", e);
      }
      if (!q) body += "\n\nTip: send <code>/sports arsenal</code> or <code>/sports dazn</code>";
      await show(body.slice(0, 4000), {
        reply_markup: {
          inline_keyboard: [[{ text: "⚽ Open Sports Guide", url: await siteLink("/sports") }]],
        },
      });
      return Response.json({ ok: true, sports: true });
    }
    if (/^\/balance\b/i.test(trimmed)) {
      const { data: p } = await admin
        .from("profiles")
        .select("coin_balance")
        .eq("id", linkedProfile.id)
        .maybeSingle();
      await show(`💰 <b>${p?.coin_balance ?? 0}</b> OG coins`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🛒 Top up", url: await siteLink("/store") }]],
        },
      });
      return Response.json({ ok: true, balance: true });
    }
    if (/^\/(library|tracks)\b/i.test(trimmed)) {
      const { data: songs } = await admin
        .from("songs")
        .select("id, title, style, is_public, revealed")
        .eq("user_id", linkedProfile.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5);
      const list = songs ?? [];
      const body = list.length
        ? "🎧 <b>Your latest tracks</b>\n\n" +
          list
            .map(
              (s, i) =>
                `${i + 1}. <b>${esc(s.title || "Untitled")}</b>${s.style ? ` — ${esc(String(s.style).slice(0, 40))}` : ""}`,
            )
            .join("\n") +
          "\n\n⬇️ sends the track here in Telegram to keep. ▶️ opens it in the app."
        : "🎧 <b>No finished tracks yet</b>\nGo make one, it only takes a minute.";
      const libraryLinks = await Promise.all(list.map((s) => siteLink(`/library/${s.id}`)));
      const rows = list.map((s, i) => [
        { text: `⬇️ ${(s.title || "Untitled").slice(0, 24)}`, callback_data: `track:${s.id}` },
        { text: "▶️ Open", url: libraryLinks[i] },
        ...(s.is_public && s.revealed
          ? [
              {
                text: "🔗 Share",
                url: `https://t.me/share/url?url=${encodeURIComponent(`https://ogbot.co.uk/track/${s.id}`)}`,
              },
            ]
          : []),
      ]);
      rows.push([
        list.length
          ? { text: "📚 Open full library", url: await siteLink("/library") }
          : { text: "🎵 Make a track", url: await siteLink("/") },
      ]);
      await show(body, { reply_markup: { inline_keyboard: rows } });
      return Response.json({ ok: true, library: true });
    }
    if (/^\/buy\b/i.test(trimmed)) {
      await show("🛒 <b>Top up OG coins</b>\nCoins, VIP and the Vault pass are all in the Store.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🛒 Open Store", url: await siteLink("/store") }]],
        },
      });
      return Response.json({ ok: true, buy: true });
    }
    if (/^\/me\b/i.test(trimmed)) {
      const { data: p } = await admin
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("id", linkedProfile.id)
        .maybeSingle();
      await show(p ? fmtProfile(p as AdminProfile) : "Profile not found.");
      return Response.json({ ok: true, me: true });
    }
    if (
      /^\/vault\b/i.test(trimmed) ||
      (/\bvault\b/i.test(trimmed) &&
        /\b(pin|id|code|login|password|pass|access|username|details)\b/i.test(trimmed))
    ) {
      const [{ data: purchase }, { data: creds }] = await Promise.all([
        admin.from("vip_pass_purchases").select("id").eq("user_id", linkedProfile.id).maybeSingle(),
        admin
          .from("vip_pass_credentials")
          .select("username,password")
          .eq("active", true)
          .order("created_at", { ascending: true }),
      ]);
      // Vault is independent of VIP and the intro offer: bought or Boss only.
      const owned = !!purchase || isBoss;
      // Rotate the wording so repeat asks don't get the same canned line.
      const pick = <T>(arr: T[]): T =>
        arr[(Math.floor(Date.now() / (10 * 60 * 1000)) + String(chat_id).length) % arr.length];
      const notOwnedLines = [
        `🔐 <b>OG Vault Access Pass</b>\n\nYou need to buy the Vault Access Pass — grab it in the Store for £10 or 50 OG Coins.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nNo pass, no entry. It's £10 or 50 OG Coins in the Store — sort that and come back.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nThe Vault's locked for you right now. Pick up a pass in the Store for £10 or 50 OG Coins.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nYou're not on the list. Vault pass is £10 or 50 OG Coins — Store link's below.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nGotta buy the pass first — £10 or 50 OG Coins in the Store, then I'll hand over your details.`,
      ];
      const noCredsLines = [
        `🔐 <b>OG Vault Access Pass</b>\n\nYou own it ✅ — no access IDs are available right now, check back soon.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nYou're covered ✅ — but I'm fresh out of access IDs at the moment. Try again a bit later.`,
        `🔐 <b>OG Vault Access Pass</b>\n\nPass confirmed ✅ — no spare IDs in the drawer right now, check back soon.`,
      ];
      let body: string;
      if (!owned) {
        body = pick(notOwnedLines);
      } else if (!creds?.length) {
        body = pick(noCredsLines);
      } else {
        const cred = creds[Math.floor(Date.now() / (2 * 60 * 60 * 1000)) % creds.length];
        body =
          `🔐 <b>Your OG Vault Access</b>\n\n` +
          `🆔 ID: <code>${esc(cred.username)}</code>\n` +
          `🔑 PIN: <code>${esc(cred.password)}</code>\n\n` +
          `⚠️ <b>Important:</b> sign out of the Vault first, then sign in with these details.\n\n` +
          `Tap to copy. Keep it private.\n\n⏳ <i>For your security, this message self-destructs in 1 hour.</i>`;
      }
      await show(
        body,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🛒 Open Store", url: await siteLink("/store") }]],
          },
        },
        owned && creds?.length ? VAULT_TTL_MS : undefined,
      );
      return Response.json({ ok: true, vault: true });
    }
    if (/^\/vip\b/i.test(trimmed)) {
      const [{ data: p }, { data: sub }, { data: vipRow }] = await Promise.all([
        admin
          .from("profiles")
          .select("display_name, og_vip_id, vip_trial_ends_at")
          .eq("id", linkedProfile.id)
          .maybeSingle(),
        admin
          .from("subscriptions")
          .select("status, current_period_end, cancel_at_period_end")
          .eq("user_id", linkedProfile.id)
          .order("current_period_end", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("user_roles")
          .select("expires_at")
          .eq("user_id", linkedProfile.id)
          .eq("role", "vip")
          .maybeSingle(),
      ]);
      const now = Date.now();
      const fmtDate = (iso: string) =>
        new Date(iso).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      const paidEnd =
        sub && ["active", "trialing"].includes(sub.status ?? "") && sub.current_period_end
          ? new Date(sub.current_period_end).getTime()
          : null;
      const trialEnd =
        p?.vip_trial_ends_at && new Date(p.vip_trial_ends_at).getTime() > now
          ? new Date(p.vip_trial_ends_at).getTime()
          : null;
      const isVipRole = roles.includes("vip") || isBoss;
      const vipId = p?.og_vip_id ? `🆔 <b>${esc(p.og_vip_id)}</b>\n` : "";

      let body: string;
      if (paidEnd && paidEnd > now) {
        body =
          `👑 <b>You're OG VIP!</b>\n\n` +
          vipId +
          `📅 Renews/expires: <b>${fmtDate(new Date(paidEnd).toISOString())}</b>` +
          (sub?.cancel_at_period_end ? " (cancelled — VIP ends on this date)" : " (auto-renews)");
      } else if (trialEnd) {
        const daysLeft = Math.ceil((trialEnd - now) / 86400000);
        body =
          `👑 <b>Free VIP trial active!</b>\n\n` +
          vipId +
          `📅 Trial ends: <b>${fmtDate(new Date(trialEnd).toISOString())}</b> (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)\n\n` +
          `Upgrade in the app to keep VIP after the trial.`;
      } else if (
        roles.includes("vip") &&
        vipRow?.expires_at &&
        new Date(vipRow.expires_at).getTime() > now
      ) {
        const daysLeft = Math.ceil((new Date(vipRow.expires_at).getTime() - now) / 86400000);
        body =
          `👑 <b>You're OG VIP!</b>\n\n` +
          vipId +
          `📅 VIP ends: <b>${fmtDate(vipRow.expires_at)}</b> (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)`;
      } else if (isVipRole) {
        body = `👑 <b>You're OG VIP!</b>\n\n` + vipId + `📅 No expiry — lifetime/boss VIP.`;
      } else {
        body =
          `🆓 <b>Free plan</b>, no active VIP.\n\n` +
          `VIP unlocks every style, Foul Mouth mode and your own OG VIP ID.`;
      }
      await show(body, {
        reply_markup: {
          inline_keyboard: [[{ text: "👑 Open VIP Store", url: await siteLink("/store") }]],
        },
      });
      return Response.json({ ok: true, vip: true });
    }
    // Admin commands
    if (isBoss && trimmed.startsWith("/")) {
      const handled = await runAdminCommand(admin, chat_id, trimmed, msg.viaMenu);
      if (handled) return Response.json({ ok: true, admin_cmd: true });
    }

    // Anything else starting with / isn't a command we know.
    if (trimmed.startsWith("/")) {
      await screen(chat_id, "🤷 I don't know that one. /help shows everything I can do.");
      return Response.json({ ok: true, unknown_cmd: true });
    }

    // Otherwise route to AI chat
    await runChatAI(admin, linkedProfile.id, chat_id, text, roles);
    return Response.json({ ok: true, chatted: true });
  }

  // ===== Not linked yet =====
  // Boss bootstrap runs on ANY message (not just /start) so the boss
  // gets auto-linked even if they just say "hi" from a known username.
  {
    const bootstrapped = await maybeBootstrapBossTelegram(admin, chat_id, msg);
    if (bootstrapped) return Response.json({ ok: true, boss_bootstrap: true });
  }

  if (typeof text === "string" && /^\/help\b/i.test(text.trim())) {
    await reply(chat_id, `🤖 <b>OG B0T is online.</b>\n\n${LINK_STEPS}`, {
      reply_markup: UNLINKED_KEYBOARD,
    });
    return Response.json({ ok: true, help: true });
  }

  if (!startMatch) {
    const unlinkedText = typeof text === "string" ? text.trim() : "";
    if (unlinkedText === CLEAR) {
      const mid = (msg as { message_id?: number }).message_id;
      if (mid) await clearRecentChat(chat_id, mid);
      await reply(chat_id, `${INTRO_TEXT}\n\n${LINK_STEPS}`, { reply_markup: UNLINKED_KEYBOARD });
      return Response.json({ ok: true, cleared: true });
    }
    if (unlinkedText === SITE) {
      await reply(chat_id, "🌐 <b>OG B0T on the web</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🌐 Open OGBOT.CO.UK", url: "https://ogbot.co.uk" }]],
        },
      });
      return Response.json({ ok: true, site: true });
    }
    if (/^\/start\b/i.test(unlinkedText)) {
      await reply(chat_id, INTRO_TEXT, { reply_markup: UNLINKED_KEYBOARD }, 0);
      await sendConnectLink(admin, chat_id, msg);
      return Response.json({ ok: true, missing_token: true });
    }
    await sendConnectLink(admin, chat_id, msg, "👋 <b>Nearly there.</b>");
    return Response.json({ ok: true, unlinked_reply: true });
  }

  // "Connect" from a group (t.me/…?start=connect): their own one-time link.
  if (startMatch[1].toLowerCase() === "connect") {
    await sendConnectLink(admin, chat_id, msg);
    return Response.json({ ok: true, connect_link: true });
  }

  const rawToken = startMatch[1].toLowerCase();
  const tokenMatch = rawToken.match(TOKEN_RE);
  if (!tokenMatch) {
    await reply(
      chat_id,
      "⚠️ That Telegram connect link is invalid. Please generate/open a fresh link from OG Streamz → Settings → Connect Telegram.",
    );
    return Response.json({ ok: true, rejected: "bad_token_format" });
  }
  const token = tokenMatch[1];

  let profileId: string | null = null;

  if (token.startsWith("t_")) {
    const { data: byToken } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_link_token", token)
      .limit(2);
    if (!byToken || byToken.length !== 1) {
      await reply(
        chat_id,
        "⚠️ That Telegram connect link has expired or was already used. Please generate/open a fresh link from OG Streamz → Settings.",
      );
      return Response.json({ ok: true, rejected: "no_or_ambiguous_match" });
    }
    profileId = byToken[0].id as string;
  } else {
    // Old links were made from the account id, which isn't secret (it appears
    // in referral links). Only random t_ tokens can link a chat now.
    await reply(
      chat_id,
      "⚠️ That's an old connect link. Open a fresh one from OG Streamz → Settings → Connect Telegram.",
    );
    return Response.json({ ok: true, rejected: "legacy_token" });
  }

  // Verify chat reachable
  const chatVerified = await verifyTelegramChat(chat_id);

  if (!chatVerified) {
    await reply(
      chat_id,
      "⚠️ I received your Start request, but Telegram chat verification failed. Please tap Start again in a moment.",
    );
    return Response.json({ ok: true, rejected: "chat_verification_failed" }, { status: 200 });
  }

  const { error: linkError } = await admin
    .from("profiles")
    .update({
      telegram_chat_id: chat_id,
      telegram_username: msg?.from?.username ?? null,
      telegram_linked_at: new Date().toISOString(),
      telegram_link_token: null,
    })
    .eq("id", profileId);

  if (linkError) {
    console.error("[telegram] link failed", linkError);
    await reply(
      chat_id,
      "⚠️ I couldn't link this chat just now. Open a fresh link from Settings and try again.",
    );
    return Response.json({ ok: true, rejected: "profile_update_failed" });
  }

  await admin
    .from("telegram_sign_in_events")
    .insert({
      user_id: profileId,
      chat_id,
      telegram_username: msg?.from?.username ?? null,
      telegram_first_name: (msg?.from?.first_name as string | undefined) ?? null,
      event_kind: "link",
      source: "webhook_start",
    })
    .then(
      () => undefined,
      () => undefined,
    );

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, email, coin_balance")
    .eq("id", profileId)
    .maybeSingle();

  const { admin: isBoss } = await isAdmin(admin, profileId);

  const tgFirst = (msg?.from?.first_name as string | undefined)?.trim();
  const name =
    tgFirst ||
    profile?.display_name ||
    (profile?.email ? profile.email.split("@")[0] : null) ||
    "legend";
  const balance = profile?.coin_balance ?? 0;

  const greeting =
    `✅ <b>Connected, ${esc(name)}!</b>\n💰 <b>${balance}</b> OG coins` +
    (isBoss ? `\n\n👑 Boss mode on. Boss tools are under 📂 Menu, /help lists every command.` : "");

  await reply(chat_id, greeting);
  await sendIntro(chat_id);

  await admin
    .from("og_messages")
    .insert({
      user_id: profileId,
      role: "assistant",
      content: `✅ Telegram linked. I'll DM you at @${msg?.from?.username ?? "your handle"} from now on.`,
    })
    .then(
      () => undefined,
      () => undefined,
    );

  return Response.json({ ok: true, linked: true, verified: true });
}
