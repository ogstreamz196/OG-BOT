import { cached } from "@/lib/server-cache";
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { buildSystemPrompt, detectSongIntent } from "@/lib/og-persona.server";
import { pickCatchphrases, catchphraseNote, toneFor } from "@/lib/og-catchphrases.server";
import type { UserContextSummary } from "@/lib/og-persona-public";
import { SPORTS_GUIDE_CHAT_ID, detectSport, detectEventTime } from "@/lib/sports-guide-parse";

// Accepted tokens:
//   - Rotated, single-use: "t_" + 32 lowercase hex chars (matched against
//     profiles.telegram_link_token).
//   - Legacy deterministic: 24 lowercase hex (first 24 chars of profiles.id
//     without dashes).
const TOKEN_RE = /^(t_[a-f0-9]{32}|[a-f0-9]{24})$/;
const BOSS_TELEGRAM_USERNAMES = ["ogstreamz", "ogstreamz196"] as const;
const BOSS_TELEGRAM_USERNAME = BOSS_TELEGRAM_USERNAMES[0];
const BOSS_EMAIL = "ogstreamz196@gmail.com";

function deriveSecret(key: string): string {
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const la = Buffer.from(a);
  const lb = Buffer.from(b);
  return la.length === lb.length && timingSafeEqual(la, lb);
}

async function tg(method: string, body: Record<string, unknown>) {
  // Prefer the Boss's own bot token (direct Telegram API, no Lovable involved).
  const botToken = process.env.OG_BOT_TOKEN;
  const tgKey = process.env.TELEGRAM_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const direct = Boolean(botToken);
  if (!direct && (!tgKey || !lovableKey)) return null;
  const url = direct
    ? `https://api.telegram.org/bot${botToken}/${method}`
    : `https://connector-gateway.lovable.dev/telegram/${method}`;
  const headers: Record<string, string> = direct
    ? { "Content-Type": "application/json" }
    : {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey as string,
        "Content-Type": "application/json",
      };
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return null;
  const payload = (await r.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: unknown;
  } | null;
  if (!r.ok || payload?.ok === false) {
    console.error(
      `Telegram ${method} failed [${r.status}]: ${payload?.description ?? "unknown error"}`,
    );
    return null;
  }
  return payload;
}

// Boss taps "✅ Acknowledge" on a new yearly VIP DM.
async function handleCallbackQuery(cq: {
  id: string;
  data?: string;
  from?: { id?: number };
  message?: { chat?: { id?: number }; message_id?: number; text?: string };
}) {
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cq.id, text });
  if (cq.data === "clearchat" && cq.message?.chat?.id && cq.message.message_id) {
    const chatId = cq.message.chat.id;
    await answer("Chat cleared 🧹");
    await clearRecentChat(chatId, cq.message.message_id);
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
  const { data: roles } = me
    ? await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", me.id)
        .in("role", ["admin", "boss"])
    : { data: [] };
  if (!me || !roles?.length) {
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
}

const INTRO_TEXT =
  `🔥 <b>Yo, I'm OG Bot.</b>\n\n` +
  `Here's what I do:\n` +
  `💬 Chat about anything or get advice\n` +
  `⚽ What time's the game? Ask me\n` +
  `🎵 Make your own tracks on ogbot.co.uk\n` +
  `🔥 Or just plain insult me\n\n` +
  `Go on, fire away 👇`;

async function sendIntro(chat_id: number) {
  await reply(chat_id, INTRO_TEXT, undefined, 0);
}

// Deletes up to the last 100 messages (bots may delete private-chat messages <48h old).
async function clearRecentChat(chat_id: number, upToMessageId: number) {
  const ids: number[] = [];
  for (let i = upToMessageId; i > 0 && ids.length < 100; i--) ids.push(i);
  if (ids.length) await tg("deleteMessages", { chat_id, message_ids: ids });
}

// Collapsed bottom bar keeps focus on the chat; the full menu is opened
// through categories with a Back button.
const kb = (rows: string[][]) => ({
  keyboard: rows.map((r) => r.map((text) => ({ text }))),
  resize_keyboard: true,
  is_persistent: true,
});
const BACK = "⬅️ Back";
const MENU = "📂 Menu";
const USER_KEYBOARD = kb([[MENU, "🧹 Clear chat"]]);
const BOSS_KEYBOARD = USER_KEYBOARD;
const CATEGORY_KEYBOARD = (isBoss: boolean) =>
  kb([
    ["💷 Coins & Store", "🎧 Music & VIP"],
    ["🔐 Access", "❓ Help"],
    ...(isBoss ? [["🛠 Boss tools"]] : []),
    [BACK],
  ]);
const SUBMENUS: Record<string, string[][]> = {
  "💷 Coins & Store": [["💰 Balance", "🛒 Buy Coins"], ["🌐 OGBOT.CO.UK"]],
  "🎧 Music & VIP": [["🎧 Library", "👑 VIP Status"]],
  "🔐 Access": [["🔐 Vault ID", "⚽ Sports Guide"]],
  "🛠 Boss tools": [["📊 Stats", "👥 Users"]],
};

// Bottom-bar buttons for users who haven't linked their account yet.
const BOTTOM_BAR_KEYBOARD = {
  keyboard: [[{ text: "🧹 Clear chat" }, { text: "🌐 OGBOT.CO.UK" }]],
  resize_keyboard: true,
  is_persistent: true,
};

const HELP_USER = `🤖 <b>OG Bot menu</b>
Tap a button below or use a command:

/balance — your OG coin balance
/tracks — your latest tracks to play and share
/library — same as /tracks
/buy — top up OG coins
/me — your linked profile
/vip — your VIP status and expiry date
/sports — open the Sports Guide
/help — this menu

Just type anything else and I'll answer — same brain as the in-app messenger.`;

const HELP_ADMIN = `${HELP_USER}

👑 <b>Boss / admin commands</b>
/user &lt;email|uuid&gt; — account and balance snapshot
/users [query] — search profiles
/whois &lt;email|uuid&gt; — quick profile
/addcoins &lt;who&gt; &lt;amount&gt; [reason]
/setcoins &lt;who&gt; &lt;amount&gt; [reason]
/stats — platform snapshot
/broadcast &lt;msg&gt; — DM every linked user`;

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
  const { data } = await admin
    .from("profiles")
    .select(PROFILE_COLS)
    .or(`email.ilike.${v},display_name.ilike.${v},telegram_username.ilike.${v}`)
    .limit(2);
  if (data && data.length === 1) return data[0] as AdminProfile;
  return null;
}

async function loadAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isAdmin(admin: Awaited<ReturnType<typeof loadAdmin>>, userId: string) {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role);
  return { admin: roles.includes("admin") || roles.includes("dev"), roles };
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
      telegram_username: msg?.from?.username ?? BOSS_TELEGRAM_USERNAME,
      telegram_linked_at: new Date().toISOString(),
      telegram_link_token: null,
    })
    .eq("id", boss.id as string);

  if (error) {
    await reply(chat_id, `❌ Boss Telegram link failed: ${error.message}`);
    return true;
  }

  await admin
    .from("telegram_sign_in_events")
    .insert({
      user_id: boss.id as string,
      chat_id,
      telegram_username: msg?.from?.username ?? BOSS_TELEGRAM_USERNAME,
      telegram_first_name: (msg?.from?.first_name as string | undefined) ?? null,
      event_kind: "boss_link",
      source: "webhook_start",
    })
    .then(
      () => undefined,
      () => undefined,
    );

  await reply(
    chat_id,
    `✅ <b>Connected!</b> OG Bot is linked to your account.\n\n👑 <b>Boss verified.</b> OG Bot is wired to this Telegram now.\n\n💰 Balance: <b>${boss.coin_balance ?? 0}</b> OG coins\nTap a button below or type /help.`,
    { reply_markup: BOSS_KEYBOARD },
  );
  return true;
}

function fmtProfile(p: AdminProfile): string {
  return [
    `<b>${p.display_name ?? "(no name)"}</b>`,
    p.email ? `📧 ${p.email}` : null,
    `🆔 <code>${p.id}</code>`,
    `💰 ${p.coin_balance ?? 0} OG coins`,
    p.telegram_username ? `✈️ @${p.telegram_username}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runAdminCommand(
  admin: Awaited<ReturnType<typeof loadAdmin>>,
  chat_id: number,
  text: string,
): Promise<boolean> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");

  if (cmd === "/user" || cmd === "/inspect") {
    if (!arg) {
      await reply(chat_id, "Usage: /user &lt;email|uuid|@handle&gt;");
      return true;
    }
    const p = await findProfile(admin, arg);
    if (!p) {
      await reply(chat_id, `No unique match for "${arg}".`);
      return true;
    }
    await reply(chat_id, fmtProfile(p));
    return true;
  }

  if (cmd === "/users" || cmd === "/find") {
    const q = arg.trim();
    const query = admin
      .from("profiles")
      .select(PROFILE_COLS)
      .order("created_at", { ascending: false })
      .limit(10);
    const { data, error } = q
      ? await admin
          .from("profiles")
          .select(PROFILE_COLS)
          .or(`email.ilike.%${q}%,display_name.ilike.%${q}%,telegram_username.ilike.%${q}%`)
          .limit(10)
      : await query;
    if (error) {
      await reply(chat_id, `❌ ${error.message}`);
      return true;
    }
    const rows = (data ?? []) as AdminProfile[];
    if (!rows.length) {
      await reply(chat_id, "No profiles matched.");
      return true;
    }
    const list = rows
      .map(
        (p, i) =>
          `${i + 1}. <b>${p.display_name ?? "(no name)"}</b> — ${p.email ?? "no email"} · 💰${p.coin_balance ?? 0}\n   <code>${p.id}</code>`,
      )
      .join("\n");
    await reply(chat_id, `👥 <b>Profiles</b>${q ? ` matching "${q}"` : ""}:\n\n${list}`);
    return true;
  }

  if (cmd === "/whois") {
    if (!arg) {
      await reply(chat_id, "Usage: /whois &lt;email|uuid&gt;");
      return true;
    }
    const p = await findProfile(admin, arg);
    if (!p) {
      await reply(chat_id, `No unique match for "${arg}".`);
      return true;
    }
    await reply(chat_id, fmtProfile(p));
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
      await reply(chat_id, `No unique match for "${who}".`);
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
        await reply(chat_id, `❌ ${upErr.message}`);
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
    await reply(
      chat_id,
      `✅ ${target.display_name ?? target.email ?? target.id} balance: <b>${newBalance}</b> OG coins`,
    );
    // DM the affected user too if they're linked
    if (target.telegram_chat_id) {
      await reply(
        target.telegram_chat_id,
        `💰 Your OG coin balance was updated by Boss.\nNew balance: <b>${newBalance}</b> OG coins.`,
      );
    }
    return true;
  }

  if (cmd === "/stats") {
    const [{ count: users }, { count: linked }, { data: coinAgg }] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("telegram_chat_id", "is", null),
      admin.from("profiles").select("coin_balance"),
    ]);
    const totalCoins = (coinAgg ?? []).reduce(
      (a: number, r: { coin_balance: number | null }) => a + (r.coin_balance ?? 0),
      0,
    );
    await reply(
      chat_id,
      `📊 <b>Stats</b>\n👥 Users: <b>${users ?? 0}</b>\n✈️ Telegram-linked: <b>${linked ?? 0}</b>\n💰 Total coins in circulation: <b>${totalCoins}</b>`,
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
    let sent = 0;
    for (const row of (data ?? []) as { telegram_chat_id: number }[]) {
      await reply(row.telegram_chat_id, `📣 <b>OG Streamz</b>\n\n${arg}`);
      sent++;
    }
    await reply(chat_id, `✅ Broadcast sent to ${sent} users.`);
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
) {
  // Resolve short follow-ups before entering generic chat. The card itself
  // comes from live candles and the deterministic engine, not an AI model.
  const trade = await import("@/lib/trade-signal");
  let tradeText = trade.resolveTradeRequest(userText, []);
  if (!tradeText && /\b(signals?|setups?|entry|entries|sl|tp|scalp|swing|bullish|bearish)\b/i.test(userText)) {
    const { data: recent } = await admin
      .from("og_messages")
      .select("role, content, created_at")
      .eq("user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    tradeText = trade.resolveTradeRequest(userText, recent ?? []);
  }
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
      const vipish = ["vip", "admin", "boss", "dev"].some((role) => roles.includes(role));
      const { data: pref } = vipish
        ? await admin.from("user_preferences").select("foul_mouth").eq("user_id", profileId).maybeSingle()
        : { data: null };
      const tone = vipish && (pref?.foul_mouth ?? true) ? "foul" : "cheeky";
      const hold = await pickTradeHold(admin as never, profileId, market, tone)
        .catch(() => trade.holdingMessage(market, tone));
      const held = await tg("sendMessage", { chat_id, text: hold, disable_web_page_preview: true });
      const signal = await signalJob;
      const ttl = signal.expiresAt
        ? Math.max(1, Date.parse(signal.expiresAt) - Date.now() - 5 * 60_000)
        : 5 * 60_000;
      await scheduleDelete(chat_id, held, ttl);
      const chunks = signal.reply.match(/[\s\S]{1,3800}/g) ?? [signal.reply];
      for (const text of chunks) {
        const sent = await tg("sendMessage", { chat_id, text, disable_web_page_preview: true });
        if (!sent) throw new Error("Signal delivery failed");
        await scheduleDelete(chat_id, sent, ttl);
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
  // Trade signal: send an instant "hold on" line in OG Bot's voice so the user
  // knows the next message is the analysis. Not saved to chat history.
  let holdingSent: Promise<unknown> = Promise.resolve();
  {
    const ts = await import("@/lib/trade-signal");
    const market = ts.detectTradeIntent(userText);
    if (market) {
      holdingSent = (async () => {
        const vipish = ["vip", "admin", "dev"].some((r) => roles.includes(r));
        let foul = false;
        if (vipish) {
          const { data } = await admin
            .from("user_preferences")
            .select("foul_mouth")
            .eq("user_id", profileId)
            .maybeSingle();
          foul = data?.foul_mouth ?? true;
        }
        const { pickTradeHold } = await import("@/lib/trade-hold.server");
        const line = await pickTradeHold(
          admin as never,
          profileId,
          market,
          foul ? "foul" : "cheeky",
        );
        const res = await tg("sendMessage", {
          chat_id,
          text: line,
          disable_web_page_preview: true,
        });
        const { tradeReplyTtlMs } = await import("@/lib/trade-signal-context.server");
        await scheduleDelete(chat_id, res, tradeReplyTtlMs(userText));
      })().catch((e) => console.warn("[telegram] holding message failed", e));
    }
  }
  // Memory, football data and live web facts start now, alongside everything else.
  const { startGrounding, checkFigures } = await import("@/lib/og-smarts.server");
  const isTrade = !!(await import("@/lib/trade-signal")).detectTradeIntent(userText);
  const grounding = startGrounding(admin as never, profileId, userText, isTrade);
  const vp = await import("@/lib/vip-promo.server");
  const { loadUserDossier } = await import("@/lib/og-user-dossier.server");
  const { buildSportsGuideContext } = await import("@/lib/sports-guide-context.server");
  // The full account dossier is heavy — only load it when they ask about their account.
  const wantsAccount =
    /\b(coin|coins|balance|vip|vault|song|songs|track|tracks|account|subscription|plan|bought|purchase|refund|paid|pay|wallet|referr|cashback|expire|status|my id|username)\b/i.test(
      userText,
    );
  const [profileRes, prefRes, siteRes, historyRes, dossier, promo, sportsBlock, tradeBlock] =
    await Promise.all([
      admin
        .from("profiles")
        .select("display_name, email, coin_balance")
        .eq("id", profileId)
        .maybeSingle(),
      admin.from("user_preferences").select("foul_mouth").eq("user_id", profileId).maybeSingle(),
      cached(
        "og-persona-content",
        60_000,
        async () =>
          await admin
            .from("site_content")
            .select("key, value")
            .in("key", ["og_persona.script", "og_persona.voice", "og_persona.dictionary"]),
      ),
      admin
        .from("og_messages")
        .select("role, content")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false })
        .limit(20),
      wantsAccount ? loadUserDossier(admin, profileId).catch(() => null) : Promise.resolve(null),
      vp.detectPromoIntent(userText)
        ? vp
            .getOrCreateVipPromo(admin, profileId, { isPaidVip: roles.includes("vip") })
            .catch(() => null)
        : Promise.resolve(null),
      buildSportsGuideContext(admin, profileId, userText).catch((e) => {
        console.warn("[telegram] sports guide context failed", e);
        return "";
      }),
      import("@/lib/trade-signal-context.server")
        .then((m) => m.buildTradeSignalContext(userText))
        .catch((e) => {
          console.warn("[telegram] trade signal context failed", e);
          return "";
        }),
    ]);
  const profile = profileRes.data;
  if (!profile) {
    clearInterval(typingTimer);
    await reply(chat_id, "Profile not found.");
    return;
  }

  const isVip = roles.includes("vip") || roles.includes("admin") || roles.includes("dev");
  const isAdminUser = roles.includes("admin") || roles.includes("boss");

  const personaMap = new Map<string, string>(
    (siteRes.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  );
  const foulMouth = isVip ? (prefRes.data?.foul_mouth ?? true) : false;

  const userCtx: UserContextSummary = {
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
    tradeBlock ? Promise.resolve("") : grounding.football,
    pickCatchphrases(admin as never, profileId, toneFor("og", foulMouth)),
  ]);

  const system =
    sportsNote +
    promoNote +
    "" +
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
    memoryNote(memories) +
    (tradeBlock
      ? `\n\n${tradeBlock}\n\nOn Telegram this reply self-destructs at the valid-until time. Say so in a few words on the valid-until line.`
      : "") +
    (footballBlock ? `\n\n${footballBlock}` : "");

  const history = trade.cleanTradeHistory(
    ((historyRes.data ?? []) as { role: string; content: string }[]).reverse(),
  )
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  // Save user message without holding up the reply.
  void admin
    .from("og_messages")
    .insert({ user_id: profileId, role: "user", content: userText })
    .then(() => {});

  try {
    let currentUserText = userText;
    const research = !sportsNote && !tradeBlock ? await grounding.research : null;
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
    const live = createLiveReply({
      send: (text) => tg("sendMessage", { chat_id, text, disable_web_page_preview: true }),
      edit: (message_id, text) =>
        tg("editMessageText", { chat_id, message_id, text, disable_web_page_preview: true }),
      // The holding line (if any) must land before the analysis.
      beforeFirst: () => holdingSent,
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
    if (tradeBlock || footballBlock || research) {
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
    // Remember anything lasting the member just told us (never blocks the reply).
    void import("@/lib/og-memory.server").then((m) =>
      m.learnFromMessage(admin as never, profileId, userText, memories),
    );
    if (foulMouth) {
      const { ensureFoulFlavour } = await import("@/lib/og-persona.server");
      replyText = ensureFoulFlavour(replyText);
    }
    if (promo) replyText = vp.ensureCodeInReply(replyText, promo).replace(/\*\*/g, "");
    // Trade signals: plain text for Telegram, and the reply self-destructs
    // when the signal expires.
    let replyTtlMs = DEFAULT_TTL_MS;
    if (tradeBlock) {
      const ts = await import("@/lib/trade-signal-context.server");
      replyText = ts.plainForTelegram(replyText);
      replyTtlMs = ts.tradeReplyTtlMs(userText);
    }

    // Save the reply while it goes out, rather than before.
    const saved = admin
      .from("og_messages")
      .insert({ user_id: profileId, role: "assistant", content: replyText })
      .then(
        () => {},
        (e: unknown) => console.warn("[telegram] saving reply failed", e),
      );

    // Show the final text in the live message (and any overflow after it).
    const sentLive = await live.finish(replyText);
    for (const res of sentLive) await scheduleDelete(chat_id, res, replyTtlMs);
    if (!sentLive.length) {
      // Nothing went out live: send it the normal way.
      await holdingSent;
      // Telegram caps messages at ~4096 chars
      const chunks = replyText.match(/[\s\S]{1,3800}/g) ?? [replyText];
      for (const c of chunks) {
        const res = await tg("sendMessage", {
          chat_id,
          text: c,
          disable_web_page_preview: true,
        });
        await scheduleDelete(chat_id, res, replyTtlMs);
      }
    }
    await saved;
  } catch (err) {
    await reply(chat_id, `❌ ${(err as Error).message}`);
  } finally {
    clearInterval(typingTimer);
  }
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
    const keyboard = isBoss ? BOSS_KEYBOARD : USER_KEYBOARD;
    // Buttons to the site sign the member straight into this account (see
    // telegram-signin.server.ts), so Telegram's browser never starts a new one.
    const { telegramSignInLinker } = await import("@/lib/telegram-signin.server");
    const siteLink = telegramSignInLinker(admin, linkedProfile.id);

    // Map emoji-keyboard button taps → slash commands
    const buttonMap: Record<string, string> = {
      "💰 Balance": "/balance",
      "🎧 Library": "/library",
      "🛒 Buy Coins": "/buy",
      "👤 My Profile": "/me",
      "👑 VIP Status": "/vip",
      "❓ Help": "/help",
      "⚽ Sports Guide": "/sports",
      "🧹 Clear chat": "/clear",
      "🔐 Vault ID": "/vault",
      ...(isBoss ? { "📊 Stats": "/stats", "👥 Users": "/users" } : {}),
    };
    if (buttonMap[trimmed]) trimmed = buttonMap[trimmed];

    // Categorised menu navigation
    if (trimmed === MENU || trimmed === "🔙 Categories") {
      await reply(chat_id, "📂 <b>Pick a category</b>", {
        reply_markup: CATEGORY_KEYBOARD(isBoss),
      });
      return Response.json({ ok: true, menu: true });
    }
    if (trimmed === BACK) {
      await reply(chat_id, "💬 Back to chatting. Tap 📂 Menu any time.", {
        reply_markup: keyboard,
      });
      return Response.json({ ok: true, menu: "closed" });
    }
    if (SUBMENUS[trimmed] && (trimmed !== "🛠 Boss tools" || isBoss)) {
      await reply(chat_id, `<b>${trimmed}</b>`, {
        reply_markup: kb([...SUBMENUS[trimmed], ["🔙 Categories", BACK]]),
      });
      return Response.json({ ok: true, menu: trimmed });
    }

    if (trimmed === "🌐 OGBOT.CO.UK") {
      await reply(chat_id, "🌐 <b>OG BOT on the web</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open OGBOT.CO.UK", url: await siteLink("/") }]],
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
      await admin.from("og_messages").delete().eq("user_id", linkedProfile.id);
      await sendIntro(chat_id);
      return Response.json({ ok: true, cleared: true });
    }
    if (/^\/help\b/i.test(trimmed) || /^\/menu\b/i.test(trimmed)) {
      await reply(chat_id, isBoss ? HELP_ADMIN : HELP_USER, {
        reply_markup: keyboard,
      });
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
      await reply(chat_id, body.slice(0, 4000), {
        reply_markup: {
          inline_keyboard: [[{ text: "Open Sports Guide", url: await siteLink("/sports") }]],
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
      await reply(chat_id, `💰 Balance: <b>${p?.coin_balance ?? 0}</b> OG coins`, {
        reply_markup: keyboard,
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
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const list = songs ?? [];
      const body = list.length
        ? "🎧 <b>Your latest tracks</b>\n\n" +
          list
            .map(
              (s, i) =>
                `${i + 1}. <b>${esc(s.title || "Untitled")}</b>${s.style ? ` — ${esc(String(s.style).slice(0, 40))}` : ""}`,
            )
            .join("\n") +
          "\n\nTap a track to listen. Make it public in the app to share the link."
        : "🎧 No finished tracks yet — go make one!";
      const libraryLinks = await Promise.all(list.map((s) => siteLink(`/library/${s.id}`)));
      const rows = list.map((s, i) => [
        {
          text: `▶️ ${(s.title || "Untitled").slice(0, 30)}`,
          url: libraryLinks[i],
        },
        ...(s.is_public && s.revealed
          ? [
              {
                text: "🔗 Share",
                url: `https://t.me/share/url?url=${encodeURIComponent(`https://ogbot.co.uk/track/${s.id}`)}`,
              },
            ]
          : []),
      ]);
      rows.push([{ text: "Open full library", url: await siteLink("/library") }]);
      await reply(chat_id, body, { reply_markup: { inline_keyboard: rows } });
      return Response.json({ ok: true, library: true });
    }
    if (/^\/buy\b/i.test(trimmed)) {
      await reply(chat_id, "🛒 <b>Top up OG coins</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open Store", url: await siteLink("/store") }]],
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
      await reply(chat_id, p ? fmtProfile(p as AdminProfile) : "Profile not found.", {
        reply_markup: keyboard,
      });
      return Response.json({ ok: true, me: true });
    }
    if (
      /^\/vault\b/i.test(trimmed) ||
      (/\bvault\b/i.test(trimmed) &&
        /\b(pin|id|code|login|password|pass|access|username|details)\b/i.test(trimmed))
    ) {
      const [{ data: purchase }, { data: prof }, { data: creds }] = await Promise.all([
        admin.from("vip_pass_purchases").select("id").eq("user_id", linkedProfile.id).maybeSingle(),
        admin.from("profiles").select("vip_trial_ends_at").eq("id", linkedProfile.id).maybeSingle(),
        admin
          .from("vip_pass_credentials")
          .select("username,password")
          .eq("active", true)
          .order("created_at", { ascending: true }),
      ]);
      const trialEnds = (prof as { vip_trial_ends_at?: string | null } | null)?.vip_trial_ends_at;
      void trialEnds;
      // Vault is independent of VIP and the intro offer: bought or Boss only.
      const vipFree = isBoss;
      const owned = !!purchase || vipFree;
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
        const esc = (v: string) =>
          v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        body =
          `🔐 <b>Your OG Vault Access</b>\n\n` +
          `🆔 ID: <code>${esc(cred.username)}</code>\n` +
          `🔑 PIN: <code>${esc(cred.password)}</code>\n\n` +
          `⚠️ <b>Important:</b> sign out of the Vault first, then sign in with these details.\n\n` +
          `Tap to copy. Keep it private.\n\n⏳ <i>For your security, this message self-destructs in 1 hour.</i>`;
      }
      await reply(
        chat_id,
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

      let body: string;
      if (paidEnd && paidEnd > now) {
        body =
          `👑 <b>You're OG VIP!</b>\n\n` +
          (p?.og_vip_id ? `🆔 <b>${p.og_vip_id}</b>\n` : "") +
          `📅 Renews/expires: <b>${fmtDate(new Date(paidEnd).toISOString())}</b>` +
          (sub?.cancel_at_period_end ? " (cancelled — VIP ends on this date)" : " (auto-renews)");
      } else if (trialEnd) {
        const daysLeft = Math.ceil((trialEnd - now) / 86400000);
        body =
          `👑 <b>Free VIP trial active!</b>\n\n` +
          (p?.og_vip_id ? `🆔 <b>${p.og_vip_id}</b>\n` : "") +
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
          (p?.og_vip_id ? `🆔 <b>${p.og_vip_id}</b>\n` : "") +
          `📅 VIP ends: <b>${fmtDate(vipRow.expires_at)}</b> (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)`;
      } else if (isVipRole) {
        body =
          `👑 <b>You're OG VIP!</b>\n\n` +
          (p?.og_vip_id ? `🆔 <b>${p.og_vip_id}</b>\n` : "") +
          `📅 No expiry — lifetime/boss VIP.`;
      } else {
        body =
          `🆓 You're on the <b>free plan</b> — no active VIP.\n\n` +
          `Unlock all styles, Foul Mouth mode and your OG VIP ID in the app Store.`;
      }
      await reply(chat_id, body, {
        reply_markup: {
          inline_keyboard: [[{ text: "👑 Open VIP Store", url: await siteLink("/store") }]],
        },
      });
      return Response.json({ ok: true, vip: true });
    }
    if (/^\/start\b/i.test(trimmed)) {
      await reply(chat_id, `✅ Already linked. Tap a button below or type /help.`, {
        reply_markup: keyboard,
      });
      return Response.json({ ok: true, already_linked: true });
    }

    // Admin commands
    if (isBoss && trimmed.startsWith("/")) {
      const handled = await runAdminCommand(admin, chat_id, trimmed);
      if (handled) return Response.json({ ok: true, admin_cmd: true });
    }

    // Reject unknown slash commands for non-admins
    if (trimmed.startsWith("/")) {
      await reply(chat_id, "Unknown command. Type /help.", { reply_markup: keyboard });
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
    await reply(
      chat_id,
      "🛠️ <b>OG Bot is online.</b>\n\nTo link your account, open OG Streamz → Settings → Connect Telegram, then tap your personal Telegram link.\n\nAfter linking, you can chat with me (same brain as the in-app messenger) and admins get full user/coin management commands.",
    );
    return Response.json({ ok: true, help: true });
  }

  if (!startMatch) {
    const unlinkedText = typeof text === "string" ? text.trim() : "";
    if (unlinkedText === "🧹 Clear chat") {
      const mid = (msg as { message_id?: number }).message_id;
      if (mid) await clearRecentChat(chat_id, mid);
      await reply(
        chat_id,
        `${INTRO_TEXT}\n\n🔗 First, link your account: ogbot.co.uk → Settings → <b>Connect Telegram</b>.`,
        { reply_markup: BOTTOM_BAR_KEYBOARD },
      );
      return Response.json({ ok: true, cleared: true });
    }
    if (unlinkedText === "🌐 OGBOT.CO.UK") {
      await reply(chat_id, "🌐 <b>OG BOT on the web</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open OGBOT.CO.UK", url: "https://ogbot.co.uk" }]],
        },
      });
      return Response.json({ ok: true, site: true });
    }
    if (/^\/start\b/i.test(unlinkedText)) {
      await reply(
        chat_id,
        `${INTRO_TEXT}\n\n🔗 First, link your account: ogbot.co.uk → Settings → <b>Connect Telegram</b>.`,
        { reply_markup: BOTTOM_BAR_KEYBOARD },
        0,
      );
      return Response.json({ ok: true, missing_token: true });
    }
    await reply(
      chat_id,
      "👋 <b>OG Bot is online.</b>\n\nLink your OG profile from Settings → Connect Telegram to unlock the full assistant here.",
      { reply_markup: BOTTOM_BAR_KEYBOARD },
    );
    return Response.json({ ok: true, unlinked_reply: true });
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
    await reply(chat_id, `❌ Telegram link failed: ${linkError.message}`);
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
    `✅ <b>Connected, ${name}!</b>` +
    (isBoss ? ` 👑 Boss mode on — /help for admin commands.` : "") +
    `\n💰 ${balance} OG coins`;

  await reply(chat_id, greeting, {
    reply_markup: isBoss ? BOSS_KEYBOARD : USER_KEYBOARD,
  });
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
