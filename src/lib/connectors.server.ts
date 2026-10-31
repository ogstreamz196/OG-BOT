/**
 * Telegram, Google Drive, Google Sheets and Stripe calls, with or without
 * Lovable's connector gateway (step 1 of moving off Lovable, see
 * docs/lovable-exit-plan.md).
 *
 * Callers keep building the gateway URL they always have
 * (https://connector-gateway.lovable.dev/<connector>/...) and send it through
 * connectorFetch. When that connector's own key is set, the call goes
 * straight to the real API with it; otherwise it goes through the gateway
 * exactly as before. Removing the own key switches back, so it's reversible.
 *
 *   telegram       OG_BOT_TOKEN                      → api.telegram.org
 *   google_drive   GOOGLE_OAUTH_CLIENT_ID,           → www.googleapis.com
 *   google_sheets  GOOGLE_OAUTH_CLIENT_SECRET,       → sheets.googleapis.com
 *                  GOOGLE_OAUTH_REFRESH_TOKEN (the Boss's Google account)
 *   stripe         STRIPE_SECRET_KEY                 → api.stripe.com
 *
 * Never log a URL from here: a direct Telegram URL carries the bot token.
 */

export const GATEWAY = "https://connector-gateway.lovable.dev";

export type Connector = "telegram" | "google_drive" | "google_sheets" | "stripe";

/** The gateway's own key for each connector (Lovable's connection key). */
const GATEWAY_KEY: Record<Connector, string> = {
  telegram: "TELEGRAM_API_KEY",
  google_drive: "GOOGLE_DRIVE_API_KEY",
  google_sheets: "GOOGLE_SHEETS_API_KEY",
  stripe: "STRIPE_LIVE_API_KEY",
};

const env = (k: string) => process.env[k] || undefined;

const googleOwn = () =>
  !!(
    env("GOOGLE_OAUTH_CLIENT_ID") &&
    env("GOOGLE_OAUTH_CLIENT_SECRET") &&
    env("GOOGLE_OAUTH_REFRESH_TOKEN")
  );

/** Whether this connector uses its own key (true) or the gateway (false). */
export function usesOwnKey(c: Connector): boolean {
  if (c === "telegram") return !!env("OG_BOT_TOKEN");
  if (c === "stripe") return !!env("STRIPE_SECRET_KEY");
  return googleOwn();
}

/** How a connector is reached right now: its own key, the gateway, or not at all. */
export function connectorMode(
  c: Connector,
  gatewayKey = GATEWAY_KEY[c],
): "own" | "gateway" | "missing" {
  if (usesOwnKey(c)) return "own";
  return env("LOVABLE_API_KEY") && env(gatewayKey) ? "gateway" : "missing";
}

export const connectorReady = (c: Connector, gatewayKey?: string) =>
  connectorMode(c, gatewayKey) !== "missing";

/** Which connector a gateway URL is for, and the rest of its path. */
export function parseGatewayUrl(url: string): { connector: Connector; rest: string } | null {
  if (!url.startsWith(`${GATEWAY}/`)) return null;
  const tail = url.slice(GATEWAY.length + 1);
  const slash = tail.search(/[/?]/);
  const name = slash < 0 ? tail : tail.slice(0, slash);
  const rest = slash < 0 ? "" : tail.slice(slash);
  if (name in GATEWAY_KEY) return { connector: name as Connector, rest };
  return null;
}

/** The real API URL behind a gateway URL. */
export function directUrl(connector: Connector, rest: string): string {
  switch (connector) {
    case "telegram":
      return `https://api.telegram.org/bot${env("OG_BOT_TOKEN")}${rest}`;
    case "google_drive":
      return `https://www.googleapis.com${rest}`;
    case "google_sheets":
      return `https://sheets.googleapis.com${rest}`;
    case "stripe":
      return `https://api.stripe.com${rest}`;
  }
}

// One access token for the Boss's Google account, reused until just before
// it expires (Google gives an hour).
let googleToken: { value: string; until: number } | null = null;

/** Exchanges the refresh token for an access token. Null when Google says no. */
export async function googleAccessToken(): Promise<string | null> {
  if (googleToken && googleToken.until > Date.now()) return googleToken.value;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_OAUTH_CLIENT_ID") ?? "",
        client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
        refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN") ?? "",
        grant_type: "refresh_token",
      }),
    });
    const j = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    } | null;
    if (!res.ok || !j?.access_token) {
      console.error(`[connectors] Google token refresh failed: ${j?.error ?? res.status}`);
      return null;
    }
    googleToken = {
      value: j.access_token,
      until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000,
    };
    return googleToken.value;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached Google token. */
export function resetGoogleToken() {
  googleToken = null;
}

const without = (h: Headers, ...names: string[]) => {
  for (const n of names) h.delete(n);
  return h;
};

/**
 * fetch() for a connector-gateway URL. With the connector's own key it calls
 * the real API; otherwise the gateway, adding Lovable's headers (any the
 * caller already set are kept). `gatewayKey` overrides the connection key's
 * env name (Stripe sandbox, say). Non-gateway URLs are fetched as they are.
 */
export async function connectorFetch(
  url: string,
  init: RequestInit = {},
  gatewayKey?: string,
): Promise<Response> {
  const parsed = parseGatewayUrl(url);
  if (!parsed) return fetch(url, init);
  const { connector, rest } = parsed;
  const headers = new Headers(init.headers);

  if (usesOwnKey(connector)) {
    without(headers, "Authorization", "X-Connection-Api-Key", "Lovable-API-Key");
    if (connector === "stripe") headers.set("Authorization", `Bearer ${env("STRIPE_SECRET_KEY")}`);
    if (connector === "google_drive" || connector === "google_sheets") {
      const token = await googleAccessToken();
      if (!token) {
        return new Response(JSON.stringify({ error: "Google sign-in for Drive/Sheets failed" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(directUrl(connector, rest), { ...init, headers });
  }

  const lovable = env("LOVABLE_API_KEY");
  const conn = env(gatewayKey ?? GATEWAY_KEY[connector]);
  if (lovable && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${lovable}`);
  if (conn && !headers.has("X-Connection-Api-Key")) headers.set("X-Connection-Api-Key", conn);
  return fetch(url, { ...init, headers });
}

/**
 * Secrets Telegram may send in X-Telegram-Bot-Api-Secret-Token, preferred
 * first (setWebhook registers that one). TELEGRAM_WEBHOOK_SECRET when set,
 * then the one derived from Lovable's TELEGRAM_API_KEY (what's registered
 * today), then one derived from OG_BOT_TOKEN, so the webhook keeps working
 * once Lovable's key is gone. Every one of them is accepted, so switching
 * never drops messages.
 */
export async function telegramWebhookSecrets(): Promise<string[]> {
  const { createHash } = await import("node:crypto");
  const derive = (key: string) =>
    createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
  const out: string[] = [];
  const explicit = env("TELEGRAM_WEBHOOK_SECRET");
  if (explicit) out.push(explicit);
  const tgKey = env("TELEGRAM_API_KEY");
  if (tgKey) out.push(derive(tgKey));
  const token = env("OG_BOT_TOKEN");
  if (token) out.push(derive(token));
  return out;
}
