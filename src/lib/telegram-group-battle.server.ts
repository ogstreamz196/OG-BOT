/**
 * Battle Zone, in Telegram groups. OG B0T roasts whoever comes at it (a reply
 * to one of its messages, an @mention or /roast) in full Foul Mouth, and
 * when several people pile on it takes them all on in one reply, naming each
 * one and using their own recent lines, the same way the Battle Zone does.
 * New members get roasted by name the moment they join.
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

type Line = { role: "user" | "bot"; name: string | null; content: string; created_at: string };

const GROUP_BATTLE_NOTE =
  "\n\nTELEGRAM GROUP: this is a real group chat. Lines come in as 'Name: message'. " +
  "Roast whoever's talking by name. Never mention anyone's coins, account, purchases or private details.";

async function recentLines(admin: Admin, chatId: number): Promise<Line[]> {
  try {
    const { data, error } = await admin
      .from(LINES)
      .select("role, name, content, created_at")
      .eq("chat_id", chatId)
      .gte("created_at", new Date(Date.now() - MEMORY_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return [];
    return ((data ?? []) as Line[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

async function saveLine(admin: Admin, chatId: number, line: Omit<Line, "created_at">) {
  try {
    await admin
      .from(LINES)
      .insert({ chat_id: chatId, ...line, content: line.content.slice(0, 500) });
  } catch {
    /* memory is optional */
  }
}

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
  const { response } = await fetchAiChat(
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
        ...lines.map((l) => ({
          role: l.role === "bot" ? ("assistant" as const) : ("user" as const),
          content: l.role === "user" && l.name ? `${l.name}: ${l.content}` : l.content,
        })),
        turn,
      ],
    },
    `telegram-group:${chatId}`,
    { foulMouth: true },
  );
  if (!response.ok) return null;
  const json = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  return text || null;
}

/**
 * A battle turn: `name` came at OG B0T with `text` (`quoted` is OG B0T's own
 * message they replied to, if any). Returns the clapback, or null when the
 * group is over its hourly limit or the AI didn't answer.
 */
export async function groupBattleReply(
  admin: Admin,
  opts: { chatId: number; name: string | null; text: string; quoted?: string },
): Promise<string | null> {
  if (await overLimit(admin, opts.chatId)) return null;
  const lines = await recentLines(admin, opts.chatId);
  // Replying to an OG B0T message that isn't in the memory (a signal card,
  // an older line): that message is the context.
  if (opts.quoted && !lines.some((l) => l.role === "bot" && l.content === opts.quoted)) {
    lines.push({ role: "bot", name: "OG B0T", content: opts.quoted, created_at: "" });
  }
  const lex = await import("@/lib/battle-lexicon.server");
  void lex.learnBattleWords(admin, opts.text);
  const turn = {
    role: "user" as const,
    content: opts.name ? `${opts.name}: ${opts.text}` : opts.text,
  };
  const answer = await battleAnswer(admin, opts.chatId, lines, turn, opts.name);
  await saveLine(admin, opts.chatId, { role: "user", name: opts.name, content: opts.text });
  if (answer) await saveLine(admin, opts.chatId, { role: "bot", name: "OG B0T", content: answer });
  void forgetOld(admin);
  return answer;
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
