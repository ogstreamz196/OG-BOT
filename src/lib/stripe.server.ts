import Stripe from "stripe";
import { Buffer } from "node:buffer";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

// BYOK (bring-your-own-key) mode: the project holds its own Stripe secret key
// (STRIPE_SECRET_KEY) and calls api.stripe.com directly. Managed mode routes
// through the Lovable connector gateway using sandbox/live connection keys.
function isByok(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

export function getConnectionApiKey(env: StripeEnv): string {
  if (isByok()) return getEnv("STRIPE_SECRET_KEY");
  return env === "sandbox" ? getEnv("STRIPE_SANDBOX_API_KEY") : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const apiKey = getConnectionApiKey(env);

  // BYOK: call api.stripe.com directly with the project's own secret key.
  if (isByok()) {
    return new Stripe(apiKey, { apiVersion: "2026-08-26.dahlia" });
  }

  // Managed: route through the connector gateway, which attaches the real key.
  const lovableApiKey = getEnv("LOVABLE_API_KEY");
  return new Stripe(apiKey, {
    apiVersion: "2026-08-26.dahlia",
    httpClient: Stripe.createFetchHttpClient(((input: URL | RequestInfo, init?: RequestInit) => {
      const original =
        typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const gatewayUrl = original.replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          "X-Connection-Api-Key": apiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }) as typeof fetch),
  });
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as {
      message?: string;
      type?: string;
      code?: string;
      decline_code?: string;
      param?: string;
      requestId?: string;
      raw?: {
        message?: string;
        type?: string;
        code?: string;
        decline_code?: string;
        param?: string;
        requestId?: string;
      };
    };
    const message = e.raw?.message ?? e.message;
    if (message) {
      const details = [
        e.raw?.type ?? e.type,
        e.raw?.code ?? e.code,
        e.raw?.decline_code ?? e.decline_code,
        e.raw?.param ?? e.param,
        e.raw?.requestId ?? e.requestId,
      ].filter(Boolean);
      return details.length ? `${message} (${details.join(", ")})` : message;
    }
  }
  return "Stripe request failed";
}

/**
 * The webhook signing secrets this app has for an environment, without
 * repeats: the managed one for that environment first, then
 * STRIPE_WEBHOOK_SECRET. Never throws; empty when none is set.
 */
export function webhookSecrets(env: StripeEnv, e: Record<string, string | undefined> = process.env): string[] {
  const names =
    env === "sandbox"
      ? ["PAYMENTS_SANDBOX_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_TEST", "STRIPE_WEBHOOK_SECRET"]
      : ["PAYMENTS_LIVE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"];
  return [...new Set(names.map((n) => e[n]?.trim() ?? "").filter(Boolean))];
}

export async function verifyWebhook(
  req: Request,
  env: StripeEnv,
): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  // Every signing secret this app holds is tried: the managed per-environment
  // one from Lovable's payments integration and a manually saved
  // STRIPE_WEBHOOK_SECRET. Picking just one by whether STRIPE_SECRET_KEY was
  // set meant a key added later (or a missing webhook secret) made every live
  // event fail its check (the Boss, 2026-11-26: Stripe's "webhook failing"
  // email, failures since 22 November). A match on any of ours is genuine.
  const secrets = webhookSecrets(env);
  if (!secrets.length) throw new Error("No webhook signing secret configured");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  let matched = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`),
    );
    const expected = Buffer.from(new Uint8Array(signed)).toString("hex");
    if (v1Signatures.includes(expected)) {
      matched = true;
      break;
    }
  }
  if (!matched) throw new Error("Invalid webhook signature");

  return JSON.parse(body);
}
