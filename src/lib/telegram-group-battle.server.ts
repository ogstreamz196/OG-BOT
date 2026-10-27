/**
 * Battle Zone, in Telegram groups. OG B0T roasts whoever comes at it (a reply
 * to one of its messages, an @mention or /roast) in full Foul Mouth, and
 * when several people pile on it takes them all on in one reply, naming each
 * one and using their own recent lines, the same way the Battle Zone does.
 * New members get roasted by name the moment they join.
 *
 * A burst of messages from one person gets one reply, to the latest, covering
 * everything they've said since OG B0T last answered them. Someone spamming
 * goes on slow mode: one notice with a countdown, then no replies to them
 * until it's up (30s, 60s, then 120s the harder they go).
 *
 * Battles need no OG B0T account: only the Boss can add the bot to a group.
 * The group's battle lines (first name and text of messages aimed at the bot,
 * and the bot's replies) are kept for 24 hours as the battle's memory, never
 * linked to an account, then deleted.
 */
import { BATTLE_EXTRA, FOUL_SYSTEM_PROMPT } from "@/lib/battle-prompts";

type Admin = any;

const LINES = "telegram_group_lines";
const MEMORY_MS = 24 * 3_600_000;
/** Most bot replies per group per hour, so a group can't run up the AI bill. */
export const GROUP_REPLIES_PER_HOUR = 120;

type Line = {
  role: "user" | "bot" | "slow";
  name: string | null;
  content: string;
  created_at: string;
  /** Who said it, or for OG B0T's lines, who it was answering. */
  telegram_user_id?: number | null;
  telegram_message_id?: number | null;
};

/** How long to wait for someone's next message before answering. */
export const timing = { settleMs: 2500 };
/** Messages a minute that count as spamming, and the slow mode that follows. */
export const SPAM_PER_MINUTE = 6;
export function slowModeSeconds(messagesLastMinute: number): number {
  if (messagesLastMinute < SPAM_PER_MINUTE) return 0;
  if (messagesLastMinute < SPAM_PER_MINUTE * 2) return 30;
  if (messagesLastMinute < SPAM_PER_MINUTE * 3) return 60;
  return 120;
}

const GROUP_BATTLE_NOTE =
  "\n\nTELEGRAM GROUP: this is a real group chat. Lines come in as 'Name: message'. " +
  "Roast whoever's talking by name. Never mention anyone's coins, account, purchases or private details.";

async function recentLines(admin: Admin, chatId: number, limit = 40): Promise<Line[]> {
  const read = (cols: string) =>
    admin
      .from(LINES)
      .select(cols)
      .eq("chat_id", chatId)
      .gte("created_at", new Date(Date.now() - MEMORY_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
  try {
    let { data, error } = await read(
      "role, name, content, created_at, telegram_user_id, telegram_message_id",
    );
    // Before the user columns exist.
    if (error) ({ data, error } = await read("role, name, content, created_at"));
    if (error) return [];
    return ((data ?? []) as Line[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

async function saveLine(admin: Admin, chatId: number, line: Omit<Line, "created_at">) {
  try {
    const row = { chat_id: chatId, ...line, content: line.content.slice(0, 500) };
    const { error } = await admin.from(LINES).insert(row);
    // Before the user columns exist: keep the line without them.
    if (error && line.role !== "slow") {
      const { telegram_user_id: _u, telegram_message_id: _m, ...plain } = row;
      await admin.from(LINES).insert(plain);
    }
  } catch {
    /* memory is optional */
  }
}

/** The conversation as the AI sees it (slow-mode notes left out). */
const chatTurns = (lines: Line[]) =>
  lines
    .filter((l) => l.role !== "slow")
    .map((l) => ({
      role: l.role === "bot" ? ("assistant" as const) : ("user" as const),
      content: l.role === "user" && l.name ? `${l.name}: ${l.content}` : l.content,
    }));

/** Whether the group has had its hourly share of replies. */
async function overLimit(admin: Admin, chatId: number): Promise<boolean> {
  try {
    const { count, error } = await admin
      .from(LINES)
      .select("chat_id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .eq("role", "bot")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    return !error && (count ?? 0) >= GROUP_REPLIES_PER_HOUR;
  } catch {
    return false;
  }
}

/** Old battle lines go after 24 hours. */
async function forgetOld(admin: Admin) {
  try {
    await admin
      .from(LINES)
      .delete()
      .lt("created_at", new Date(Date.now() - MEMORY_MS).toISOString());
  } catch {
    /* tried again next time */
  }
}

/**
 * Crew memory, from the group's own recent lines: each person's last few
 * lines, and a pile-on note when more than one of them is at it.
 */
export function crewNote(lines: Line[], speaker: string | null): string {
  const userLines = lines.filter((l) => l.role === "user" && l.name);
  const names = [
    ...new Set([
      ...userLines.slice(-12).map((l) => l.name as string),
      ...(speaker ? [speaker] : []),
    ]),
  ].slice(-5);
  if (!names.length) return "";
  const by = names.map((n) => {
    const said = userLines
      .filter((l) => l.name === n)
      .slice(-6)
      .map((l) => l.content.slice(0, 140));
    return said.length ? `- ${n}: ${said.join(" | ")}` : null;
  });
  const gang =
    names.length > 1
      ? `\nThey're GANGING UP on you (${names.join(", ")}). Take them all on in one reply — name each one and hit them with something personal from their own past lines below. Never back down from a pile-on.`
      : "";
  const memory = by.filter(Boolean);
  return memory.length || gang
    ? `\n\nCREW MEMORY (their past lines — use them for personal, specific roasts; never repeat them verbatim):\n${memory.join("\n")}${gang}`
    : "";
}

async function battleAnswer(
  admin: Admin,
  chatId: number,
  lines: Line[],
  turn: { role: "user"; content: string },
  speaker: string | null,
): Promise<string | null> {
  const lex = await import("@/lib/battle-lexicon.server");
  const slang = await lex.learnedSlangBlock(admin);
  const { fetchAiChat } = await import("@/lib/ai-endpoint.server");
  // Free models only: group roasts never spend on paid AI. If they're all
  // down, there's no answer (the caller says it's busy, at most now and then).
  const reply = await fetchAiChat(
    {
      temperature: 1.05,
      messages: [
        {
          role: "system",
          content:
            FOUL_SYSTEM_PROMPT +
            BATTLE_EXTRA +
            slang +
            crewNote(lines, speaker) +
            GROUP_BATTLE_NOTE,
        },
        ...chatTurns(lines),
        turn,
      ],
    },
    `telegram-group:${chatId}`,
    { foulMouth: true, freeOnly: true },
  ).catch(() => null);
  const response = reply?.response;
  if (!response?.ok) return null;
  const json = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  return text || null;
}

export type BattleTurn =
  | { kind: "reply"; text: string }
  | { kind: "slow"; seconds: number }
  /** The free AI didn't answer; say so (at most every couple of minutes per group). */
  | { kind: "busy" }
  | { kind: "quiet" };

// When the free models are down, a group hears "busy" once, not on every line.
const BUSY_EVERY_MS = 2 * 60_000;
const busySaid = new Map<number, number>();
function busyNotice(chatId: number): BattleTurn {
  const last = busySaid.get(chatId) ?? 0;
  if (Date.now() - last < BUSY_EVERY_MS) return { kind: "quiet" };
  busySaid.set(chatId, Date.now());
  return { kind: "busy" };
}

/**
 * A battle turn: `name` (Telegram user `userId`) came at OG B0T with `text`
 * in message `messageId` (`quoted` is OG B0T's own message they replied to,
 * if any). Waits a moment for more from them; if more came, the newest
 * message's turn answers instead. Returns the clapback, a slow-mode notice
 * (seconds left), or quiet (a newer message, still on slow mode, the hourly
 * limit, or no answer from the AI).
 */
export async function groupBattleTurn(
  admin: Admin,
  opts: {
    chatId: number;
    userId?: number;
    messageId?: number;
    name: string | null;
    text: string;
    quoted?: string;
  },
): Promise<BattleTurn> {
  const { chatId, userId, messageId, name } = opts;
  await saveLine(admin, chatId, {
    role: "user",
    name,
    content: opts.text,
    telegram_user_id: userId ?? null,
    telegram_message_id: messageId ?? null,
  });
  const lex = await import("@/lib/battle-lexicon.server");
  void lex.learnBattleWords(admin, opts.text);
  if (timing.settleMs > 0) await new Promise((r) => setTimeout(r, timing.settleMs));

  const lines = await recentLines(admin, chatId, 60);
  const mine = userId ? lines.filter((l) => l.telegram_user_id === userId) : [];
  const said = mine.filter((l) => l.role === "user");
  // They've sent something newer: that message gets the answer.
  if (messageId && said.some((l) => (l.telegram_message_id ?? 0) > messageId)) {
    return { kind: "quiet" };
  }

  const now = Date.now();
  const lastReply = mine.filter((l) => l.role === "bot").at(-1);
  const lastReplyAt = lastReply ? Date.parse(lastReply.created_at) : 0;
  const slow = slowModeSeconds(said.filter((l) => now - Date.parse(l.created_at) < 60_000).length);
  if (slow && lastReplyAt && now - lastReplyAt < slow * 1000) {
    // On slow mode: one notice with the countdown, then nothing until it's up.
    const noticed = mine.some((l) => l.role === "slow" && Date.parse(l.created_at) >= lastReplyAt);
    if (noticed) return { kind: "quiet" };
    const seconds = Math.ceil((slow * 1000 - (now - lastReplyAt)) / 1000);
    await saveLine(admin, chatId, {
      role: "slow",
      name: "OG B0T",
      content: `slow mode ${slow}s`,
      telegram_user_id: userId ?? null,
    });
    return { kind: "slow", seconds };
  }
  if (await overLimit(admin, chatId)) return { kind: "quiet" };

  // Everything they've said since OG B0T last answered them, in one turn.
  const backlog = said
    .filter((l) => Date.parse(l.created_at) > lastReplyAt)
    .filter((l) => lastReplyAt || now - Date.parse(l.created_at) < 5 * 60_000)
    .slice(-6);
  const pending = backlog.length ? backlog : [{ content: opts.text } as Line];
  const history = lines.filter((l) => !backlog.includes(l));
  // Replying to an OG B0T message that isn't in the memory (a signal card,
  // an older line): that message is the context.
  if (opts.quoted && !history.some((l) => l.role === "bot" && l.content === opts.quoted)) {
    history.push({ role: "bot", name: "OG B0T", content: opts.quoted, created_at: "" });
  }
  const who = name ?? "Someone";
  const turn = {
    role: "user" as const,
    content:
      pending.length === 1
        ? name
          ? `${name}: ${pending[0].content}`
          : pending[0].content
        : `${who} sent ${pending.length} messages in a row — answer the lot in one reply:\n` +
          pending.map((l) => `${who}: ${l.content}`).join("\n"),
  };
  const answer = await battleAnswer(admin, chatId, history, turn, name);
  if (!answer) return busyNotice(chatId);
  await saveLine(admin, chatId, {
    role: "bot",
    name: "OG B0T",
    content: answer,
    telegram_user_id: userId ?? null,
  });
  void forgetOld(admin);
  return { kind: "reply", text: answer };
}

/** New members just joined: OG B0T initiates them, by name, in full Foul Mouth. */
export async function newMemberRoast(
  admin: Admin,
  chatId: number,
  members: { first_name?: string; username?: string }[],
): Promise<string | null> {
  if (await overLimit(admin, chatId)) return null;
  const who = members
    .slice(0, 5)
    .map((m) => [m.first_name, m.username ? `@${m.username}` : null].filter(Boolean).join(" "))
    .filter(Boolean);
  if (!who.length) return null;
  const lines = await recentLines(admin, chatId);
  const turn = {
    role: "user" as const,
    content:
      `[${who.join(", ")} just joined the group.] Welcome them the OG way: ` +
      `roast ${who.length > 1 ? "each one" : "them"} by name, using their name and username for material. ` +
      "Fully foul, 2–3 punchy lines total. Make them feel properly initiated: banter, not bullying.",
  };
  const answer = await battleAnswer(admin, chatId, lines, turn, null);
  if (answer) await saveLine(admin, chatId, { role: "bot", name: "OG B0T", content: answer });
  return answer;
}
