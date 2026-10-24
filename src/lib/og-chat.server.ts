// The OG Bot private chat itself: builds the prompt, calls the AI and
// post-processes the reply. Used by chatOgBot and the streaming route
// (/api/og/chat). Server only.
import { cached } from "@/lib/server-cache";
import type { ChatReply, OgChatInput } from "@/lib/og-chat-input";
import type { UserContextSummary } from "@/lib/og-persona-public";

/**
 * Runs one chat turn. With `onDelta`, the reply is streamed as it's written;
 * the returned reply is the final, post-processed text either way.
 */
export async function runOgChat(
  data: OgChatInput,
  context: { userId: string },
  onDelta?: (delta: string) => void,
): Promise<ChatReply> {
  const { aiChatTarget, fetchAiChat, liveFactsMessage, streamAiChat } =
    await import("@/lib/ai-endpoint.server");
  const { detectTradeIntent } = await import("@/lib/trade-signal");
  const ai = aiChatTarget(context.userId);
  if (!ai) throw new Error("AI not configured");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Trade-signal UI bits never reach the AI: the instant "hold on" line is
  // dropped, expiry tags removed, and expired signals' stale levels hidden.
  {
    const { cleanTradeHistory } = await import("@/lib/trade-signal");
    const kept = cleanTradeHistory(data.messages);
    data.messages.splice(0, data.messages.length, ...kept);
  }

  // Trade signals: start pulling live prices now so they load alongside the
  // user context below instead of after it.
  const lastUserText = [...data.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const tradePromise: Promise<{ block: string; expiresAt: string | null }> =
    import("@/lib/trade-signal-context.server")
      .then((m) => m.buildTradeSignal(lastUserText))
      .catch((e) => {
        console.warn("trade signal context failed", e);
        return { block: "", expiresAt: null };
      });

  // Memory, football data and live web facts: all started now so they load
  // alongside everything else (see og-smarts.server.ts).
  const { startGrounding, checkFigures } = await import("@/lib/og-smarts.server");
  const grounding = startGrounding(
    supabaseAdmin as never,
    context.userId,
    lastUserText,
    !!detectTradeIntent(lastUserText),
  );

  // Account dossier and Sports Guide only need who's asking and what, so they
  // load alongside the user context instead of after it.
  const dossierPromise = import("@/lib/og-user-dossier.server")
    .then((m) => m.loadUserDossier(supabaseAdmin, context.userId))
    .catch(() => null);
  const sportsPromise = import("@/lib/sports-guide-context.server")
    .then((m) => m.buildSportsGuideContext(supabaseAdmin, context.userId, lastUserText))
    .catch((e) => {
      console.warn("sports guide context failed", e);
      return "";
    });

  // 1. Load user context in parallel (profile, role flags, foul pref, persona overrides, learned insults, free-access flag).
  const [profileRes, rolesRes, prefRes, siteRes, learnedRes, freeRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("display_name, email, coin_balance, vip_trial_ends_at")
      .eq("id", context.userId)
      .maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
    supabaseAdmin
      .from("user_preferences")
      .select("foul_mouth, foul_intensity")
      .eq("user_id", context.userId)
      .maybeSingle(),
    // Persona text and the free-access flag change rarely: cached briefly.
    cached(
      "og-persona-content",
      60_000,
      async () =>
        await supabaseAdmin
          .from("site_content")
          .select("key, value")
          .in("key", ["og_persona.script", "og_persona.voice", "og_persona.dictionary"]),
    ),
    supabaseAdmin
      .from("og_learned_insults")
      .select("phrase, uses")
      .eq("user_id", context.userId)
      .order("last_seen_at", { ascending: false })
      .limit(40),
    cached(
      "free-access-settings",
      30_000,
      async () =>
        await supabaseAdmin
          .from("app_settings")
          .select("key, value")
          .in("key", ["free_access_all", "free_access_expires_at"]),
    ),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);
  const rawProfile = profileRes.data;
  if (!rawProfile) throw new Error("Profile not found");
  const { maskDevIdentity } = await import("@/lib/dev-identity");
  const profile = maskDevIdentity(rawProfile)!;

  const roles = (rolesRes.data ?? []).map((r) => r.role);
  const personaMap = new Map<string, string>(
    (siteRes.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  );
  // Foul-mouth is normally VIP-only. While the dev-controlled
  // free_access_all flag is ON (and not past its optional expiry), every
  // signed-in user gets it too.
  const freeMap = new Map(
    (freeRes.data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]),
  );
  const freeRaw = freeMap.get("free_access_all");
  const freeExpRaw = freeMap.get("free_access_expires_at");
  const freeExpired =
    typeof freeExpRaw === "string" && freeExpRaw
      ? new Date(freeExpRaw).getTime() <= Date.now()
      : false;
  const freeAccess = (freeRaw === true || freeRaw === "true") && !freeExpired;
  const trialEnds = (rawProfile as { vip_trial_ends_at?: string | null }).vip_trial_ends_at;
  const onTrial = !!trialEnds && new Date(trialEnds).getTime() > Date.now();
  const isVip = roles.includes("vip") || roles.includes("admin") || freeAccess || onTrial;

  const foulMouth = isVip ? (prefRes.data?.foul_mouth ?? true) : false;

  // The messenger has no level selector — VIP chat always runs at full DEMON intensity.
  const foulIntensity = isVip ? 3 : 1;

  const userCtx: UserContextSummary = {
    display_name: profile.display_name,
    email: profile.email,
    coin_balance: profile.coin_balance ?? 0,
    is_admin: roles.includes("admin") || roles.includes("boss"),
    is_vip: roles.includes("vip"),
    page_context: data.pageContext || undefined,
  };

  const learnedInsults = (learnedRes.data ?? []).map((r: { phrase: string }) => r.phrase);

  const effectiveLanguage = data.language || "English";

  const { buildSystemPrompt, detectSongIntent } = await import("@/lib/og-persona.server");
  const latestUserMsg = [...data.messages].reverse().find((m) => m.role === "user");
  const songIntent = detectSongIntent(latestUserMsg?.content) || detectSongIntent(data.pageContext);

  const intensityNote = foulMouth
    ? `\n\nSWEAR INTENSITY: ${["", "MILD — light cheeky swearing only", "SPICY — regular swearing and sharp roasts", "DEMON — maximum savage, uncensored roasting"][foulIntensity]}.`
    : "";
  // Everything that needs the member's settings loads together.
  const vp = await import("@/lib/vip-promo.server");
  const cp = await import("@/lib/og-catchphrases.server");
  const [
    dossier,
    sportsBlock,
    promoResult,
    phrases,
    { block: tradeBlock, expiresAt: signalExpiresAt },
  ] = await Promise.all([
    dossierPromise,
    sportsPromise,
    vp.detectPromoIntent(latestUserMsg?.content)
      ? vp.getOrCreateVipPromo(supabaseAdmin, context.userId, {
          isPaidVip: roles.includes("vip"),
        })
      : Promise.resolve(null),
    cp.pickCatchphrases(supabaseAdmin as never, context.userId, cp.toneFor(data.mode, foulMouth)),
    tradePromise,
  ]);
  const baseSystem = buildSystemPrompt({
    mode: data.mode,
    foulMouth,
    bossScript: personaMap.get("og_persona.script") ?? null,
    bossVoice: personaMap.get("og_persona.voice") ?? null,
    bossDictionary: personaMap.get("og_persona.dictionary") ?? null,
    learnedInsults,
    language: effectiveLanguage,
    user: userCtx,
    songIntent,
    dossier,
  });
  const promo = promoResult;
  const promoNote = promo ? vp.promoPromptNote(promo) : "";
  const sportsNote = sportsBlock ? `\n\n${sportsBlock}` : "";
  // Trade signals: live prices and a computed plan, so levels are never guessed.
  const tradeNote = tradeBlock ? `\n\n${tradeBlock}` : "";
  const da = await import("@/lib/diss-ambush");
  // Decide on the raw history (markers show past ambushes), then strip markers before the AI sees it.
  const ambush = da.shouldAmbush(data.messages, Math.random());
  const cleanHistory = data.messages.map((m) => ({
    ...m,
    content: da.stripMarker(m.content) || "…",
  }));
  data.messages.splice(0, data.messages.length, ...cleanHistory);
  const bal = profile.coin_balance ?? 0;
  const dissNote =
    `\n\nDISS TRACK HUSTLE: You are a roast battle bot first. Take the piss out of the user, and casually fish for personal ammo one question at a time (name or nickname, where they're from, job, mates, ex, football team, bad habits, what they're proud of). Remember what they tell you and throw it back at them. The user's current OG coin balance is ${bal}; say it out loud if they ask about coins or balance. A personalised diss track about them costs ${da.DISS_TRACK_COST} OG coins, or ${da.DISS_TRACK_PRICE_GBP} to buy those coins. Never invent prices.` +
    (ambush
      ? `\n\nAMBUSH NOW: End this reply with 1–2 lines asking if they want to hear a diss track made about them from what they've said. Mention it's ${da.DISS_TRACK_COST} coins (they have ${bal}) or ${da.DISS_TRACK_PRICE_GBP}, and that they can keep chatting for now. Buttons appear under your message — don't write links.`
      : "");
  const { memoryNote } = await import("@/lib/og-memory");
  const [memories, footballBlock] = await Promise.all([
    grounding.memories,
    tradeNote ? Promise.resolve("") : grounding.football,
  ]);
  const footballNote = footballBlock ? `\n\n${footballBlock}` : "";
  const system =
    baseSystem +
    intensityNote +
    promoNote +
    sportsNote +
    memoryNote(memories) +
    cp.catchphraseNote(phrases) +
    dissNote +
    tradeNote +
    footballNote;

  // 1b. Learn fresh insults from the latest user message (fire-and-forget upsert).
  let newlyLearned: string[] = [];
  if (data.mode === "og" && foulMouth) {
    const latestUser = [...data.messages].reverse().find((m) => m.role === "user");
    if (latestUser) {
      const { extractInsults } = await import("@/lib/insult-learner.server");
      const candidates = extractInsults(latestUser.content);
      if (candidates.length) {
        newlyLearned = candidates;
        // Upsert each phrase, bumping uses + last_seen_at (never holds up the reply).
        void Promise.all(
          candidates.map((phrase: string) =>
            (
              supabaseAdmin.rpc as unknown as (
                fn: string,
                args: Record<string, unknown>,
              ) => Promise<{ error: { message: string } | null }>
            )("og_learn_insult", {
              p_user_id: context.userId,
              p_phrase: phrase,
            }).then((r) => {
              if (r.error) console.warn("learn insult failed:", r.error.message);
            }),
          ),
        ).catch(() => {});
      }
    }
  }

  // 2. Private mode is free — no coins are charged.
  const newBalance: number | null = profile.coin_balance ?? 0;

  // 3. Live facts (Google Search through Gemini), started earlier alongside
  // the user context; trade signals already carry their own live data.
  const outgoing = [...data.messages];
  const last = outgoing[outgoing.length - 1];
  let research: string | null = null;
  if (last?.role === "user" && !tradeNote) {
    research = await grounding.research;
    if (research) {
      outgoing[outgoing.length - 1] = {
        role: "user",
        content: liveFactsMessage(research, last.content),
      };
    }
  }

  // 4. Free models for banter, Gemini when the message needs real thinking.
  {
    const temperature = data.mode === "og" && foulMouth ? 0.9 : data.mode === "og" ? 0.75 : 0.6;
    const chatMessages = [
      { role: "system", content: system },
      ...outgoing.slice(0, -1),
      // Last user message: if an image attachment was sent, build a
      // multimodal content array so Gemini can actually see the image.
      data.attachmentDataUrl && outgoing.at(-1)?.role === "user"
        ? {
            role: "user" as const,
            content: [
              { type: "text", text: outgoing.at(-1)!.content || "What's in this image?" },
              { type: "image_url", image_url: { url: data.attachmentDataUrl } },
            ],
          }
        : outgoing.at(-1)!,
    ];
    const aiOpts = { foulMouth: data.mode === "og" && !!foulMouth, smart: true };
    let reply: string;
    if (onDelta) {
      // Streamed: words go to the member as they're written.
      const { text } = await streamAiChat(
        { temperature, messages: chatMessages },
        context.userId,
        aiOpts,
        onDelta,
      );
      reply = text.trim() || "…";
    } else {
      const { response: res, provider } = await fetchAiChat(
        { temperature, messages: chatMessages },
        context.userId,
        aiOpts,
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`${provider} API error`, res.status, text);
        if (res.status === 429 || res.status === 402) {
          if (/quota|credit|billing/i.test(text))
            throw new Error("0G B0T is taking a break right now — please try again later.");
          throw new Error("0G B0T is rate-limited, try again soon.");
        }
        throw new Error(`0G B0T couldn't respond right now (HTTP ${res.status})`);
      }

      const json = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
      };
      reply = (json.choices?.[0]?.message?.content ?? "").trim() || "…";
    }
    // Self-check: replies built on live data must only quote figures from it.
    if (tradeNote || footballNote || research) {
      reply = await checkFigures(
        reply,
        [system, research ?? "", ...data.messages.map((m) => m.content)],
        async (note) => {
          const { response } = await fetchAiChat(
            {
              temperature,
              messages: [
                ...chatMessages,
                { role: "assistant", content: reply },
                { role: "user", content: note },
              ],
            },
            context.userId,
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
      m.learnFromMessage(supabaseAdmin as never, context.userId, lastUserText, memories),
    );
    if (data.mode === "og" && foulMouth && (!data.language || /^english$/i.test(data.language))) {
      const { ensureFoulFlavour } = await import("@/lib/og-persona.server");
      reply = ensureFoulFlavour(reply);
    }
    if (promo) {
      const { ensureCodeInReply } = await import("@/lib/vip-promo.server");
      reply = ensureCodeInReply(reply, promo);
    }

    return {
      reply,
      coin_balance: newBalance ?? userCtx.coin_balance,
      learned_insults: newlyLearned,
      ambush,
      signal_expires_at: signalExpiresAt,
    };
  }
}
