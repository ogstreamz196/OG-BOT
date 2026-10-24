import { createHash } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Plays a member's taps through the real webhook against a fake Telegram and
// a fake database, and checks the bottom bar is never deleted from under them.

const CHAT = 4242;
type Sent = { id: number; text: string; markup?: Record<string, unknown> };
const sent: Sent[] = [];
const deleted = new Set<number>();
let nextId = 100;

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
      resolve({ data, error: null });
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
  foulAccess: async () => ({ allowed: true, on: true }),
  setFoulMouth: async () => undefined,
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
const showing = (needle: string) =>
  sent.filter((m) => m.text.includes(needle) && !deleted.has(m.id));

describe("telegram bot flow", () => {
  beforeEach(() => {
    sent.length = 0;
    deleted.clear();
    screens.length = 0;
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
    // Followed cards stay; the "hold on" lines are tidied by the next tap.
    expect(showing("GOLD SCALP card").length).toBe(3);
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
});
