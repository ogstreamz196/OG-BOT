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

function tokenToUuidPrefix(token: string): string {
  return `${token.slice(0, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}-${token.slice(16, 20)}-${token.slice(20, 24)}`;
}

function tokenToUuidRange(token: string): { min: string; max: string } {
  const base = tokenToUuidPrefix(token);
  return {
    min: `${base}00000000`,
    max: `${base}ffffffff`,
  };
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
      { chat_id, message_id: mid, delete_at: new Date(Date.now() + ttlMs).toISOString() } as never,
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

// Persistent reply keyboards — one row of quick actions.
const USER_KEYBOARD = {
  keyboard: [
    [{ text: "💰 Balance" }, { text: "🎧 Library" }],
    [{ text: "👑 VIP Status" }, { text: "⚽ Sports Guide" }],
    [{ text: "🛒 Buy Coins" }, { text: "🔐 Vault ID" }],
    [{ text: "❓ Help" }],
    [{ text: "🧹 Clear chat" }, { text: "🌐 OGBOT.CO.UK" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const BOSS_KEYBOARD = {
  keyboard: [
    [{ text: "📊 Stats" }, { text: "👥 Users" }],
    [{ text: "💰 Balance" }, { text: "👑 VIP Status" }],
    [{ text: "⚽ Sports Guide" }, { text: "🔐 Vault ID" }],
    [{ text: "❓ Help" }],
    [{ text: "🧹 Clear chat" }, { text: "🌐 OGBOT.CO.UK" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
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
    let newBalance: number | null = null;
    if (cmd === "/addcoins") {
      if (amount === 0) {
        await reply(chat_id, "Amount must be non-zero.");
        return true;
      }
      const updated = Math.max(0, (target.coin_balance ?? 0) + amount);
      const { error: upErr } = await admin
        .from("profiles")
        .update({ coin_balance: updated })
        .eq("id", target.id);
      if (upErr) {
        await reply(chat_id, `❌ ${upErr.message}`);
        return true;
      }
      await admin.from("coin_transactions").insert({
        user_id: target.id,
        amount,
        type: amount > 0 ? "admin_mint" : "admin_deduct",
        reference: note,
      });
      newBalance = updated;
    } else {
      if (amount < 0) {
        await reply(chat_id, "Balance must be 0 or positive.");
        return true;
      }
      const delta = amount - (target.coin_balance ?? 0);
      const { error: upErr } = await admin
        .from("profiles")
        .update({ coin_balance: amount })
        .eq("id", target.id);
      if (upErr) {
        await reply(chat_id, `❌ ${upErr.message}`);
        return true;
      }
      if (delta !== 0) {
        await admin.from("coin_transactions").insert({
          user_id: target.id,
          amount: delta,
          type: delta > 0 ? "admin_mint" : "admin_deduct",
          reference: note,
        });
      }
      newBalance = amount;
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
  const { aiChatTarget, fetchAiChat, getLiveResearchContext, needsLiveResearch } =
    await import("@/lib/ai-endpoint.server");
  const ai = aiChatTarget(profileId);
  if (!ai) {
    await reply(chat_id, "AI not configured.");
    return;
  }

  // Show "typing…" straight away, then load everything in parallel.
  void tg("sendChatAction", { chat_id, action: "typing" }).catch(() => {});
  const vp = await import("@/lib/vip-promo.server");
  const { loadUserDossier } = await import("@/lib/og-user-dossier.server");
  const { buildSportsGuideContext } = await import("@/lib/sports-guide-context.server");
  const [profileRes, prefRes, siteRes, historyRes, dossier, promo, sportsBlock] = await Promise.all([
    admin.from("profiles").select("display_name, email, coin_balance").eq("id", profileId).maybeSingle(),
    admin.from("user_preferences").select("foul_mouth").eq("user_id", profileId).maybeSingle(),
    admin
      .from("site_content")
      .select("key, value")
      .in("key", ["og_persona.script", "og_persona.voice", "og_persona.dictionary"]),
    admin
      .from("og_messages")
      .select("role, content")
      .eq("user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20),
    loadUserDossier(admin, profileId).catch(() => null),
    vp.detectPromoIntent(userText)
      ? vp.getOrCreateVipPromo(admin, profileId, { isPaidVip: roles.includes("vip") }).catch(() => null)
      : Promise.resolve(null),
    buildSportsGuideContext(admin, profileId, userText).catch((e) => {
      console.warn("[telegram] sports guide context failed", e);
      return "";
    }),
  ]);
  const profile = profileRes.data;
  if (!profile) {
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
  }) + catchphraseNote(await pickCatchphrases(admin as never, profileId, toneFor("og", foulMouth)));

  const history = ((historyRes.data ?? []) as { role: string; content: string }[])
    .reverse()
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  // Save user message without holding up the reply.
  void admin.from("og_messages").insert({ user_id: profileId, role: "user", content: userText }).then(() => {});

  try {
    let currentUserText = userText;
    if (!sportsNote && needsLiveResearch(userText)) {
      const research = await getLiveResearchContext(userText).catch(() => null);
      if (research) {
        currentUserText = `CURRENT WEB SOURCES:\n${research}\n\nUSER QUESTION:\n${userText}\n\nCite source URLs for current claims.`;
      }
    }
    const { response: res, provider } = await fetchAiChat(
      {
        temperature: foulMouth ? 0.9 : 0.75,
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: currentUserText },
        ],
      },
      profileId,
      { foulMouth },
    );

    if (!res.ok) {
      if (res.status === 429) {
        await reply(chat_id, "⏱️ OG Bot is rate-limited, try again soon.");
      } else if (res.status === 402) {
        await reply(
          chat_id,
          `💳 AI quota is exhausted (${provider}).`,
        );
      } else {
        await reply(chat_id, `OG Bot couldn't respond right now (HTTP ${res.status}).`);
      }
      return;
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    let replyText = (json.choices?.[0]?.message?.content ?? "").trim() || "…";
    if (foulMouth) {
      const { ensureFoulFlavour } = await import("@/lib/og-persona.server");
      replyText = ensureFoulFlavour(replyText);
    }
    if (promo) replyText = vp.ensureCodeInReply(replyText, promo).replace(/\*\*/g, "");

    await admin.from("og_messages").insert({
      user_id: profileId,
      role: "assistant",
      content: replyText,
    });

    // Telegram caps messages at ~4096 chars
    const chunks = replyText.match(/[\s\S]{1,3800}/g) ?? [replyText];
    for (const c of chunks) {
      const res = await tg("sendMessage", {
        chat_id,
        text: c,
        disable_web_page_preview: true,
      });
      await scheduleDelete(chat_id, res, DEFAULT_TTL_MS);
    }
  } catch (err) {
    await reply(chat_id, `❌ ${(err as Error).message}`);
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
          (update?.edited_message?.chat?.id === SPORTS_GUIDE_CHAT_ID ? update.edited_message : null);
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

    if (trimmed === "🌐 OGBOT.CO.UK") {
      await reply(chat_id, "🌐 <b>OG BOT on the web</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open OGBOT.CO.UK", url: "https://ogbot.co.uk" }]],
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
      try { body = await quickSportsReply(admin, linkedProfile.id, q); } catch (e) { console.warn("[telegram] quick sports failed", e); }
      if (!q) body += "\n\nTip: send <code>/sports arsenal</code> or <code>/sports dazn</code>";
      await reply(
        chat_id,
        body.slice(0, 4000),
        {
          reply_markup: {
            inline_keyboard: [[{ text: "Open Sports Guide", url: "https://ogbot.co.uk/sports" }]],
          },
        },
      );
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
      const rows = list.map((s) => [
        {
          text: `▶️ ${(s.title || "Untitled").slice(0, 30)}`,
          url: `https://ogbot.co.uk/library/${s.id}`,
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
      rows.push([{ text: "Open full library", url: "https://ogbot.co.uk/library" }]);
      await reply(chat_id, body, { reply_markup: { inline_keyboard: rows } });
      return Response.json({ ok: true, library: true });
    }
    if (/^\/buy\b/i.test(trimmed)) {
      await reply(chat_id, "🛒 <b>Top up OG coins</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open Store", url: "https://ogbot.co.uk/buy-coins" }]],
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
      // Vault is independent of VIP: bought, 15-day signup trial, or Boss.
      const vipFree = isBoss || (!!trialEnds && new Date(trialEnds).getTime() > Date.now());
      const owned = !!purchase || vipFree;
      let body: string;
      if (!owned) {
        body =
          `🔐 <b>OG Vault Access Pass</b>\n\nYour free 15-day Vault trial has ended. Unlock it for good in the Store for £10 or 50 OG Coins.`;
      } else if (!creds?.length) {
        body = `🔐 <b>OG Vault Access Pass</b>\n\nYou own it ✅ — no access IDs are available right now, check back soon.`;
      } else {
        const cred = creds[Math.floor(Date.now() / (2 * 60 * 60 * 1000)) % creds.length];
        const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        body =
          `🔐 <b>Your OG Vault Access</b>\n\n` +
          `🆔 ID: <code>${esc(cred.username)}</code>\n` +
          `🔑 PIN: <code>${esc(cred.password)}</code>\n\n` +
          `Tap to copy. Keep it private.\n\n⏳ <i>For your security, this message self-destructs in 1 hour.</i>`;
      }
      await reply(
        chat_id,
        body,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🛒 Open Store", url: "https://ogbot.co.uk/buy-coins" }]],
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
          inline_keyboard: [[{ text: "👑 Open VIP Store", url: "https://ogbot.co.uk/store" }]],
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
    const uuidPrefix = tokenToUuidPrefix(token);
    const { min, max } = tokenToUuidRange(token);
    const { data: candidates } = await admin
      .from("profiles")
      .select("id")
      .gte("id", min)
      .lte("id", max)
      .limit(2);
    if (!candidates || candidates.length !== 1) {
      await reply(
        chat_id,
        "⚠️ I couldn't match that link to an OG profile. Please open the Telegram button directly from OG Streamz Settings.",
      );
      return Response.json({ ok: true, rejected: "no_or_ambiguous_match" });
    }
    const pid = candidates[0].id as string;
    const reconstructed = pid.replace(/-/g, "").slice(0, 24).toLowerCase();
    if (reconstructed !== token) {
      await reply(
        chat_id,
        "⚠️ This connect token doesn't match your OG profile. Please open a fresh Telegram link from Settings.",
      );
      return Response.json({ ok: true, rejected: "token_mismatch" });
    }
    profileId = pid;
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
