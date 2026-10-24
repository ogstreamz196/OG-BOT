import { createHash } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Plays a member's taps through the real webhook against a fake Telegram and
// a fake database, and checks the bottom bar is never deleted from under them.

const CHAT = 4242;
type Sent = { id: number; text: string; markup?: Record<string, unknown> };
const sent: Sent[] = [];
const deleted = new Set<number>();
const edits: { id: number; markup: Record<string, unknown> }[] = [];
let nextId = 100;
// Who the linked member is, and their foul mouth state.
const who = { roles: [] as string[], foulAllowed: true, foulOn: true };

vi.mock("@/lib/telegram-api.server", () => ({
  escapeTelegramHtml: (s: string) => s,
  telegramApi: async (method: string, body: Record<string, unknown>) => {
    if (method === "sendMessage") {
      const id = nextId++;
      sent.push({
        id,
        text: String(body.text),
        markup: body.reply_markup as Record<string, unknown>,
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
function query(table: string) {
  const filters: [string, (v: unknown) => boolean][] = [];
  let op: "select" | "delete" | "write" = "select";
  let single = false;
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    gt: () => q,
    gte: () => q,
    not: () => q,
    or: () => q,
    eq: (col: string, v: unknown) => (filters.push([col, (x) => x === v]), q),
    in: (col: string, vs: unknown[]) => (filters.push([col, (x) => vs.includes(x)]), q),
    maybeSingle: () => ((single = true), q),
    delete: () => ((op = "delete"), q),
    update: () => ((op = "write"), q),
    insert: () => ((op = "write"), q),
    upsert: (row: Row) => {
      op = "write";
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
      if (table === "telegram_screen_messages") {
        if (op === "delete") {
          for (let i = screens.length - 1; i >= 0; i--) if (match(screens[i])) screens.splice(i, 1);
        } else data = screens.filter(match);
      }
      if (table === "profiles" && op === "select") data = single ? { id: "u1" } : [{ id: "u1" }];
      if (table === "user_roles") data = who.roles.map((role) => ({ role }));
      resolve({ data, error: null, count: 0 });
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
vi.mock("@/lib/trade-signal-context.server", () => ({
  buildTradeSignal: async () => ({ reply: "📈 GOLD SCALP card", plan: {}, expiresAt: null }),
}));
vi.mock("@/lib/trade-signal-tracker.server", () => ({ recordSignal: async () => undefined }));

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
    expect(barButtons()).toContain("🥇 Gold · Scalp");

    // Run signals back to back: the signal buttons are never deleted.
    await type("🥇 Gold · Scalp");
    await type("₿ BTC · Holding");
    await type("🥇 Gold · Scalp");
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
    await type("🥇 Gold · Scalp");
    const first = sent.filter((m) => m.text.includes("GOLD SCALP card")).at(-1)!;
    // The watcher posts an update under the card (it marks it as part of the signal).
    const update = { id: nextId++, text: "📊 Gold BUY · TP1 hit" };
    sent.push(update);
    screens.push({ chat_id: CHAT, message_id: update.id, kind: "signal" });
    // A question typed in between stays.
    const question = nextId;
    await type("what's the gold price doing?");

    await type("₿ BTC · Holding");
    expect(deleted.has(first.id)).toBe(true);
    expect(deleted.has(update.id)).toBe(true);
    expect(deleted.has(question)).toBe(false);
    expect(showing("GOLD SCALP card")).toHaveLength(1);
    // The signal buttons are still there.
    expect(barButtons()).toContain("🥇 Gold · Scalp");
    expect(liveBars()).toHaveLength(1);
  });
});
