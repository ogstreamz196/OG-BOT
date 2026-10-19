import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UserContextSummary } from "@/lib/og-persona-public";
// `og-persona.server` and `insult-learner.server` are loaded lazily inside the
// handler so the swear lexicon / persona / learner code is never bundled into
// the client. Filename `.server.ts` also triggers Vite import protection.

export type OgChatMessage = { role: "user" | "assistant"; content: string };

interface ChatReply {
  reply: string;
  coin_balance: number;
  learned_insults?: string[];
  /** True when OG Bot is pitching a diss track; the client shows the ambush card. */
  ambush?: boolean;
  /** Set when the reply is a trade signal: when it stops being valid (ISO). */
  signal_expires_at?: string | null;
}

/**
 * Unified chat backend for the OG Bot page and the floating widget.
 *
 * - Authenticates via Supabase (no extra token required).
 * - Charges 1 OG coin per message (atomic via `deduct_coins` RPC).
 * - Pulls the user's foul-mouth preference, role flags, profile, and any
 *   Boss persona overrides from `site_content`, then builds the system
 *   prompt accordingly.
 * - Returns the assistant reply plus the user's new coin balance.
 */
export const chatOgBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      messages: OgChatMessage[];
      pageContext?: string;
      mode?: "safe" | "og";
      attachmentDataUrl?: string;
      language?: string;
    }) => {
      if (!data || !Array.isArray(data.messages)) throw new Error("messages required");
      const messages = data.messages.slice(-30).map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(m.content ?? "").slice(0, 4000),
      }));
      if (messages.length === 0) throw new Error("Empty conversation");
      const pageContext =
        typeof data.pageContext === "string" ? data.pageContext.slice(0, 200) : "";
      const mode: "safe" | "og" = data.mode === "safe" ? "safe" : "og";
      const language =
        typeof data.language === "string" && data.language.trim()
          ? data.language.trim().slice(0, 40)
          : "English";
      let attachmentDataUrl: string | undefined;
      if (
        typeof data.attachmentDataUrl === "string" &&
        data.attachmentDataUrl.startsWith("data:image/")
      ) {
        if (data.attachmentDataUrl.length > 8_000_000)
          throw new Error("Image too large (max ~6MB).");
        attachmentDataUrl = data.attachmentDataUrl;
      }
      return { messages, pageContext, mode, attachmentDataUrl, language };
    },
  )
  .handler(async ({ data, context }): Promise<ChatReply> => {
    const { aiChatTarget, fetchAiChat, liveFactsMessage } =
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
      supabaseAdmin
        .from("site_content")
        .select("key, value")
        .in("key", ["og_persona.script", "og_persona.voice", "og_persona.dictionary"]),
      supabaseAdmin
        .from("og_learned_insults")
        .select("phrase, uses")
        .eq("user_id", context.userId)
        .order("last_seen_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("app_settings")
        .select("key, value")
        .in("key", ["free_access_all", "free_access_expires_at"]),
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
    const { loadUserDossier } = await import("@/lib/og-user-dossier.server");
    const dossier = await loadUserDossier(supabaseAdmin, context.userId).catch(() => null);

    const latestUserMsg = [...data.messages].reverse().find((m) => m.role === "user");
    const songIntent =
      detectSongIntent(latestUserMsg?.content) || detectSongIntent(data.pageContext);

    const intensityNote = foulMouth
      ? `\n\nSWEAR INTENSITY: ${["", "MILD — light cheeky swearing only", "SPICY — regular swearing and sharp roasts", "DEMON — maximum savage, uncensored roasting"][foulIntensity]}.`
      : "";
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
    let promo: import("@/lib/vip-promo.server").PromoResult | null = null;
    let promoNote = "";
    {
      const vp = await import("@/lib/vip-promo.server");
      if (vp.detectPromoIntent(latestUserMsg?.content)) {
        promo = await vp.getOrCreateVipPromo(supabaseAdmin, context.userId, {
          isPaidVip: roles.includes("vip"),
        });
        promoNote = vp.promoPromptNote(promo);
      }
    }
    let sportsNote = "";
    try {
      const { buildSportsGuideContext } = await import("@/lib/sports-guide-context.server");
      const block = await buildSportsGuideContext(
        supabaseAdmin,
        context.userId,
        latestUserMsg?.content ?? "",
      );
      if (block) sportsNote = `\n\n${block}`;
    } catch (e) {
      console.warn("sports guide context failed", e);
    }
    // Trade signals: live prices and a computed plan, so levels are never guessed.
    const { block: tradeBlock, expiresAt: signalExpiresAt } = await tradePromise;
    const tradeNote = tradeBlock ? `\n\n${tradeBlock}` : "";
    const cp = await import("@/lib/og-catchphrases.server");
    const phrases = await cp.pickCatchphrases(
      supabaseAdmin as never,
      context.userId,
      cp.toneFor(data.mode, foulMouth),
    );
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
          // Upsert each phrase, bumping uses + last_seen_at.
          await Promise.all(
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
            throw new Error("OG Bot is taking a break right now — please try again later.");
          throw new Error("OG Bot is rate-limited, try again soon.");
        }
        throw new Error(`OG Bot couldn't respond right now (HTTP ${res.status})`);
      }

      const json = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
      };
      let reply = (json.choices?.[0]?.message?.content ?? "").trim() || "…";
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
  });
