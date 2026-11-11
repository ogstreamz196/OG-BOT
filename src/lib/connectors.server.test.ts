import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  connectorFetch,
  connectorMode,
  parseGatewayUrl,
  resetGoogleToken,
  telegramWebhookSecrets,
} from "./connectors.server";

const KEYS = [
  "LOVABLE_API_KEY",
  "TELEGRAM_API_KEY",
  "OG_BOT_TOKEN",
  "GOOGLE_DRIVE_API_KEY",
  "GOOGLE_SHEETS_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "STRIPE_SECRET_KEY",
  "TELEGRAM_WEBHOOK_SECRET",
];
const saved: Record<string, string | undefined> = {};
let calls: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  calls = [];
  resetGoogleToken();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: new Headers(init.headers) });
      if (url.startsWith("https://oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "g-token", expires_in: 3600 }));
      return new Response("{}");
    }),
  );
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("connectorFetch", () => {
  test("no own key: goes through the gateway with Lovable's headers, as before", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.TELEGRAM_API_KEY = "tg-conn";
    await connectorFetch("https://connector-gateway.lovable.dev/telegram/getMe", {
      method: "POST",
    });
    expect(calls[0].url).toBe("https://connector-gateway.lovable.dev/telegram/getMe");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer lov");
    expect(calls[0].headers.get("X-Connection-Api-Key")).toBe("tg-conn");
    expect(connectorMode("telegram")).toBe("gateway");
  });

  test("own bot token: straight to Telegram, no gateway headers", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.TELEGRAM_API_KEY = "tg-conn";
    process.env.OG_BOT_TOKEN = "123:abc";
    await connectorFetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      headers: { "Content-Type": "application/json", "X-Connection-Api-Key": "tg-conn" },
    });
    expect(calls[0].url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(calls[0].headers.get("X-Connection-Api-Key")).toBeNull();
    expect(calls[0].headers.get("Authorization")).toBeNull();
    expect(calls[0].headers.get("Content-Type")).toBe("application/json");
    expect(connectorMode("telegram")).toBe("own");
  });

  test("own Google keys: one token refresh, then Drive and Sheets direct", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "refresh";
    await connectorFetch(
      "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart",
    );
    await connectorFetch(
      "https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/x/values/A1",
    );
    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes("oauth2")).length).toBe(1);
    expect(urls).toContain("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart");
    expect(urls).toContain("https://sheets.googleapis.com/v4/spreadsheets/x/values/A1");
    expect(calls.at(-1)!.headers.get("Authorization")).toBe("Bearer g-token");
  });

  test("own Stripe key replaces the gateway", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    await connectorFetch("https://connector-gateway.lovable.dev/stripe/v1/balance");
    expect(calls[0].url).toBe("https://api.stripe.com/v1/balance");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer sk_test_x");
  });

  test("nothing set: missing", () => {
    expect(connectorMode("google_drive")).toBe("missing");
  });
});

test("parseGatewayUrl", () => {
  expect(
    parseGatewayUrl("https://connector-gateway.lovable.dev/google_drive/drive/v3/about"),
  ).toEqual({ connector: "google_drive", rest: "/drive/v3/about" });
  expect(parseGatewayUrl("https://connector-gateway.lovable.dev/other/x")).toBeNull();
  expect(parseGatewayUrl("https://example.com/telegram/x")).toBeNull();
});

test("webhook secrets: today's one stays valid, and the bot token's works without Lovable", async () => {
  process.env.TELEGRAM_API_KEY = "tg-conn";
  process.env.OG_BOT_TOKEN = "123:abc";
  const both = await telegramWebhookSecrets();
  expect(both).toHaveLength(2);
  delete process.env.TELEGRAM_API_KEY;
  const after = await telegramWebhookSecrets();
  expect(after).toEqual([both[1]]);
  process.env.TELEGRAM_WEBHOOK_SECRET = "explicit";
  expect((await telegramWebhookSecrets())[0]).toBe("explicit");
});
