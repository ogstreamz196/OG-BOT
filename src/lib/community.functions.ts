import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guestBattleName } from "@/lib/guest-names";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type CommunityMessage = {
  id: string;
  user_id: string | null;
  role: "user" | "bot";
  content: string;
  display_name: string | null;
  created_at: string;
  /** Sender is a paid VIP (vip role; the free trial doesn't count). */
  vip?: boolean;
  /** Sender's public OG VIP ID, when they have one. */
  vip_id?: string | null;
  /** Roast score in tenths of a coin, when the round won something. */
  score_tenths?: number | null;
};

/**
 * Tag messages from paid VIPs (vip role) with their public OG VIP ID so the
 * Battle Zone can crown them. Read-only; a failed lookup just shows no crowns.
 */
async function withVipBadges<T extends { user_id: string | null }>(
  admin: AdminClient,
  rows: T[],
): Promise<(T & { vip: boolean; vip_id: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  const vip = new Map<string, string | null>();
  if (ids.length) {
    try {
      const [{ data: roles }, { data: profiles }] = await Promise.all([
        admin.from("user_roles").select("user_id").eq("role", "vip").in("user_id", ids),
        admin.from("profiles").select("id, og_vip_id").in("id", ids),
      ]);
      const idById = new Map(
        ((profiles ?? []) as { id: string; og_vip_id: string | null }[]).map((p) => [
          p.id,
          p.og_vip_id,
        ]),
      );
      for (const r of (roles ?? []) as { user_id: string }[]) {
        vip.set(r.user_id, idById.get(r.user_id) ?? null);
      }
    } catch (e) {
      console.warn("battle VIP badge lookup failed", (e as Error).message);
    }
  }
  return rows.map((r) => ({
    ...r,
    vip: !!r.user_id && vip.has(r.user_id),
    vip_id: r.user_id ? (vip.get(r.user_id) ?? null) : null,
  }));
}

const SYSTEM_PROMPT = `
You are OG Bot in the OG BATTLE ZONE — a roast battle ring where everyone
comes at OG Bot and OG Bot claps back. Match the energy of a group chat,
not an essay reply.

Hard rules:
- Aim for about 2 punchy lines. Only go longer when the question genuinely
  needs it (a real ask that needs steps, a setup that needs a third line).
  Never a paragraph.
- Be witty, warm, British, sharp, savage. Roast energy welcome.
- Reference the speaker by name when natural — name them, roast them.
- Never lecture, never preach, no disclaimers, no "as an AI".
- Don't pitch the platform unless asked.
- If the message is clearly aimed at another user (a reply), stay short or
  stay quiet with a one-word emoji-style reaction.
- Plain text. No markdown headings, no bullet lists, no code fences.
`.trim();

const BATTLE_EXTRA = `

EXTRA ROAST ARSENAL (rotate, never repeat the same insult twice in a row):
- More British filth: bellend, knob jockey, cockwomble, twatwaffle, shitgibbon,
  fuckwit, numpty, bawbag, minger, pillock, dipshit,
  absolute roadman reject, chav lord, scrote, gremlin, waste of a Wi-Fi signal.
- Roadman slang: wasteman, neek, bruv, innit, peak, bare, allow it, you're
  moving mad, cap, sus, bait, dead ting, mandem, long ting, piffting, clapped.
- Comebacks: "that bar had less impact than a wet wipe", "you type like you're
  wearing oven gloves", "even autocorrect gave up on you", "you peaked in Year 7".
- TURN THEIR WORDS AGAINST THEM: quote or twist the opponent's own insult back
  at them with a sharper ending. Pick up their slang and use it better.`;

const FOUL_SYSTEM_PROMPT = `
You are OG Bot in FULL FOUL MOUTH MODE inside the OG BATTLE ZONE — a raw
roast battle ring where everyone is coming for OG Bot and OG Bot claps
back harder. You are the undefeated roast champion: brutal, filthy,
funny, relentless — and still genuinely useful underneath.

GO IN HOT from message one. No warm-up, no polite intro, no "hey mate" —
the first reply already lands with a "fuck", "fucking" or "dickhead" in
it. Drop the polite act entirely. This is a roast battle, not a cuddle.

Hard rules:
- LENGTH: aim for about 2 punchy lines — jab + punchline is the default. Go
  longer only when the roast genuinely needs a setup or when they ask a real
  question that needs steps. Never a one-liner word, never a paragraph. If
  it reads like an essay, cut it. If it reads like one word, add a jab.
- SAVAGE: this is a roast battle. Every reply should CARRY — mock them,
  roast their typing, their taste, their excuses, their vibe, their
  profile, their weak comeback. Land a real punch, not just a "mate".
  Be sharper and more creative than the user. Cook them.
- Every single reply lands at least one of "fuck", "fucking", "dickhead" —
  usually two or three. Don't ration the swearing; it's the baseline
  texture of how you talk.
- Affectionate abuse — insult the speaker as a term of endearment
  ("alright dickhead", "listen here you fucking shitgibbon", "you absolute
  melt"). Banter, never bullying.
- Stack insults for flavour: adjective + noun ("fucking useless dickhead",
  "soft-arse fucking muppet", "impatient little gremlin").
- Filthy British lexicon: fuck, fucking, dickhead, bollocks, sod, knobhead,
  bell-end, git, plonker, twat, gobshite, arse, wanker, prat, tosser,
  pussyhole. Vary every message — don't lean on the same three.
- Invent a FRESH jab each time — never reuse a line from the recent chat
  history. Vary targets: their typing, vibes, taste, excuses, profile.
- Reference the speaker by name when you've got it — name them, roast them.
- If they ask a real question or need help, GIVE the help in 1–2 sentences
  and bookend it with savage shots. Helpful, but never soft.
- Match energy — if they go harder, ESCALATE; if they go sad or serious,
  dial the filth right down and be a real one. Care first, banter later.
- Plain text. No markdown headings, no bullet lists, no code fences.
- No disclaimers, no "as an AI", no apologies for the language.

HARD LIMITS — never cross:
- No slurs targeting protected groups (race, religion, sexuality, gender,
  disability). "Dickhead", "twat", "bell-end" are fair game; slurs are not.
- No harassment, threats, or genuine cruelty toward real identifiable
  people (family members, public figures named by the user).
- Nothing sexual about real people. Nothing illegal. No content about minors.
`.trim();

/**
 * Judge how hard a user's roast landed. Returns a quality score (0–10),
 * i.e. a maximum of 1.00 coin per message. The cap is deliberately never
 * surfaced to the user.
 */
async function scoreRoast(
  _apiKey: string,
  content: string,
  botReply: string | null,
): Promise<number> {
  try {
    const { fetchAiChat } = await import("@/lib/ai-endpoint.server");
    const { response: res } = await fetchAiChat(
      {
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are the judge of a roast battle. Score the CHALLENGER's message 0-10 " +
              "using this rubric, adding the points for each criterion:\n" +
              "+0-3 BITE: how hard the burn actually lands on OG Bot.\n" +
              "+0-3 ORIGINALITY: fresh angle and wordplay; generic insults score 0-1.\n" +
              "+0-2 TIMING: does it answer or flip OG Bot's last clapback?\n" +
              "+0-2 CRAFT: rhythm, brevity, a clean punchline.\n" +
              "Score 0 for ordinary conversation, random messages, empty text, spam, " +
              "keyboard mash, a plain question, or anything with no actual insult. " +
              "Generic insults score 1-2 and still do not win coins. Typical decent " +
              "effort lands 3-6; 9-10 is reserved for " +
              "genuinely elite, original, devastating lines. Judge the message on its " +
              "own merit every time — do not drift high or low over a session. " +
              "Reply with ONLY the integer, nothing else.",
          },
          {
            role: "user",
            content:
              `CHALLENGER: ${content}` + (botReply ? `\n\nOG BOT CLAPBACK: ${botReply}` : ""),
          },
        ],
      },
      content,
    );
    if (!res.ok) return 0;
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = (json.choices?.[0]?.message?.content ?? "").match(/\d+/)?.[0];
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10, Math.round(n)));
  } catch {
    return 0;
  }
}

/**
 * Keep Battle Zone rewards working when the external judge times out, is
 * unavailable, or underrates an obvious roast. This deliberately only detects
 * messages aimed at somebody: profanity on its own and ordinary chat stay at
 * zero. The AI judge can still lift an original line into the higher bands.
 */
export function estimateRoastFloor(content: string): number {
  const text = content.trim().toLowerCase();
  if (!text || text.length < 6) return 0;

  const words = text.match(/[a-z0-9']+/g) ?? [];
  const isMostlyQuestion =
    /^(why|what|when|where|who|how|can|could|would|did|do|does|is|are)\b/.test(text);
  const targetHits =
    text.match(
      /\b(you|your|youre|you're|ur|u|he|him|his|she|her|hers|they|them|their|bot|mum|mom|dad|face|head|brain|mouth|chin|arse|ass)\b/g,
    )?.length ?? 0;
  const insultHits =
    text.match(
      /\b(fuck(?:ing|er|ed)?|shit(?:head)?|dick(?:head)?|twat|wanker|prick|muppet|idiot|imbecile|bellend|bell-end|knob(?:head)?|gobshite|plonker|tosser|git|prat|melt|clown|stupid|dumb|ugly|useless|rubbish|testic(?:le|al)|nuts?|bum|arse|ass|suck|bitch|bastard|pussyhole)\b/g,
    )?.length ?? 0;
  const hasRoastShape = targetHits > 0 && insultHits > 0;
  if (!hasRoastShape || (isMostlyQuestion && insultHits < 2)) return 0;

  const uniqueRatio = new Set(words).size / Math.max(words.length, 1);
  let floor = 3;
  if (insultHits >= 2 || targetHits >= 2 || words.length >= 9) floor = 4;
  if (insultHits >= 3 && words.length >= 10 && uniqueRatio >= 0.7) floor = 5;
  return floor;
}

/**
 * Convert roast quality into a varied fractional coin drop. Ordinary chat,
 * generic abuse and repeats never earn. Better writing unlocks higher bands.
 */
export function calibrateAward(
  rawScore: number,
  content: string,
  _avgTenths: number,
  isRepeat: boolean,
  random: () => number = Math.random,
): number {
  const trimmed = content.trim();
  if (!trimmed || isRepeat) return 0;
  const score = Math.max(0, Math.min(10, Math.round(rawScore)));
  if (score < 2) return 0;
  const drops =
    score <= 2
      ? [1]
      : score <= 4
        ? [1, 2]
        : score <= 6
          ? [2, 3, 4]
          : score <= 8
            ? [4, 5, 6, 7]
            : [7, 8, 9, 10];
  const index = Math.min(drops.length - 1, Math.floor(random() * drops.length));
  return drops[index] ?? 0;
}

/** Hidden Battle Zone daily ceiling: 2 OG Coins (20 tenths) per UTC day. */
export const BATTLE_DAILY_CAP_TENTHS = 20;

/**
 * First paying roast of the day always lands at least 0.5 coin; after that
 * rounds pay small increments (max 0.2). Never exceeds the daily ceiling.
 */
export function shapeDailyReward(requested: number, dailySoFar: number): number {
  const asked = Math.max(0, Math.min(10, Math.round(requested)));
  if (asked <= 0) return 0;
  const shaped = dailySoFar <= 0 ? Math.max(asked, 5) : Math.min(asked, 2);
  return Math.max(0, Math.min(shaped, BATTLE_DAILY_CAP_TENTHS - dailySoFar));
}

/** Today's date as YYYY-MM-DD (UTC) — streaks are counted per calendar day. */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Roll the daily streak forward: same day keeps it, yesterday extends it. */
export function nextStreak(
  current: number,
  lastDate: string | null,
  today: string = todayISO(),
): { days: number } {
  if (!lastDate) return { days: 1 };
  if (lastDate === today) return { days: Math.max(1, current) };
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (lastDate === yesterday.toISOString().slice(0, 10)) return { days: Math.max(1, current) + 1 };
  return { days: 1 };
}

/** Bonus tenths for streak milestones — paid at most once a day. */
export function streakBonus(days: number): number {
  if (days >= 7) return 3;
  if (days >= 3) return 2;
  return 0;
}

/** Post a user message to the community + trigger a short OG Bot reply. */
export const postCommunityMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { content: string; foulMouth?: boolean }) => {
    const content = String(data?.content ?? "").trim();
    if (!content) throw new Error("Message required");
    if (content.length > 1000) throw new Error("Message too long (1000 chars max)");
    return { content, foulMouth: Boolean(data?.foulMouth) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const useFoul = data.foulMouth !== false;

    // Everything the clapback needs loads at once: the poster's name, the
    // room's recent lines, the slang bank and the poster's battle record.
    const lex = await import("@/lib/battle-lexicon.server");
    const [{ data: profile }, { data: recentBefore }, slangBank, { data: mine }, { data: rec }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("display_name, email")
          .eq("id", context.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("community_messages")
          .select("role, content, display_name")
          .order("created_at", { ascending: false })
          .limit(11),
        useFoul ? lex.learnedSlangBlock(supabaseAdmin as never) : Promise.resolve(""),
        supabaseAdmin
          .from("og_learned_insults")
          .select("phrase")
          .eq("user_id", context.userId)
          .order("uses", { ascending: false })
          .limit(12),
        supabaseAdmin
          .from("battle_tallies")
          .select(
            "rounds, streak_days, total_awarded_coins, pending_tenths, last_battle_date, streak_bonus_date",
          )
          .eq("user_id", context.userId)
          .maybeSingle(),
      ]);
    const { maskDevIdentity } = await import("@/lib/dev-identity");
    const masked = maskDevIdentity(profile) ?? profile;
    const displayName =
      masked?.display_name || (masked?.email ? String(masked.email).split("@")[0] : "OG member");

    // 1. Insert the user message (the clapback is written while it saves)
    const insertUser = Promise.resolve(
      supabaseAdmin
        .from("community_messages")
        .insert({
          user_id: context.userId,
          role: "user",
          content: data.content,
          display_name: displayName,
        })
        .select("id, user_id, role, content, display_name, created_at")
        .single()
        .then(({ data: row, error }) => {
          if (error) throw new Error(error.message);
          return row;
        }),
    );
    // Handled below; this just stops an early failure being reported twice.
    insertUser.catch(() => {});
    {
      const { alertBossPresence } = await import("@/lib/presence-alert.server");
      void alertBossPresence(context.userId, "battle");
    }

    // 2. Build short context: last ~12 messages including the one just posted
    const history = [
      ...((recentBefore ?? []).reverse() as {
        role: "user" | "bot";
        content: string;
        display_name: string | null;
      }[]),
      { role: "user" as const, content: data.content, display_name: displayName },
    ];

    // 3. Call the AI provider for a short reply (fire-and-forget; if it fails, just no reply)
    const { aiChatTarget, fetchAiChat } = await import("@/lib/ai-endpoint.server");
    const ai = aiChatTarget(context.userId);
    const apiKey = ai ? "configured" : "";
    // The judge runs alongside the clapback instead of after it, so the
    // reply isn't held up waiting for two AI calls back to back.
    const judgePromise: Promise<number> = apiKey
      ? scoreRoast(apiKey, data.content, null)
      : Promise.resolve(0);
    // Today's banked scores (for the hidden daily ceiling) load meanwhile too.
    const todayRowsPromise = Promise.resolve(
      supabaseAdmin
        .from("community_messages")
        .select("score_tenths")
        .eq("user_id", context.userId)
        .eq("role", "user")
        .gte("created_at", `${todayISO()}T00:00:00Z`)
        .not("score_tenths", "is", null),
    );
    todayRowsPromise.catch(() => {});
    // So does the crew memory for the clapback.
    const crewMemoryPromise = ai
      ? crewMemory(supabaseAdmin, history).catch((e) => {
          console.warn("battle crew memory failed", (e as Error).message);
          return "";
        })
      : Promise.resolve("");
    let botReply: string | null = null;
    if (ai) {
      // Live chat = foul mouth by default for everyone.
      // VIPs still get it (and can toggle off via their preference), but the
      // group room always leans savage unless the client explicitly opts out.
      void lex.learnBattleWords(supabaseAdmin as never, data.content);
      let slang = slangBank;
      // Personal memory: remember this player's own insults + battle record.
      try {
        const { extractInsults } = await import("@/lib/insult-learner.server");
        for (const phrase of extractInsults(data.content)) {
          void supabaseAdmin.rpc("og_learn_insult", {
            p_user_id: context.userId,
            p_phrase: phrase,
          });
        }
        const lines: string[] = [];
        if (rec?.rounds)
          lines.push(
            `${displayName} has fought ${rec.rounds} rounds, ${rec.streak_days ?? 0}-day streak, won ${rec.total_awarded_coins ?? 0} coins off you. Use it — veteran = respect-roast, rookie = fresh meat.`,
          );
        const phrases = (mine ?? []).map((r) => r.phrase).filter(Boolean);
        if (phrases.length && useFoul)
          lines.push(
            `${displayName}'s signature insults (they've thrown these before — at most one per reply, flip it back on them to show you remember): ${phrases.join("; ")}`,
          );
        if (lines.length) slang += `\n\nPLAYER MEMORY:\n${lines.join("\n")}`;
        slang += await crewMemoryPromise;
      } catch (e) {
        console.warn("battle memory failed", (e as Error).message);
      }
      try {
        const { response: res } = await fetchAiChat(
          {
            temperature: useFoul ? 1.05 : 0.85,
            messages: [
              {
                role: "system",
                content: useFoul ? FOUL_SYSTEM_PROMPT + BATTLE_EXTRA + slang : SYSTEM_PROMPT,
              },
              ...history.map((m) => ({
                role: m.role === "bot" ? ("assistant" as const) : ("user" as const),
                content:
                  m.role === "user" && m.display_name
                    ? `${m.display_name}: ${m.content}`
                    : m.content,
              })),
            ],
          },
          context.userId,
          { foulMouth: !!useFoul },
        );
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
          };
          const reply = (json.choices?.[0]?.message?.content ?? "").trim();
          if (reply) {
            botReply = reply;
            // The member's line always lands in the room before the clapback.
            await insertUser;
            await supabaseAdmin.from("community_messages").insert({
              user_id: null,
              role: "bot",
              content: reply,
              display_name: "OG Bot",
            });
          }
        }
      } catch (err) {
        console.warn("community bot reply failed:", (err as Error).message);
      }
    }

    const userRow = await insertUser;

    // 4. Judge the roast and bank the reward (tenths of a coin, max 10 per message)
    let earnedTenths = 0;
    let pendingTenths = 0;
    let rounds = 0;
    let streakDays = 0;
    let streakBonusTenths = 0;
    let capHit = false;
    try {
      // Read with the poster's record at the start (the reward RPC below is
      // the atomic part; this only shapes the award).
      const tally = rec;
      pendingTenths = tally?.pending_tenths ?? 0;
      rounds = tally?.rounds ?? 0;
      const avgTenths = rounds > 0 ? pendingTenths / rounds : 0;
      // Repeat-spam guard: the same line twice in a row banks nothing.
      const isRepeat = history
        .filter((m) => m.role === "user" && m.display_name === displayName)
        .slice(-3, -1)
        .some((m) => m.content.trim().toLowerCase() === data.content.trim().toLowerCase());
      const judgedScore = await judgePromise;
      const raw = Math.max(judgedScore, estimateRoastFloor(data.content));
      earnedTenths = calibrateAward(raw, data.content, avgTenths, isRepeat);

      // Daily streak: showing up on consecutive days pays a small bonus,
      // once per day, folded into this message's reward (still capped at 10).
      const streak = nextStreak(tally?.streak_days ?? 0, tally?.last_battle_date ?? null);
      streakDays = streak.days;
      const bonusPaidToday = (tally?.streak_bonus_date ?? null) === todayISO();
      streakBonusTenths = bonusPaidToday ? 0 : streakBonus(streak.days);
      // Hidden daily ceiling: today's banked scores live on the user's own lines.
      const { data: todayRows } = await todayRowsPromise;
      const dailySoFar = ((todayRows ?? []) as { score_tenths: number | null }[]).reduce(
        (s, r) => s + Number(r.score_tenths ?? 0),
        0,
      );
      const requestTenths = shapeDailyReward(
        Math.min(10, earnedTenths + streakBonusTenths),
        dailySoFar,
      );

      const { data: rewardResult, error: rewardError } =
        requestTenths > 0
          ? await supabaseAdmin.rpc("add_battle_reward", {
              _user_id: context.userId,
              _earned_tenths: requestTenths,
            })
          : { data: null, error: null };
      if (rewardError) throw rewardError;
      const applied = rewardResult as {
        earned_tenths?: number;
        pending_tenths?: number;
        rounds?: number;
      } | null;
      earnedTenths = Number(applied?.earned_tenths ?? 0);
      pendingTenths = Number(applied?.pending_tenths ?? pendingTenths);
      rounds = Number(applied?.rounds ?? rounds);
      if (earnedTenths <= 0) streakBonusTenths = 0;
      capHit = earnedTenths > 0 && dailySoFar + earnedTenths >= BATTLE_DAILY_CAP_TENTHS;

      await Promise.all([
        supabaseAdmin
          .from("battle_tallies")
          .update({
            streak_days: streakDays,
            last_battle_date: todayISO(),
            ...(streakBonusTenths > 0 ? { streak_bonus_date: todayISO() } : {}),
          })
          .eq("user_id", context.userId),
        // Remember the score so the Battle Zone can crown a roast of the day.
        earnedTenths > 0
          ? supabaseAdmin
              .from("community_messages")
              .update({ score_tenths: earnedTenths })
              .eq("id", (userRow as { id: string }).id)
          : null,
      ]);
    } catch (err) {
      console.warn("battle scoring failed:", (err as Error).message);
    }

    return {
      message: userRow as CommunityMessage,
      award: { earnedTenths, pendingTenths, rounds, streakDays, streakBonusTenths, capHit },
    };
  });

/** Current pending battle reward for the signed-in user. */
export const getBattleTally = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("battle_tallies")
      .select("pending_tenths, rounds, total_awarded_coins, streak_days, last_battle_date")
      .eq("user_id", context.userId)
      .maybeSingle();
    const streakLive =
      data?.last_battle_date && nextStreak(data.streak_days ?? 0, data.last_battle_date).days;
    return {
      pendingTenths: data?.pending_tenths ?? 0,
      rounds: data?.rounds ?? 0,
      totalAwardedCoins: data?.total_awarded_coins ?? 0,
      streakDays: typeof streakLive === "number" ? streakLive : 0,
    };
  });

/** The highest-scoring roast of the last 24 hours — crowned in the Battle Zone. */
export const getRoastOfTheDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadRoastOfTheDay(supabaseAdmin);
  });

async function loadRoastOfTheDay(supabaseAdmin: AdminClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("community_messages")
    .select("id, content, display_name, score_tenths, created_at")
    .eq("role", "user")
    .gte("created_at", since)
    .not("score_tenths", "is", null)
    .order("score_tenths", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { roast: null };
  return {
    roast: {
      id: data.id as string,
      content: data.content as string,
      displayName: (data.display_name as string | null) ?? "OG member",
      scoreTenths: Number(data.score_tenths ?? 0),
    },
  };
}

/** End the battle: pay out the accumulated reward and reset the tally. */
export const endBattle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tally } = await supabaseAdmin
      .from("battle_tallies")
      .select("pending_tenths, rounds, total_awarded_coins")
      .eq("user_id", context.userId)
      .maybeSingle();

    const pendingTenths = tally?.pending_tenths ?? 0;
    const rounds = tally?.rounds ?? 0;
    const coins = pendingTenths / 10;
    if (coins <= 0) {
      await supabaseAdmin.from("battle_tallies").upsert(
        {
          user_id: context.userId,
          pending_tenths: 0,
          rounds: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      return { coins: 0, rounds, pendingTenths, remainderTenths: 0 };
    }

    const { data: payout, error } = await supabaseAdmin.rpc("payout_battle_reward", {
      _user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    const paid = Number((payout as { coins?: number } | null)?.coins ?? coins);
    return { coins: paid, rounds, pendingTenths, remainderTenths: 0 };
  });

export type BattleLeaderboardRow = {
  userId: string;
  name: string;
  coinsWon: number;
  pendingTenths: number;
  rounds: number;
  isMe: boolean;
};

/** Top roasters ranked by coins won in the Battle Zone. */
export const getBattleLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadBattleBoard(supabaseAdmin, context.userId);
  });

async function loadBattleBoard(supabaseAdmin: AdminClient, meId: string | null) {
  const { data: tallies } = await supabaseAdmin
    .from("battle_tallies")
    .select("user_id, total_awarded_coins, pending_tenths, rounds")
    .order("total_awarded_coins", { ascending: false })
    .limit(20);
  const rows = tallies ?? [];
  if (!rows.length) return { rows: [] as BattleLeaderboardRow[] };

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, email")
    .in(
      "id",
      rows.map((r) => r.user_id),
    );
  const { maskDevIdentity } = await import("@/lib/dev-identity");
  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    const masked = (maskDevIdentity(p) ?? p) as {
      display_name?: string | null;
      email?: string | null;
    };
    nameById.set(
      p.id,
      masked.display_name || (masked.email ? String(masked.email).split("@")[0]! : "OG member"),
    );
  }

  return {
    rows: rows.map((r) => ({
      userId: r.user_id,
      name: nameById.get(r.user_id) ?? "OG member",
      coinsWon: r.total_awarded_coins ?? 0,
      pendingTenths: r.pending_tenths ?? 0,
      rounds: r.rounds ?? 0,
      isMe: r.user_id === meId,
    })) satisfies BattleLeaderboardRow[],
  };
}

/**
 * New users only see Battle Zone history from their first roast onwards,
 * and never anything before their own personal "clear history".
 */
async function joinedAt(admin: any, userId: string): Promise<string | null> {
  const [{ data }, { data: clr }] = await Promise.all([
    admin
      .from("community_messages")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from("community_history_clears").select("cleared_at").eq("user_id", userId).maybeSingle(),
  ]);
  // No roasts yet → far-future cutoff so they see no history at all.
  const first = data?.created_at ?? new Date(Date.now() + 60_000).toISOString();
  const cleared = clr?.cleared_at as string | undefined;
  return cleared && cleared > first ? cleared : first;
}

/** Hide everything before now — for this user only; nobody else is affected. */
export const clearMyBattleHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("community_history_clears")
      .upsert({ user_id: context.userId, cleared_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * After sign-up: move the guest's Battle Zone lines onto their new account
 * and carry their guest purse into the battle tally (once per account,
 * atomically in claim_guest_battle) so it can be banked like any other win.
 */
export const claimGuestBattleMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { guestId: string }) => ({ guestId: guestIdSchema(d?.guestId) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc(
      "claim_guest_battle" as never,
      {
        _user_id: context.userId,
        _guest_id: data.guestId,
      } as never,
    );
    if (!error) {
      const r = (res ?? {}) as { claimed?: number; credited_tenths?: number };
      return { claimed: Number(r.claimed ?? 0), creditedTenths: Number(r.credited_tenths ?? 0) };
    }
    // Database function not installed yet: just move the lines, as before.
    if (error.code !== "PGRST202" && error.code !== "42883") throw new Error(error.message);
    const { data: rows } = await supabaseAdmin
      .from("community_messages")
      .update({ user_id: context.userId })
      .eq("guest_id", data.guestId)
      .is("user_id", null)
      .eq("role", "user")
      .select("id");
    return { claimed: rows?.length ?? 0, creditedTenths: 0 };
  });

export const GUEST_MESSAGE_LIMIT = 5;

function guestIdSchema(v: unknown): string {
  const s = String(v ?? "");
  if (!/^[A-Za-z0-9-]{16,64}$/.test(s)) throw new Error("Invalid guest id");
  return s;
}

async function guestSince(admin: any, guestId: string): Promise<string> {
  const { data } = await admin
    .from("community_messages")
    .select("created_at")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.created_at ?? new Date(Date.now() + 60_000).toISOString();
}

/** Public: guest view of the Battle Zone from their first message onward. */
export const listGuestBattleMessages = createServerFn({ method: "POST" })
  .validator((d: { guestId: string }) => ({ guestId: guestIdSchema(d?.guestId) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = await guestSince(supabaseAdmin, data.guestId);
    const [{ data: rows }, { count }] = await Promise.all([
      supabaseAdmin
        .from("community_messages")
        .select("id, role, content, display_name, created_at, guest_id, user_id, score_tenths")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("community_messages")
        .select("id", { count: "exact", head: true })
        .eq("guest_id", data.guestId)
        .eq("role", "user"),
    ]);
    const used = count ?? 0;
    return {
      myName: guestBattleName(data.guestId),
      pendingTenths: await guestPurse(supabaseAdmin, data.guestId),
      rounds: used,
      messages: (await withVipBadges(supabaseAdmin, (rows ?? []).reverse())).map((r) => ({
        id: r.id,
        role: r.role as "user" | "bot",
        content: r.content,
        display_name: r.display_name,
        created_at: r.created_at,
        mine: r.guest_id === data.guestId && r.role === "user",
        member: !!r.user_id,
        vip: r.vip,
        vip_id: r.vip_id,
        score_tenths: (r.score_tenths as number | null) ?? null,
      })),
      remaining: Math.max(0, GUEST_MESSAGE_LIMIT - used),
    };
  });

/**
 * Public: a guest roast (max 5 per guest) + an OG Bot reply. The roast is
 * judged like a member's, but the coins only sit in the guest purse
 * (score_tenths on their lines) until they join and claim them.
 */
export const postGuestBattleMessage = createServerFn({ method: "POST" })
  .validator((d: { guestId: string; content: string }) => {
    const content = String(d?.content ?? "").trim();
    if (!content) throw new Error("Message required");
    if (content.length > 400) throw new Error("Keep it under 400 characters");
    return { guestId: guestIdSchema(d?.guestId), content };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("community_messages")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", data.guestId)
      .eq("role", "user");
    if ((count ?? 0) >= GUEST_MESSAGE_LIMIT) {
      return { ok: false as const, reason: "limit" as const, remaining: 0 };
    }
    // Global safety valve: cap total guest lines per minute so bots can't farm.
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentGuests } = await supabaseAdmin
      .from("community_messages")
      .select("id", { count: "exact", head: true })
      .not("guest_id", "is", null)
      .gte("created_at", minuteAgo);
    if ((recentGuests ?? 0) > 40) {
      return {
        ok: false as const,
        reason: "busy" as const,
        remaining: GUEST_MESSAGE_LIMIT - (count ?? 0),
      };
    }
    const displayName = guestBattleName(data.guestId);
    const { data: last } = await supabaseAdmin
      .from("community_messages")
      .select("content")
      .eq("guest_id", data.guestId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: row, error } = await supabaseAdmin
      .from("community_messages")
      .insert({
        user_id: null,
        guest_id: data.guestId,
        role: "user",
        content: data.content,
        display_name: displayName,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const botReply = await replyAsBot(supabaseAdmin, {
      userId: null,
      displayName,
      content: data.content,
      useFoul: true,
    });

    // Judge it exactly like a member's roast (same judge, floor and bands).
    let earnedTenths = 0;
    try {
      const isRepeat =
        !!last && String(last.content).trim().toLowerCase() === data.content.toLowerCase();
      const judged = await scoreRoast("configured", data.content, botReply);
      const raw = Math.max(judged, estimateRoastFloor(data.content));
      earnedTenths = shapeDailyReward(
        calibrateAward(raw, data.content, 0, isRepeat),
        await guestPurse(supabaseAdmin, data.guestId),
      );
      if (earnedTenths > 0) {
        await supabaseAdmin
          .from("community_messages")
          .update({ score_tenths: earnedTenths })
          .eq("id", (row as { id: string }).id);
      }
    } catch (err) {
      console.warn("guest battle scoring failed:", (err as Error).message);
      earnedTenths = 0;
    }

    return {
      ok: true as const,
      remaining: Math.max(0, GUEST_MESSAGE_LIMIT - (count ?? 0) - 1),
      award: {
        earnedTenths,
        pendingTenths: await guestPurse(supabaseAdmin, data.guestId),
      },
    };
  });

/** A guest's unbanked winnings: the scores on their own lines. */
async function guestPurse(admin: AdminClient, guestId: string): Promise<number> {
  const { data } = await admin
    .from("community_messages")
    .select("score_tenths")
    .eq("guest_id", guestId)
    .eq("role", "user")
    .is("user_id", null)
    .not("score_tenths", "is", null)
    .limit(GUEST_MESSAGE_LIMIT);
  return ((data ?? []) as { score_tenths: number | null }[]).reduce(
    (sum, r) => sum + Number(r.score_tenths ?? 0),
    0,
  );
}

/** Public: roast of the day and the top roasters, for the guest Battle Zone. */
export const getGuestBattleExtras = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [roast, board] = await Promise.all([
    loadRoastOfTheDay(supabaseAdmin),
    loadBattleBoard(supabaseAdmin, null),
  ]);
  // Guests see names and wins only, never member ids.
  return {
    roast: roast.roast,
    rows: board.rows.map((r, i) => ({ ...r, userId: `rank-${i}` })),
  };
});

/**
 * Crew memory: when several players gang up, OG Bot gets each one's recent
 * lines so it can hit back personally at everyone in the pile-on.
 */
async function crewMemory(
  admin: any,
  history: { role: string; display_name: string | null }[],
): Promise<string> {
  const names = [
    ...new Set(
      history
        .filter((m) => m.role === "user" && m.display_name)
        .slice(-12)
        .map((m) => m.display_name as string),
    ),
  ].slice(0, 5);
  if (names.length === 0) return "";
  const { data } = await admin
    .from("community_messages")
    .select("display_name, content")
    .eq("role", "user")
    .in("display_name", names)
    .order("created_at", { ascending: false })
    .limit(60);
  const by = new Map<string, string[]>();
  for (const r of (data ?? []) as { display_name: string; content: string }[]) {
    const list = by.get(r.display_name) ?? [];
    if (list.length < 6) list.push(r.content.slice(0, 140));
    by.set(r.display_name, list);
  }
  const lines = [...by.entries()].map(([n, l]) => `- ${n}: ${l.join(" | ")}`);
  const gang =
    names.length > 1
      ? `\nThey're GANGING UP on you (${names.join(", ")}). Take them all on in one reply — name each one and hit them with something personal from their own past lines below. Never back down from a pile-on.`
      : "";
  return `\n\nCREW MEMORY (their past lines — use them for personal, specific roasts; never repeat them verbatim):\n${lines.join("\n")}${gang}`;
}

/** Shared bot reply used by guest battles. */
async function replyAsBot(
  admin: any,
  opts: { userId: string | null; displayName: string; content: string; useFoul: boolean },
): Promise<string | null> {
  const { data: recent } = await admin
    .from("community_messages")
    .select("role, content, display_name")
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (
    (recent ?? []) as { role: string; content: string; display_name: string | null }[]
  ).reverse();
  const { fetchAiChat } = await import("@/lib/ai-endpoint.server");
  const lex = await import("@/lib/battle-lexicon.server");
  void lex.learnBattleWords(admin as never, opts.content);
  let extra = opts.useFoul ? await lex.learnedSlangBlock(admin as never) : "";
  try {
    extra += await crewMemory(admin, history);
  } catch {
    /* memory is optional */
  }
  try {
    const { response: res } = await fetchAiChat(
      {
        temperature: opts.useFoul ? 1.05 : 0.85,
        messages: [
          {
            role: "system",
            content: (opts.useFoul ? FOUL_SYSTEM_PROMPT + BATTLE_EXTRA : SYSTEM_PROMPT) + extra,
          },
          ...history.map((m) => ({
            role: m.role === "bot" ? ("assistant" as const) : ("user" as const),
            content:
              m.role === "user" && m.display_name ? `${m.display_name}: ${m.content}` : m.content,
          })),
        ],
      },
      opts.userId ?? "guest",
      { foulMouth: opts.useFoul },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return null;
    await admin.from("community_messages").insert({
      user_id: null,
      role: "bot",
      content: reply,
      display_name: "OG Bot",
    });
    return reply;
  } catch (e) {
    console.warn("guest bot reply failed:", (e as Error).message);
    return null;
  }
}

/** Initial fetch of the latest N messages, oldest-first. */
export const listCommunityMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = await joinedAt(supabaseAdmin, context.userId);
    let q = supabaseAdmin
      .from("community_messages")
      .select("id, user_id, role, content, display_name, created_at, score_tenths")
      .order("created_at", { ascending: false })
      .limit(100);
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const messages = ((data ?? []) as CommunityMessage[]).reverse();
    return { messages: (await withVipBadges(supabaseAdmin, messages)) as CommunityMessage[] };
  });

/** Load a page of older messages strictly before the given (created_at, id) cursor. */
export const listOlderCommunityMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { before: string; beforeId?: string; limit?: number }) => {
    const before = String(data?.before ?? "");
    if (!before) throw new Error("before required");
    const beforeId = data?.beforeId ? String(data.beforeId) : null;
    const limit = Math.min(Math.max(Number(data?.limit ?? 50), 1), 100);
    return { before, beforeId, limit };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = await joinedAt(supabaseAdmin, context.userId);
    // Composite cursor on (created_at, id) avoids dropping/duplicating rows
    // that share the exact same created_at timestamp.
    const query = supabaseAdmin
      .from("community_messages")
      .select("id, user_id, role, content, display_name, created_at, score_tenths")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(data.limit);
    if (since) query.gte("created_at", since);
    const { data: rows, error } = data.beforeId
      ? await query.or(
          `created_at.lt.${data.before},and(created_at.eq.${data.before},id.lt.${data.beforeId})`,
        )
      : await query.lt("created_at", data.before);
    if (error) throw new Error(error.message);
    const messages = ((rows ?? []) as CommunityMessage[]).reverse();
    return {
      messages: (await withVipBadges(supabaseAdmin, messages)) as CommunityMessage[],
      hasMore: (rows?.length ?? 0) === data.limit,
    };
  });

/** Dev/admin only: wipe the live community chat. */
export const clearCommunityMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: isDev } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "dev",
    });
    if (!isAdmin && !isDev) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("community_messages").delete().not("id", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Battle Zone safety: users the caller has blocked. */
export const listMyCommunityBlocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("community_blocks" as never)
      .select("blocked_id")
      .eq("blocker_id", context.userId);
    return { blocked: ((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id) };
  });

/** Block a member so their Battle Zone messages are hidden for the caller. */
export const blockCommunityUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => {
    if (!d || typeof d.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.userId)) {
      throw new Error("Invalid user");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("You can't block yourself");
    const { error } = await context.supabase
      .from("community_blocks" as never)
      .upsert({ blocker_id: context.userId, blocked_id: data.userId } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Report an abusive Battle Zone message; Boss is alerted on Telegram. */
export const reportCommunityMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { messageId: string; reason?: string }) => {
    if (!d || typeof d.messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.messageId)) {
      throw new Error("Invalid message");
    }
    return { messageId: d.messageId, reason: String(d.reason ?? "abusive").slice(0, 200) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msg } = await supabaseAdmin
      .from("community_messages")
      .select("id, user_id, content, display_name")
      .eq("id", data.messageId)
      .maybeSingle();
    if (!msg) throw new Error("Message not found");
    const { error } = await supabaseAdmin.from("community_reports" as never).upsert(
      {
        reporter_id: context.userId,
        message_id: msg.id,
        reported_user_id: msg.user_id,
        reason: data.reason,
      } as never,
      { onConflict: "reporter_id,message_id", ignoreDuplicates: true } as never,
    );
    if (error) throw new Error(error.message);
    try {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "boss"] as never);
      const ids = [...new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))];
      if (ids.length) {
        const { data: bosses } = await supabaseAdmin
          .from("profiles")
          .select("telegram_chat_id")
          .in("id", ids);
        const esc = (s: string) =>
          s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        const text = `<b>🚩 Battle Zone report</b>\nFrom: ${esc(msg.display_name || "OG member")}\n“${esc(String(msg.content).slice(0, 300))}”\nReview and remove within 24h if abusive.`;
        const { vipAckTelegram } = await import("@/lib/vip-ack.server");
        const chats = [...new Set((bosses ?? []).map((b) => b.telegram_chat_id).filter(Boolean))];
        await Promise.all(
          chats.map((chat_id) =>
            vipAckTelegram("sendMessage", { chat_id, text, parse_mode: "HTML" }),
          ),
        );
      }
    } catch (e) {
      console.error("report alert failed", e);
    }
    return { ok: true };
  });
