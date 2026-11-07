import { describe, expect, it, vi } from "vitest";
import {
  MAIN_UPDATES,
  MAIN_WEBHOOK,
  RECENT_ERROR_MS,
  STUCK_PENDING,
  webhookProblem,
} from "./webhook-keeper.server";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const want = { url: MAIN_WEBHOOK, updates: MAIN_UPDATES };

describe("webhook keeper: when a bot needs reconnecting", () => {
  it("fine: ours, every update type, no recent trouble", () => {
    expect(
      webhookProblem({ url: MAIN_WEBHOOK, allowed_updates: MAIN_UPDATES }, want, NOW),
    ).toBeNull();
    // Telegram leaves allowed_updates out when everything's allowed.
    expect(webhookProblem({ url: MAIN_WEBHOOK }, want, NOW)).toBeNull();
    // An old error that has since cleared is fine.
    const old = (NOW - RECENT_ERROR_MS - 60_000) / 1000;
    expect(webhookProblem({ url: MAIN_WEBHOOK, last_error_date: old }, want, NOW)).toBeNull();
  });

  it("reconnects when missing, pointed elsewhere, short of update types, failing or stuck", () => {
    expect(webhookProblem({ url: "" }, want, NOW)).toBe("not connected");
    expect(webhookProblem({ url: "https://old.example/hook" }, want, NOW)).toBe(
      "pointed somewhere else",
    );
    expect(webhookProblem({ url: MAIN_WEBHOOK, allowed_updates: ["message"] }, want, NOW)).toBe(
      "missing some message types",
    );
    expect(
      webhookProblem(
        {
          url: MAIN_WEBHOOK,
          last_error_date: (NOW - 60_000) / 1000,
          last_error_message: "Wrong response from the webhook: 401 Unauthorized",
        },
        want,
        NOW,
      ),
    ).toMatch(/^Telegram couldn't deliver lately \(Wrong response/);
    expect(
      webhookProblem({ url: MAIN_WEBHOOK, pending_update_count: STUCK_PENDING }, want, NOW),
    ).toBe(`${STUCK_PENDING} messages waiting`);
    expect(webhookProblem(null, want, NOW)).toBe("Telegram didn't answer");
  });

  it("reconnects with our secret, keeps waiting messages, and records it", async () => {
    vi.resetModules();
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.doMock("./telegram-api.server", () => ({
      telegramApi: async (method: string, body: Record<string, unknown>) => {
        calls.push({ method, body });
        return method === "getWebhookInfo"
          ? { ok: true, result: { url: "", pending_update_count: 3 } }
          : { ok: true, result: true };
      },
    }));
    vi.doMock("./connectors.server", () => ({ telegramWebhookSecrets: async () => ["s3cret"] }));
    const saved: Record<string, string> = {};
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        upsert: async (row: { key: string; value: string }) => void (saved[row.key] = row.value),
      }),
    };
    const k = await import("./webhook-keeper.server");
    const out = await k.maybeKeepWebhooks(admin, NOW);
    expect(out).toBe("1 checked; reconnected OG B0T");
    const set = calls.find((c) => c.method === "setWebhook")!;
    expect(set.body).toMatchObject({
      url: MAIN_WEBHOOK,
      secret_token: "s3cret",
      allowed_updates: MAIN_UPDATES,
      drop_pending_updates: false,
    });
    const last = k.parseWebhookChecks(saved[k.WEBHOOKS_KEY]);
    expect(last.checks[0]).toMatchObject({
      bot: "OG B0T",
      ok: true,
      fixed: true,
      problem: "not connected",
      pending: 3,
    });
    vi.doUnmock("./telegram-api.server");
    vi.doUnmock("./connectors.server");
  });
});
