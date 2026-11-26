import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; body: unknown }[] = [];
const state = {
  keySet: true,
  pending: [] as unknown[],
  fail: new Set<string>(),
  seen: new Set<string>(),
};

vi.mock("./ai-keys.server", () => ({
  hubKeySet: () => state.keySet,
  hub: async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    if (path === "rpc/stripe_events_pending")
      return new Response(JSON.stringify(state.pending), { status: 200 });
    return new Response("", { status: 204 });
  },
}));
vi.mock("./stripe-events.server", () => ({
  log: () => undefined,
  processStripeEvent: async (ev: { id: string }) => {
    if (state.fail.has(ev.id)) throw new Error("boom");
    if (state.seen.has(ev.id)) return "duplicate";
    state.seen.add(ev.id);
    return "done";
  },
}));

const ev = (id: string, livemode = true) => ({
  id,
  type: "checkout.session.completed",
  livemode,
  payload: { id, type: "checkout.session.completed", data: { object: { id: `cs_${id}` } } },
});

beforeEach(() => {
  calls.length = 0;
  state.keySet = true;
  state.pending = [];
  state.fail = new Set();
  state.seen = new Set();
  vi.resetModules();
});

describe("drainHubStripeEvents", () => {
  it("handles each pending event once and marks it handled in the hub", async () => {
    state.pending = [ev("evt_1"), ev("evt_2")];
    state.seen.add("evt_2"); // already handled by the direct webhook
    const { drainHubStripeEvents } = await import("./stripe-hub-events.server");
    expect(await drainHubStripeEvents(1_000_000)).toBe("handled 2");
    const marks = calls.filter((c) => c.path === "rpc/stripe_event_handled").map((c) => c.body);
    expect(marks).toEqual([
      { p_id: "evt_1", p_note: "og-bot: handled" },
      { p_id: "evt_2", p_note: "og-bot: already handled" },
    ]);
  });

  it("leaves a failed event pending for the next pass", async () => {
    state.pending = [ev("evt_bad"), ev("evt_ok")];
    state.fail.add("evt_bad");
    const { drainHubStripeEvents } = await import("./stripe-hub-events.server");
    expect(await drainHubStripeEvents(2_000_000)).toBe("handled 1, failed 1");
    const marked = calls
      .filter((c) => c.path === "rpc/stripe_event_handled")
      .map((c) => (c.body as { p_id: string }).p_id);
    expect(marked).toEqual(["evt_ok"]);
  });

  it("does nothing without the hub key, and waits between passes", async () => {
    state.keySet = false;
    const { drainHubStripeEvents } = await import("./stripe-hub-events.server");
    expect(await drainHubStripeEvents(3_000_000)).toBe("no hub key");
    expect(await drainHubStripeEvents(3_000_100)).toBe("waiting");
  });
});

describe("webhookSecrets", () => {
  it("tries every saved secret for the environment, without repeats", async () => {
    const { webhookSecrets } = await import("./stripe.server");
    expect(
      webhookSecrets("live", {
        PAYMENTS_LIVE_WEBHOOK_SECRET: "whsec_a",
        STRIPE_WEBHOOK_SECRET: "whsec_b",
      }),
    ).toEqual(["whsec_a", "whsec_b"]);
    expect(webhookSecrets("live", { STRIPE_WEBHOOK_SECRET: "whsec_b" })).toEqual(["whsec_b"]);
    expect(
      webhookSecrets("live", { PAYMENTS_LIVE_WEBHOOK_SECRET: "x", STRIPE_WEBHOOK_SECRET: "x" }),
    ).toEqual(["x"]);
    expect(webhookSecrets("sandbox", { PAYMENTS_SANDBOX_WEBHOOK_SECRET: "s" })).toEqual(["s"]);
    expect(webhookSecrets("live", {})).toEqual([]);
  });
});

describe("verifyWebhook accepts any of OG B0T's signing secrets", () => {
  const sign = async (secret: string, t: number, body: string) => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
    return Buffer.from(new Uint8Array(sig)).toString("hex");
  };
  it("a signature made with the second secret passes; a wrong one doesn't", async () => {
    process.env.PAYMENTS_LIVE_WEBHOOK_SECRET = "whsec_managed";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_manual";
    const { verifyWebhook } = await import("./stripe.server");
    const body = JSON.stringify({ id: "evt_x", type: "invoice.paid", data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const ok = new Request("https://x/", {
      method: "POST",
      body,
      headers: { "stripe-signature": `t=${t},v1=${await sign("whsec_manual", t, body)}` },
    });
    expect((await verifyWebhook(ok, "live")).type).toBe("invoice.paid");
    const bad = new Request("https://x/", {
      method: "POST",
      body,
      headers: { "stripe-signature": `t=${t},v1=${await sign("whsec_other", t, body)}` },
    });
    await expect(verifyWebhook(bad, "live")).rejects.toThrow(/Invalid webhook signature/);
    delete process.env.PAYMENTS_LIVE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});
