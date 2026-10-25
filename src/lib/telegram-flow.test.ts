import { createHash } from "crypto";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Group battles normally wait 2.5s for more from the same person; not here.
let timing: { settleMs: number };
beforeAll(async () => {
  ({ timing } = await import("@/lib/telegram-group-battle.server"));
  timing.settleMs = 0;
});

// Plays a member's taps through the real webhook against a fake Telegram and
// a fake database, and checks the bottom bar is never deleted from under them.

const CHAT = 4242;
type Sent = {
  id: number;
  text: string;
  markup?: Record<string, unknown>;
  chat?: number;
  body?: Record<string, unknown>;
};
const sent: Sent[] = [];
const deleted = new Set<number>();
const edits: { id: number; markup: Record<string, unknown> }[] = [];
let nextId = 100;
// What getMe says about Group Privacy (true = it sees every group message).
const botReadsAll = { value: true };
// Who the linked member is, and their foul mouth state.
const who = { roles: [] as string[], foulAllowed: true, foulOn: true };
// Telegram users with a linked account (a private chat id is the user id).
const linked = new Set<number>([CHAT]);
const inserts: { table: string; row: unknown }[] = [];
const calls: { method: string; body: Record<string, unknown> }[] = [];
type AiRequest = { messages: { role: string; content: string }[] };
const ai = { requests: [] as AiRequest[], battles: [] as AiRequest[] };

vi.mock("@/lib/telegram-api.server", () => ({
  escapeTelegramHtml: (s: string) => s,
  telegramApi: async (method: string, body: Record<string, unknown>) => {
    calls.push({ method, body });
    if (method === "getMe")
      return {
        ok: true,
        result: { username: "OGStreamzBot", can_read_all_group_messages: botReadsAll.value },
      };
    if (method === "sendMessage") {
      const id = nextId++;
      sent.push({
        id,
        text: String(body.text),
        markup: body.reply_markup as Record<string, unknown>,
        chat: body.chat_id as number,
        body,
      });
      return { ok: true, result: { message_id: id } };
    }
    if (method === "deleteMessages") for (const id of body.message_ids as number[]) deleted.add(id);
    if (method === "deleteMessage") deleted.add(body.message_id as number);
    if (method === "editMessageReplyMarkup")
      edits.push({
        id: body.message_id as number,
        markup: body.reply_markup as Record<string, unknown>,
      });
    return { ok: true, result: true };
  },
}));

// A tiny stand-in for the database: telegram_screen_messages is real, the
// member is linked, everything else is empty.
type Row = Record<string, unknown>;
const screens: Row[] = [];
// Tables kept for real (rows in insert order, each with a rising created_at).
const stored: Record<string, Row[]> = {
  telegram_group_lines: [],
  telegram_group_nudges: [],
  telegram_connect_tokens: [],
};
let clock = Date.now();
function query(table: string) {
  const filters: [string, (v: unknown) => boolean][] = [];
  let op: "select" | "delete" | "write" = "select";
  let single = false;
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    gt: () => q,
    gte: (col: string, v: unknown) => (filters.push([col, (x) => String(x) >= String(v)]), q),
    lt: (col: string, v: unknown) => (filters.push([col, (x) => String(x) < String(v)]), q),
    not: () => q,
    or: () => q,
    eq: (col: string, v: unknown) => (filters.push([col, (x) => x === v]), q),
    in: (col: string, vs: unknown[]) => (filters.push([col, (x) => vs.includes(x)]), q),
    maybeSingle: () => ((single = true), q),
    delete: () => ((op = "delete"), q),
    update: () => ((op = "write"), q),
    insert: (row: unknown) => {
      op = "write";
      inserts.push({ table, row });
      stored[table]?.push({ ...(row as Row), created_at: new Date(++clock).toISOString() });
      return q;
    },
    upsert: (row: Row) => {
      op = "write";
      if (table === "telegram_group_nudges") {
        const rows = stored[table];
        const i = rows.findIndex(
          (r) => r.chat_id === row.chat_id && r.telegram_user_id === row.telegram_user_id,
        );
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      if (table === "telegram_screen_messages") {
        const i = screens.findIndex(
          (r) => r.chat_id === row.chat_id && r.message_id === row.message_id,
        );
        const full = { kind: "screen", ...row };
        if (i >= 0) screens[i] = full;
        else screens.push(full);
      }
      return q;
    },
    then: (resolve: (v: unknown) => void) => {
      const match = (r: Row) => filters.every(([c, f]) => f(r[c]));
      let data: unknown = single ? null : [];
      let count = 0;
      const rows = stored[table];
      if (rows && op === "delete") {
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
      } else if (rows && op === "select") {
        const hit = rows.filter(match);
        count = hit.length;
        data = single ? (hit[0] ?? null) : hit;
      }
      if (table === "telegram_screen_messages") {
        if (op === "delete") {
          for (let i = screens.length - 1; i >= 0; i--) if (match(screens[i])) screens.splice(i, 1);
        } else data = screens.filter(match);
      }
      if (table === "profiles" && op === "select") {
        const tgId = filters.find(([c]) => c === "telegram_chat_id");
        const ok = !tgId || [...linked].some((id) => tgId[1](id));
        data = single ? (ok ? { id: "u1" } : null) : ok ? [{ id: "u1" }] : [];
      }
      if (table === "user_roles") data = who.roles.map((role) => ({ role }));
      resolve({ data, error: null, count });
    },
  };
  return q;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) },
}));
vi.mock("@/lib/telegram-signin.server", () => ({
  telegramSignInLinker: () => async (path: string) => `https://ogbot.co.uk${path}`,
}));
vi.mock("@/lib/foul-access.server", () => ({
  foulAccess: async () => ({ allowed: who.foulAllowed, on: who.foulAllowed && who.foulOn }),
  setFoulMouth: async (_a: unknown, _id: string, on: boolean) => {
    who.foulOn = on;
  },
}));
vi.mock("@/lib/trade-hold.server", () => ({ pickTradeHold: async () => "Hold on…" }));
const signalAsks: string[] = [];
vi.mock("@/lib/trade-signal-context.server", () => ({
  buildTradeSignal: async (ask: string) => {
    signalAsks.push(ask);
    return { reply: "📈 GOLD SCALP card", plan: {}, expiresAt: null };
  },
}));
const recordSignal = vi.fn(async () => undefined);
vi.mock("@/lib/trade-signal-tracker.server", () => ({ recordSignal }));
// The chat AI: a canned streamed answer, with the request kept for checks.
vi.mock("@/lib/ai-endpoint.server", () => ({
  aiChatTarget: () => ({}),
  liveFactsMessage: (_r: string, t: string) => t,
  // Battle replies (Battle Zone style) come through fetchAiChat.
  fetchAiChat: async (req: { messages: { role: string; content: string }[] }) => {
    ai.battles.push(req);
    return {
      response: new Response(
        JSON.stringify({ choices: [{ message: { content: `BATTLE ${ai.battles.length}` } }] }),
      ),
    };
  },
  streamAiChat: async (
    req: { messages: { role: string; content: string }[] },
    _id: string,
    _o: unknown,
    onDelta?: (d: string) => void,
  ) => {
    ai.requests.push(req);
    onDelta?.("OG reply");
    return { text: "OG reply" };
  },
}));
vi.mock("@/lib/battle-lexicon.server", () => ({
  learnBattleWords: async () => undefined,
  learnedSlangBlock: async () => "",
}));
vi.mock("@/lib/og-smarts.server", () => ({
  startGrounding: () => ({
    memories: Promise.resolve([{ fact: "PRIVATE-MEMORY" }]),
    football: Promise.resolve(""),
    research: Promise.resolve(null),
  }),
  checkFigures: async (t: string) => t,
}));
vi.mock("@/lib/og-memory", () => ({
  memoryNote: (m: unknown[]) => (m.length ? "\nMEMORY: PRIVATE-MEMORY" : ""),
}));
const learnFromMessage = vi.fn(async () => undefined);
vi.mock("@/lib/og-memory.server", () => ({ learnFromMessage }));
const loadUserDossier = vi.fn(async () => "PRIVATE-DOSSIER");
vi.mock("@/lib/og-user-dossier.server", () => ({ loadUserDossier }));
vi.mock("@/lib/vip-promo.server", () => ({ detectPromoIntent: () => false }));
const buildSportsGuideContext = vi.fn(async () => "PAID-SPORTS-GUIDE");
vi.mock("@/lib/sports-guide-context.server", () => ({
  buildSportsGuideContext,
  quickSportsReply: async () => "⚽ <b>OG Sports Guide</b>",
}));
vi.mock("@/lib/og-catchphrases.server", () => ({
  pickCatchphrases: async () => [],
  catchphraseNote: () => "",
  toneFor: () => "og",
}));

process.env.TELEGRAM_API_KEY = "test-key";
const secret = createHash("sha256").update("telegram-webhook:test-key").digest("base64url");
let updateId = 1;

async function post(update: Record<string, unknown>) {
  const { Route } = await import("@/routes/api/public/telegram/webhook");
  const handlers = (
    Route.options as unknown as {
      server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers;
  return handlers.POST({
    request: new Request("https://x/api/public/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({ update_id: updateId++, ...update }),
    }),
  });
}
const type = (text: string) =>
  post({
    message: {
      message_id: nextId++,
      text,
      chat: { id: CHAT, type: "private" },
      from: { id: CHAT },
    },
  });
const tap = (data: string, onMessage: number) =>
  post({
    callback_query: {
      id: "cb",
      data,
      from: { id: CHAT },
      message: { message_id: onMessage, chat: { id: CHAT } },
    },
  });

/** The message that set the bottom bar now showing. */
const barHolder = () => [...sent].reverse().find((m) => m.markup && "keyboard" in m.markup)!;
const barButtons = () =>
  (barHolder().markup!.keyboard as { text: string }[][]).flat().map((b) => b.text);
const lastSent = () => sent[sent.length - 1];
type Btn = { text: string; callback_data?: string; url?: string };
const buttons = (m: { markup?: Record<string, unknown> }) =>
  ((m.markup?.inline_keyboard ?? []) as Btn[][]).flat();
const liveBars = () => sent.filter((m) => m.markup && "keyboard" in m.markup && !deleted.has(m.id));
const showing = (needle: string) =>
  sent.filter((m) => m.text.includes(needle) && !deleted.has(m.id));

describe("telegram bot flow", () => {
  beforeEach(() => {
    sent.length = 0;
    deleted.clear();
    edits.length = 0;
    screens.length = 0;
    inserts.length = 0;
    calls.length = 0;
    ai.requests.length = 0;
    ai.battles.length = 0;
    for (const rows of Object.values(stored)) rows.length = 0;
    signalAsks.length = 0;
    linked.clear();
    linked.add(CHAT);
    vi.clearAllMocks();
    Object.assign(who, { roles: [], foulAllowed: true, foulOn: true });
  });

  test("signal buttons stay while signals run; menu items lead back to the menu", async () => {
    await type("/start");
    const intro = barHolder();
    expect(intro.text).toContain("OG B0T here");
    expect(barButtons()).toEqual(["📂 Menu", "📈 Signals", "🧹 Clear chat"]);

    // Signals: the intro clears, the signal buttons take over the bar.
    await type("📈 Signals");
    expect(deleted.has(intro.id)).toBe(true);
    const signalsBar = barHolder();
    expect(barButtons()).toEqual(["🥇 Gold", "₿ BTC", "🕐 Holding", "⬅️ Back"]);

    // Run signals back to back: the signal buttons are never deleted.
    await type("🥇 Gold");
    await type("₿ BTC");
    await type("🥇 Gold");
    expect(deleted.has(signalsBar.id)).toBe(false);
    expect(barHolder().id).toBe(signalsBar.id);
    // Each new signal wipes out the last; "hold on" lines go on the next tap.
    expect(showing("GOLD SCALP card").length).toBe(1);
    expect(showing("Hold on").length).toBe(1);

    // Back: main bar returns, the signals bar message goes.
    await type("⬅️ Back");
    expect(barButtons()).toEqual(["📂 Menu", "📈 Signals", "🧹 Clear chat"]);
    expect(deleted.has(signalsBar.id)).toBe(true);
    const mainBar = barHolder();

    // Menu → VIP → back to the menu, all without losing the bar.
    await type("📂 Menu");
    const menu = lastSent();
    expect(menu.text).toContain("OG Menu");
    await tap("menu:vip", menu.id);
    const vip = lastSent();
    expect(deleted.has(menu.id)).toBe(true);
    const vipRows = (vip.markup!.inline_keyboard as { text: string }[][]).flat();
    expect(vipRows.map((b) => b.text)).toContain("⬅️ Menu");
    await tap("menu:open", vip.id);
    expect(lastSent().text).toContain("OG Menu");
    expect(deleted.has(vip.id)).toBe(true);
    await tap("menu:tracks", lastSent().id);
    expect(lastSent().text).toContain("tracks");

    expect(deleted.has(mainBar.id)).toBe(false);
    expect(barHolder().id).toBe(mainBar.id);
    // Only one bar message is ever left in the chat.
    expect(
      sent.filter((m) => m.markup && "keyboard" in m.markup && !deleted.has(m.id)),
    ).toHaveLength(1);
  });

  test("menu straight after the intro keeps the bar", async () => {
    await type("/start");
    const intro = barHolder();
    await type("📂 Menu");
    expect(deleted.has(intro.id)).toBe(true);
    // A one-line holder took over the bar before the intro went.
    const holder = barHolder();
    expect(holder.id).not.toBe(intro.id);
    expect(deleted.has(holder.id)).toBe(false);
    expect(holder.text).toContain("OG B0T");
    expect(lastSent().text).toContain("OG Menu");
    // Typed menu commands (not from the panel) get no back button.
    await type("/vip");
    const rows = (lastSent().markup!.inline_keyboard as { text: string }[][]).flat();
    expect(rows.map((b) => b.text)).not.toContain("⬅️ Menu");
  });

  for (const boss of [false, true]) {
    test(`every menu button works and leads back to the menu (${boss ? "Boss" : "member"})`, async () => {
      if (boss) who.roles = ["boss"];
      await type("/start");
      await type("📂 Menu");
      let menu = lastSent();
      const keys = buttons(menu)
        .map((b) => b.callback_data)
        .filter((d): d is string => !!d && d !== "menu:foul");
      expect(keys.includes("menu:stats")).toBe(boss);
      expect(keys.includes("menu:users")).toBe(boss);
      expect(buttons(menu).some((b) => b.url?.startsWith("https://ogbot.co.uk"))).toBe(true);
      const mainBar = barHolder();

      for (const key of keys) {
        await tap(key, menu.id);
        const opened = lastSent();
        expect(opened.id, key).toBeGreaterThan(menu.id);
        expect(deleted.has(menu.id), `${key} replaces the menu`).toBe(true);
        expect(
          buttons(opened).map((b) => b.text),
          key,
        ).toContain("⬅️ Menu");
        await tap("menu:open", opened.id);
        menu = lastSent();
        expect(menu.text, key).toContain("OG Menu");
        expect(deleted.has(opened.id), `${key} is tidied by ⬅️ Menu`).toBe(true);
      }
      // The bar never moved, and only one bar message is in the chat.
      expect(barHolder().id).toBe(mainBar.id);
      expect(deleted.has(mainBar.id)).toBe(false);
      expect(liveBars()).toHaveLength(1);
      // Only one menu-made screen is ever left showing.
      expect(sent.filter((m) => m.text.includes("OG Menu") && !deleted.has(m.id))).toHaveLength(1);
    });
  }

  test("foul mouth switch flips on and off in place, and is locked for free members", async () => {
    await type("/start");
    await type("📂 Menu");
    const menu = lastSent();
    expect(buttons(menu)[0].text).toContain("Foul mouth: ON");
    await tap("menu:foul", menu.id);
    expect(who.foulOn).toBe(false);
    expect(buttons({ markup: edits.at(-1)!.markup })[0].text).toContain("Foul mouth: OFF");
    expect(edits.at(-1)!.id).toBe(menu.id);
    await tap("menu:foul", menu.id);
    expect(who.foulOn).toBe(true);
    expect(buttons({ markup: edits.at(-1)!.markup })[0].text).toContain("Foul mouth: ON");
    // Flipping edits the menu; it never sends a new message.
    expect(lastSent().id).toBe(menu.id);

    who.foulAllowed = false;
    await type("📂 Menu");
    const locked = lastSent();
    expect(buttons(locked)[0].text).toContain("🔒 Foul mouth (VIP)");
    await tap("menu:foul", locked.id);
    const perk = lastSent();
    expect(perk.text).toContain("VIP perk");
    expect(buttons(perk).map((b) => b.text)).toEqual(["👑 Get VIP", "⬅️ Menu"]);
    await tap("menu:open", perk.id);
    expect(lastSent().text).toContain("OG Menu");
  });

  test("1 min signals are on the Boss bar only", async () => {
    await type("/start");
    await type("📈 Signals");
    expect(barButtons()).not.toContain("🥇 Gold · 1 min");
    expect(barButtons().at(-1)).toBe("⬅️ Back");
    who.roles = ["boss"];
    await type("📈 Signals");
    expect(barButtons()).toContain("🥇 Gold · 1 min");
    expect(liveBars()).toHaveLength(1);
  });

  test("typed Boss commands stay as normal messages; members can't use them", async () => {
    who.roles = ["boss"];
    await type("/start");
    await type("/stats");
    const stats = lastSent();
    expect(stats.text).toContain("OG Streamz right now");
    expect(buttons(stats)).toHaveLength(0);
    await type("📂 Menu");
    expect(deleted.has(stats.id)).toBe(false);

    who.roles = [];
    await type("/stats");
    expect(lastSent().text).toContain("I don't know that one");
  });

  test("clear chat brings back the intro and the bar", async () => {
    await type("/start");
    await type("📈 Signals");
    await type("🧹 Clear chat");
    expect(barHolder().text).toContain("OG B0T here");
    expect(barButtons()).toEqual(["📂 Menu", "📈 Signals", "🧹 Clear chat"]);
    expect(liveBars()).toHaveLength(1);
  });

  test("a new signal wipes the last card and the updates under it, but not menus or chat", async () => {
    await type("/start");
    await type("📈 Signals");
    await type("🥇 Gold");
    const first = sent.filter((m) => m.text.includes("GOLD SCALP card")).at(-1)!;
    // The watcher posts an update under the card (it marks it as part of the signal).
    const update = { id: nextId++, text: "📊 Gold BUY · TP1 hit" };
    sent.push(update);
    screens.push({ chat_id: CHAT, message_id: update.id, kind: "signal" });
    // A question typed in between stays.
    const question = nextId;
    await type("what's the gold price doing?");

    await type("₿ BTC");
    expect(deleted.has(first.id)).toBe(true);
    expect(deleted.has(update.id)).toBe(true);
    expect(deleted.has(question)).toBe(false);
    expect(showing("GOLD SCALP card")).toHaveLength(1);
    // The signal buttons are still there.
    expect(barButtons()).toContain("🥇 Gold");
    expect(liveBars()).toHaveLength(1);
  });

  test("signals: tap a coin for its scalp; Holding switches the coins to 1-hour and back", async () => {
    await type("/start");
    await type("📈 Signals");
    await type("🥇 Gold");
    expect(signalAsks.at(-1)).toBe("XAUUSD signal 5m");
    await type("₿ BTC");
    expect(signalAsks.at(-1)).toBe("BTCUSD signal 5m");

    const scalpBar = barHolder();
    await type("🕐 Holding");
    expect(barButtons()).toEqual(["🥇 Gold · Holding", "₿ BTC · Holding", "⚡ Scalp", "⬅️ Back"]);
    expect(barHolder().text).toContain("Holding signals");
    // The bar changed: the old one's message goes, only one bar left.
    expect(deleted.has(scalpBar.id)).toBe(true);
    expect(liveBars()).toHaveLength(1);
    // The switch tap itself is tidied away; no signal was asked for.
    expect(signalAsks).toHaveLength(2);
    await type("₿ BTC · Holding");
    expect(signalAsks.at(-1)).toBe("BTCUSD signal 1h");

    await type("⚡ Scalp");
    expect(barButtons()).toEqual(["🥇 Gold", "₿ BTC", "🕐 Holding", "⬅️ Back"]);
    await type("⬅️ Back");
    expect(barButtons()).toEqual(["📂 Menu", "📈 Signals", "🧹 Clear chat"]);
    // An old four-button bar still on someone's screen keeps working.
    await type("🥇 Gold · Scalp");
    expect(signalAsks.at(-1)).toBe("XAUUSD signal 5m");
  });

  describe("in a group", () => {
    const GROUP = -100777;
    const FRIEND = 9001; // in the group, no OG B0T account
    const inGroup = (
      text: string,
      opts: { from?: number; reply_to?: { text: string; fromBot?: boolean } } = {},
    ) =>
      post({
        message: {
          message_id: nextId++,
          text,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: opts.from ?? CHAT, first_name: "Imran" },
          ...(opts.reply_to
            ? {
                reply_to_message: {
                  text: opts.reply_to.text,
                  from: opts.reply_to.fromBot
                    ? { is_bot: true, username: "OGStreamzBot" }
                    : { is_bot: false, username: "someone" },
                },
              }
            : {}),
        },
      });
    const groupSent = () => sent.filter((m) => m.chat === GROUP);
    const repliesTo = (m: Sent) =>
      (m.body?.reply_parameters as { message_id?: number } | undefined)?.message_id;
    /** Who a group message tags: [label, Telegram user id] for each mention. */
    const tags = (m: Sent) =>
      ((m.body?.entities ?? []) as { offset: number; length: number; user: { id: number } }[])
        .filter((e) => (e as { type?: string }).type === "text_mention")
        .map((e) => [m.text.slice(e.offset, e.offset + e.length), e.user.id]);

    const addBot = (by: number, how: "added" | "created" = "added") =>
      post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "group" },
          from: { id: by },
          ...(how === "added"
            ? { new_chat_members: [{ is_bot: true, username: "OGStreamzBot" }] }
            : { group_chat_created: true }),
        },
      });
    const left = () => calls.filter((c) => c.method === "leaveChat" && c.body.chat_id === GROUP);
    const battleSystem = (i: number) => ai.battles[i].messages[0].content;
    const battleTurn = (i: number) => ai.battles[i].messages.at(-1)!.content;

    test("only the Boss can add it: anyone else's add makes it leave", async () => {
      // A member with an account, but not the Boss.
      await addBot(CHAT);
      expect(groupSent().at(-1)!.text).toContain("Only the Boss can add OG B0T");
      expect(left()).toHaveLength(1);
      // Someone with no account at all, and a new group created with the bot in it.
      await addBot(FRIEND);
      await addBot(FRIEND, "created");
      expect(left()).toHaveLength(3);
      expect(groupSent().some((m) => m.text.includes("/signal"))).toBe(false);

      // The Boss adding it, either way: it stays and says hello.
      who.roles = ["boss"];
      await addBot(CHAT);
      await addBot(CHAT, "created");
      expect(left()).toHaveLength(3);
      expect(groupSent().filter((m) => m.text.includes("OG B0T's in the chat"))).toHaveLength(2);
    });

    const DAVE = 7007; // another member with an OG B0T account
    const asFriend = (text: string, extra: Record<string, unknown> = {}) =>
      post({
        message: {
          message_id: nextId++,
          text,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: FRIEND, first_name: "Kez" },
          ...extra,
        },
      });
    const asDave = (text: string) =>
      post({
        message: {
          message_id: nextId++,
          text,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: DAVE, first_name: "Dave" },
        },
      });
    const connectUrl = "https://t.me/OGStreamzBot?start=connect";

    test("says hello when added; answers what its members say, not chats between people", async () => {
      who.roles = ["boss"];
      await post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: CHAT },
          new_chat_members: [{ is_bot: true, username: "OGStreamzBot" }],
        },
      });
      expect(groupSent()).toHaveLength(1);
      expect(groupSent()[0].text).toContain("/signal");
      // No bottom bar in groups.
      expect(groupSent()[0].markup).toBeUndefined();

      // Anything a connected member says gets an answer.
      const asked = nextId;
      await inGroup("anyone up for five-a-side tonight?");
      expect(battleTurn(0)).toBe("Imran: anyone up for five-a-side tonight?");
      expect(repliesTo(groupSent().at(-1)!)).toBe(asked);
      // Not: another bot's command, or people replying to each other.
      await inGroup("/start@SomeOtherBot");
      await inGroup("lol", { reply_to: { text: "who's in", fromBot: false } });
      expect(ai.battles).toHaveLength(1);
      // Unless they @ it in the reply.
      await inGroup("@OGStreamzBot settle this", {
        reply_to: { text: "who's in", fromBot: false },
      });
      expect(battleTurn(1)).toBe("Imran: settle this");
      // Stickers, photos and the like are left alone.
      await post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: CHAT, first_name: "Imran" },
          sticker: { file_id: "x" },
        },
      });
      expect(ai.battles).toHaveLength(2);
    });

    test("/og answers in the thread without anything private", async () => {
      const asked = nextId;
      await inGroup("/og@OGStreamzBot what's my coin balance and who wins tonight?");
      const answer = groupSent().at(-1)!;
      expect(answer.text).toMatch(/^@Imran .*OG reply/);
      expect(tags(answer)).toEqual([["@Imran", CHAT]]);
      expect(repliesTo(answer)).toBe(asked);
      // The streamed edits keep the tag too.
      const edits = calls.filter((c) => c.method === "editMessageText" && c.body.chat_id === GROUP);
      for (const e of edits) expect(String(e.body.text)).toMatch(/^@Imran /);
      const prompt = ai.requests[0].messages.map((m) => m.content).join("\n");
      expect(prompt).toContain("GROUP CHAT");
      expect(prompt).not.toContain("PRIVATE-MEMORY");
      expect(prompt).not.toContain("PRIVATE-DOSSIER");
      expect(prompt).not.toContain("PAID-SPORTS-GUIDE");
      expect(prompt).toContain("User is currently on: a Telegram group chat.");
      expect(prompt).toContain("User role: VIP.");
      // Nothing from the group goes into the member's private history or memory.
      expect(loadUserDossier).not.toHaveBeenCalled();
      expect(buildSportsGuideContext).not.toHaveBeenCalled();
      expect(learnFromMessage).not.toHaveBeenCalled();
      expect(inserts.filter((i) => i.table === "og_messages")).toHaveLength(0);
    });

    test("replies and @mentions are a Battle Zone roast battle", async () => {
      const asked = nextId;
      await inGroup("you're mid", { reply_to: { text: "Arsenal by two, easy.", fromBot: true } });
      expect(ai.requests).toHaveLength(0); // not the /og question path
      expect(battleSystem(0)).toContain("FULL FOUL MOUTH MODE");
      expect(battleSystem(0)).toContain("TELEGRAM GROUP");
      // The message they replied to is the context, then their line by name.
      expect(ai.battles[0].messages.at(-2)).toEqual({
        role: "assistant",
        content: "Arsenal by two, easy.",
      });
      expect(battleTurn(0)).toBe("Imran: you're mid");
      const clapback = groupSent().at(-1)!;
      // A reply to their message that starts by tagging them.
      expect(clapback.text).toBe("@Imran BATTLE 1");
      expect(tags(clapback)).toEqual([["@Imran", CHAT]]);
      expect(repliesTo(clapback)).toBe(asked);
      // Plain text: the AI's words never go through HTML parsing.
      expect(clapback.body?.parse_mode).toBeUndefined();
      await inGroup("oi @OGStreamzBot you're a toaster with wifi");
      expect(battleTurn(1)).toBe("Imran: oi you're a toaster with wifi");
    });

    test("when they gang up it takes them all on, with their own lines", async () => {
      linked.add(DAVE);
      await inGroup("you're mid");
      expect(battleSystem(0)).not.toContain("GANGING UP");
      await asDave("your circuits are cheap as chips");
      expect(battleSystem(1)).toContain("GANGING UP on you (Imran, Dave)");
      expect(battleSystem(1)).toContain("- Imran: you're mid");
      // The earlier exchange is in the conversation too.
      expect(ai.battles[1].messages.map((m) => m.content)).toContain("Imran: you're mid");
      expect(ai.battles[1].messages.map((m) => m.content)).toContain("BATTLE 1");
    });

    test("/roast sets it on someone", async () => {
      await inGroup("/roast @dave");
      expect(battleTurn(0)).toBe("Imran: roast @dave");
      await inGroup("/roast");
      expect(battleTurn(1)).toBe("Imran: roast me");
    });

    test("someone it doesn't know is asked to connect, once a day, and otherwise left alone", async () => {
      const said = nextId;
      await asFriend("who's this bot then");
      const nudge = groupSent().at(-1)!;
      expect(nudge.text).toMatch(/^@Kez 👋 I don't know you yet/);
      expect(tags(nudge)).toEqual([["@Kez", FRIEND]]);
      expect(repliesTo(nudge)).toBe(said);
      expect(buttons(nudge)).toEqual([{ text: "🔗 Connect to OG B0T", url: connectUrl }]);
      // Nothing about them is sent to the AI or kept.
      expect(ai.battles).toHaveLength(0);
      expect(stored.telegram_group_lines).toHaveLength(0);

      // Whatever they try next, no more asking (and no answers) today.
      await asFriend("hello??");
      await asFriend("/roast me");
      await asFriend("/og what's the score");
      await asFriend("@OGStreamzBot oi");
      expect(groupSent()).toHaveLength(1);
      expect(ai.battles).toHaveLength(0);
      expect(ai.requests).toHaveLength(0);

      // A day later they're asked again.
      stored.telegram_group_nudges[0].nudged_at = new Date(
        Date.now() - 25 * 3_600_000,
      ).toISOString();
      await asFriend("still here");
      expect(groupSent()).toHaveLength(2);

      // Once they've connected, they get answers like everyone else.
      linked.add(FRIEND);
      await asFriend("right, I'm in");
      expect(battleTurn(0)).toBe("Kez: right, I'm in");
    });

    test("new members are roasted by name; ones it doesn't know get the connect button", async () => {
      const joined = nextId;
      await post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: FRIEND, first_name: "Kez" },
          new_chat_members: [
            { id: FRIEND, is_bot: false, first_name: "Kez", username: "kez_99" },
            { id: 4, is_bot: true, username: "SomeOtherBot" },
          ],
        },
      });
      expect(battleSystem(0)).toContain("FULL FOUL MOUTH MODE");
      expect(battleTurn(0)).toContain("[Kez @kez_99 just joined the group.]");
      expect(battleTurn(0)).not.toContain("SomeOtherBot");
      const roast = groupSent().at(-1)!;
      expect(roast.text).toBe("@kez_99 BATTLE 1");
      expect(tags(roast)).toEqual([["@kez_99", FRIEND]]);
      expect(repliesTo(roast)).toBe(joined);
      expect(buttons(roast)).toEqual([{ text: "🔗 Connect to OG B0T", url: connectUrl }]);
      // That counts as today's ask: their first message isn't nagged again.
      await asFriend("rude");
      expect(groupSent()).toHaveLength(1);

      // A member who's already connected joining: roasted, no button.
      await post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: CHAT, first_name: "Imran" },
          new_chat_members: [{ id: CHAT, is_bot: false, first_name: "Imran" }],
        },
      });
      expect(groupSent().at(-1)!.text).toBe("@Imran BATTLE 2");
      expect(groupSent().at(-1)!.markup).toBeUndefined();
      // Only bots joining: nothing to say.
      await post({
        message: {
          message_id: nextId++,
          chat: { id: GROUP, type: "supergroup" },
          from: { id: 555 },
          new_chat_members: [{ id: 4, is_bot: true, username: "SomeOtherBot" }],
        },
      });
      expect(ai.battles).toHaveLength(2);
    });

    test("no / needed: plain words work like the commands", async () => {
      await inGroup("signal gold");
      expect(signalAsks.at(-1)).toBe("XAUUSD signal 5m");
      await inGroup("Signals btc holding");
      expect(signalAsks.at(-1)).toBe("BTCUSD signal 1h");
      // Asking for one in their own words gets a card too.
      await inGroup("gold scalp?");
      expect(signalAsks).toHaveLength(3);
      expect(ai.battles).toHaveLength(0);

      await inGroup("signal");
      expect(buttons(groupSent().at(-1)!).map((b) => b.callback_data)).toContain("gsig:XAU:5m");
      await inGroup("help");
      expect(groupSent().at(-1)!.text).toContain("OG B0T in the group");
      await inGroup("roast @dave");
      expect(battleTurn(0)).toBe("Imran: roast @dave");
      await inGroup("og who wins tonight");
      expect(ai.requests.at(-1)!.messages.at(-1)!.content).toBe("who wins tonight");
      await inGroup("@OGStreamzBot signal btc");
      expect(signalAsks.at(-1)).toBe("BTCUSD signal 5m");

      // Just chatting, or "help" as part of a sentence: a roast battle.
      await inGroup("help me pick a five-a-side team");
      expect(battleTurn(1)).toBe("Imran: help me pick a five-a-side team");
      await inGroup("the signal on this train is shocking");
      expect(battleTurn(2)).toBe("Imran: the signal on this train is shocking");
      // A command word in a reply to someone else is still their conversation.
      const before = groupSent().length;
      await inGroup("signal gold", { reply_to: { text: "what's gold doing", fromBot: false } });
      expect(groupSent()).toHaveLength(before);
    });

    test("tells the Boss when Group Privacy is stopping it hearing plain messages", async () => {
      const { forgetCached } = await import("@/lib/server-cache");
      who.roles = ["boss"];
      botReadsAll.value = false;
      forgetCached("telegram-bot-info");
      try {
        await addBot(CHAT);
        expect(groupSent().at(-1)!.text).toContain("Group Privacy → Turn off");
        botReadsAll.value = true;
        forgetCached("telegram-bot-info");
        await addBot(CHAT);
        expect(groupSent().at(-1)!.text).not.toContain("Group Privacy");
      } finally {
        botReadsAll.value = true;
        forgetCached("telegram-bot-info");
      }
    });

    test("a burst of messages gets one reply, to the latest, covering all of it", async () => {
      timing.settleMs = 30;
      try {
        // Three quick messages, each landing while the one before is still
        // waiting to see if more are coming.
        const gap = () => new Promise((r) => setTimeout(r, 5));
        const burst = [inGroup("oi")];
        await gap();
        burst.push(inGroup("you there?"));
        await gap();
        burst.push(inGroup("answer me you rusty kettle"));
        await Promise.all(burst);
      } finally {
        timing.settleMs = 0;
      }
      expect(ai.battles).toHaveLength(1);
      expect(battleTurn(0)).toBe(
        "Imran sent 3 messages in a row — answer the lot in one reply:\n" +
          "Imran: oi\nImran: you there?\nImran: answer me you rusty kettle",
      );
      const replies = groupSent();
      expect(replies).toHaveLength(1);
      // It answers the newest of the three.
      const latest = Math.max(
        ...stored.telegram_group_lines
          .filter((l) => l.role === "user")
          .map((l) => Number(l.telegram_message_id)),
      );
      expect(repliesTo(replies[0])).toBe(latest);

      // Their next message is a fresh turn, with the earlier ones as memory.
      await inGroup("well?");
      expect(battleTurn(1)).toBe("Imran: well?");
      expect(battleSystem(1)).toContain("- Imran: oi | you there? | answer me you rusty kettle");
    });

    test("a spammer goes on slow mode: one countdown, then quiet until it's up", async () => {
      for (let i = 1; i <= 5; i++) await inGroup(`spam ${i}`);
      expect(ai.battles).toHaveLength(5);
      // Sixth in a minute: slow mode, with the countdown, tagged and threaded.
      const sixth = nextId;
      await inGroup("spam 6");
      expect(ai.battles).toHaveLength(5);
      const notice = groupSent().at(-1)!;
      expect(notice.text).toMatch(/^@Imran 🐌 .*slow mode: I'll answer you again in (29|30)s\.$/);
      expect(tags(notice)).toEqual([["@Imran", CHAT]]);
      expect(repliesTo(notice)).toBe(sixth);
      // More spam: nothing at all, not even another notice.
      const shown = groupSent().length;
      await inGroup("spam 7");
      await inGroup("spam 8");
      expect(groupSent()).toHaveLength(shown);
      expect(ai.battles).toHaveLength(5);
      // Slow mode is just for them: someone else still gets answers.
      linked.add(7007);
      await post({
        message: {
          message_id: nextId++,
          text: "leave him alone",
          chat: { id: GROUP, type: "supergroup" },
          from: { id: 7007, first_name: "Dave" },
        },
      });
      expect(ai.battles).toHaveLength(6);

      // Once the 30s are up, their next message is answered, with what they
      // said while waiting.
      for (const l of stored.telegram_group_lines)
        if (l.role === "bot" && l.telegram_user_id === CHAT)
          l.created_at = new Date(Date.now() - 31_000).toISOString();
      await inGroup("ok I'll behave");
      expect(ai.battles).toHaveLength(7);
      expect(battleTurn(6)).toContain("Imran: spam 7");
      expect(battleTurn(6)).toContain("Imran: ok I'll behave");
    });

    test("a group gets at most its hourly share of roasts", async () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 120; i++)
        stored.telegram_group_lines.push({
          chat_id: GROUP,
          role: "bot",
          name: "OG B0T",
          content: "x",
          created_at: now,
        });
      await inGroup("come on then");
      expect(ai.battles).toHaveLength(0);
      expect(groupSent()).toHaveLength(0);
      // Another group isn't affected.
      await post({
        message: {
          message_id: nextId++,
          text: "/roast me",
          chat: { id: -100888, type: "group" },
          from: { id: CHAT, first_name: "Imran" },
        },
      });
      expect(ai.battles).toHaveLength(1);
    });

    test("signals: picker buttons, a tap or a typed pair; a snapshot, not followed", async () => {
      await inGroup("/signal");
      const picker = groupSent().at(-1)!;
      const data = buttons(picker).map((b) => b.callback_data);
      // Coins first (scalps), holding underneath.
      expect(buttons(picker).map((b) => b.text)).toEqual([
        "🥇 Gold",
        "₿ BTC",
        "🕐 Gold · Holding",
        "🕐 BTC · Holding",
      ]);
      expect(data).toEqual(["gsig:XAU:5m", "gsig:BTC:5m", "gsig:XAU:1h", "gsig:BTC:1h"]);

      await post({
        callback_query: {
          id: "cb",
          data: "gsig:XAU:5m",
          from: { id: CHAT, first_name: "Imran" },
          message: { message_id: picker.id, chat: { id: GROUP } },
        },
      });
      const card = groupSent().find((m) => m.text.includes("GOLD SCALP card"))!;
      expect(card).toBeTruthy();
      expect(repliesTo(card)).toBe(picker.id);
      // Tagged to whoever tapped.
      expect(tags(card)).toEqual([["@Imran", CHAT]]);

      await inGroup("/signal btc");
      expect(signalAsks.at(-1)).toBe("BTCUSD signal 5m");
      await inGroup("/signal gold holding");
      expect(signalAsks.at(-1)).toBe("XAUUSD signal 1h");
      // Each new signal wipes the last in the group too.
      expect(deleted.has(card.id)).toBe(true);
      expect(groupSent().filter((m) => m.text.includes("card") && !deleted.has(m.id))).toHaveLength(
        1,
      );
      // Group signals aren't followed or saved to anyone's private history.
      expect(recordSignal).not.toHaveBeenCalled();
      expect(inserts.filter((i) => i.table === "og_messages")).toHaveLength(0);
    });

    test("account commands point to the DM; signal taps need a connected account", async () => {
      for (const cmd of ["/balance", "/vault", "/sports arsenal", "/vip@OGStreamzBot"]) {
        await inGroup(cmd);
        const m = groupSent().at(-1)!;
        expect(m.text, cmd).toContain("Ask me in our DM");
        expect(buttons(m)[0].url).toBe("https://t.me/OGStreamzBot");
      }
      await post({
        callback_query: {
          id: "cb",
          data: "gsig:BTC:1h",
          from: { id: FRIEND },
          message: { message_id: 1, chat: { id: GROUP } },
        },
      });
      const alert = calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
      expect(alert.body.show_alert).toBe(true);
      expect(ai.requests).toHaveLength(0);
      expect(groupSent().some((m) => m.text.includes("card"))).toBe(false);
    });
  });

  test("connect from Telegram: a one-time ogbot.co.uk link, in the private chat only", async () => {
    const STRANGER = 31337;
    const dm = (text: string) =>
      post({
        message: {
          message_id: nextId++,
          text,
          chat: { id: STRANGER, type: "private" },
          from: { id: STRANGER, first_name: "Kez", username: "kez_99" },
        },
      });
    await dm("/start connect");
    const link = sent.at(-1)!;
    expect(link.chat).toBe(STRANGER);
    const url = buttons(link)[0].url!;
    expect(url).toMatch(/^https:\/\/ogbot\.co\.uk\/tg-connect#tc_[A-Za-z0-9_-]{43}$/);
    // Saved for that Telegram user, as a hash only.
    expect(stored.telegram_connect_tokens).toHaveLength(1);
    expect(stored.telegram_connect_tokens[0]).toMatchObject({
      telegram_user_id: STRANGER,
      telegram_username: "kez_99",
    });
    expect(JSON.stringify(stored.telegram_connect_tokens)).not.toContain(url.split("#")[1]);

    // A plain /start gets the intro and the link too.
    await dm("/start");
    expect(sent.at(-2)!.text).toContain("OG B0T here");
    expect(buttons(sent.at(-1)!)[0].url).toMatch(/tg-connect#tc_/);
  });

  test("private chat still uses memory and saves history", async () => {
    await type("who am I?");
    const prompt = ai.requests[0].messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("PRIVATE-MEMORY");
    expect(inserts.filter((i) => i.table === "og_messages").length).toBeGreaterThan(0);
    expect(learnFromMessage).toHaveBeenCalled();
  });
});
