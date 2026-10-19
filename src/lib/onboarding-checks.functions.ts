import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: "admin" },
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export type CheckResult = {
  ok: boolean;
  detail: string;
  latencyMs?: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - t0 };
}

function present(name: string): CheckResult | null {
  return process.env[name]
    ? null
    : { ok: false, detail: `${name} is not set — paste it in Project Settings → Secrets.` };
}

async function stripePing(env: "live" | "sandbox"): Promise<CheckResult> {
  const keyName = env === "sandbox" ? "STRIPE_SANDBOX_API_KEY" : "STRIPE_LIVE_API_KEY";
  const miss = present(keyName);
  if (miss) return miss;
  if (!process.env.LOVABLE_API_KEY) return { ok: false, detail: "LOVABLE_API_KEY missing" };
  try {
    const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
    const stripe = createStripeClient(env);
    const { result, latencyMs } = await timed(() => stripe.balance.retrieve());
    const avail = result.available?.[0];
    const detail = avail
      ? `Live API ok · balance ${(avail.amount / 100).toFixed(2)} ${avail.currency.toUpperCase()}`
      : `API ok · livemode=${result.livemode}`;
    return { ok: true, detail, latencyMs };
  } catch (e) {
    const { getStripeErrorMessage } = await import("./stripe.server");
    return { ok: false, detail: `Stripe ${env}: ${getStripeErrorMessage(e)}` };
  }
}

async function gatewayGet(connector: string, path: string): Promise<CheckResult> {
  const lovable = process.env.LOVABLE_API_KEY;
  const connKey = process.env[`${connector.toUpperCase()}_API_KEY`];
  if (!lovable) return { ok: false, detail: "LOVABLE_API_KEY missing" };
  if (!connKey)
    return { ok: false, detail: `${connector.toUpperCase()}_API_KEY missing — relink connector.` };
  const { result, latencyMs } = await timed(() =>
    fetch(`https://connector-gateway.lovable.dev/${connector}${path}`, {
      headers: {
        Authorization: `Bearer ${lovable}`,
        "X-Connection-Api-Key": connKey,
      },
    }),
  );
  const text = await result.text().catch(() => "");
  if (!result.ok) {
    return { ok: false, detail: `HTTP ${result.status}: ${text.slice(0, 160)}`, latencyMs };
  }
  return { ok: true, detail: `OK (${result.status})`, latencyMs };
}

async function runOne(key: string): Promise<CheckResult> {
  switch (key) {
    case "lovable_ai": {
      const miss = present("LOVABLE_API_KEY");
      if (miss) return miss;
      return { ok: true, detail: "Key present — connected services only, not app AI." };
    }
    case "telegram": {
      const miss = present("TELEGRAM_API_KEY");
      if (miss) return miss;
      // getMe via POST
      const lovable = process.env.LOVABLE_API_KEY!;
      const tgKey = process.env.TELEGRAM_API_KEY!;
      const { result, latencyMs } = await timed(() =>
        fetch("https://connector-gateway.lovable.dev/telegram/getMe", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovable}`,
            "X-Connection-Api-Key": tgKey,
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      const body = await result.json().catch(() => ({}));
      if (!result.ok || body?.ok === false) {
        return {
          ok: false,
          detail: `Telegram: ${body?.description ?? `HTTP ${result.status}`}`,
          latencyMs,
        };
      }
      return { ok: true, detail: `Bot @${body?.result?.username ?? "unknown"}`, latencyMs };
    }
    case "google_drive":
      return gatewayGet("google_drive", "/drive/v3/about?fields=user(emailAddress)");
    case "google_sheets": {
      const miss = present("GOOGLE_SHEETS_API_KEY");
      if (miss) return miss;
      return { ok: true, detail: "Connector key present (no cheap ping endpoint)." };
    }
    case "google_search_console":
      return gatewayGet("google_search_console", "/webmasters/v3/sites");
    case "stripe_live":
      return stripePing("live");
    case "stripe_sandbox":
      return stripePing("sandbox");
    case "payments_live_webhook":
      return (
        present("PAYMENTS_LIVE_WEBHOOK_SECRET") ?? {
          ok: true,
          detail: "Live webhook secret present.",
        }
      );
    case "payments_sandbox_webhook":
      return (
        present("PAYMENTS_SANDBOX_WEBHOOK_SECRET") ?? {
          ok: true,
          detail: "Sandbox webhook secret present.",
        }
      );
    case "gemini":
      return present("GEMINI_API_KEY") ?? { ok: true, detail: "Key present." };
    case "openai":
      return present("OPENAI_API_KEY") ?? { ok: true, detail: "Key present." };
    case "suno":
      return present("SUNO_API_KEY") ?? { ok: true, detail: "Key present." };
    case "og_bot_host": {
      const host = process.env.OG_BOT_HOST;
      if (!host) return { ok: false, detail: "OG_BOT_HOST not set." };
      const { result, latencyMs } = await timed(() =>
        fetch(`${host.replace(/\/$/, "")}/api/public/og-bot-widget-embed.js`),
      );
      return result.ok
        ? { ok: true, detail: `Reachable (${result.status})`, latencyMs }
        : { ok: false, detail: `HTTP ${result.status}`, latencyMs };
    }
    case "og_bot_token":
      return present("OG_BOT_TOKEN") ?? { ok: true, detail: "Bot token present." };
    case "og_bot_mothership":
      return present("OG_BOT_MOTHERSHIP_URL") ?? { ok: true, detail: "Mothership URL present." };
    case "og_bot_mint_secret":
      return present("OG_BOT_REMOTE_MINT_SECRET") ?? { ok: true, detail: "Mint secret present." };
    case "telegram_webhook_secret":
      return present("TELEGRAM_WEBHOOK_SECRET") ?? { ok: true, detail: "Webhook secret present." };
    default:
      return { ok: false, detail: `Unknown check: ${key}` };
  }
}

export type SavedCheck = CheckResult & { key: string; checked_at: string };

export const runOnboardingCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string }) => {
    if (!input?.key || typeof input.key !== "string") throw new Error("key required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let result: CheckResult;
    try {
      result = await runOne(data.key);
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : "check failed" };
    }
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        upsert: (
          row: Record<string, unknown>,
          opts?: { onConflict?: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
    await supabase.from("user_onboarding_checks").upsert(
      {
        user_id: context.userId,
        key: data.key,
        ok: result.ok,
        detail: result.detail,
        latency_ms: result.latencyMs ?? null,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    );
    return result;
  });

export const getOnboardingChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            c: string,
            v: string,
          ) => Promise<{
            data: Array<{
              key: string;
              ok: boolean;
              detail: string | null;
              latency_ms: number | null;
              checked_at: string;
            }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const { data, error } = await supabase
      .from("user_onboarding_checks")
      .select("key, ok, detail, latency_ms, checked_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      key: r.key,
      ok: r.ok,
      detail: r.detail ?? "",
      latencyMs: r.latency_ms ?? undefined,
      checked_at: r.checked_at,
    })) satisfies SavedCheck[];
  });
