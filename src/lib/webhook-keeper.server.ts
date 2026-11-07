/**
 * Keeps every Telegram bot's webhook connected. Every KEEPER_EVERY_MS the
 * minute watcher asks Telegram where each bot sends its messages (OG B0T,
 * the OG Trade Bot, every switched-on worker bot) and puts it right when it
 * isn't ours, is missing an update type the bot needs, or Telegram has had
 * trouble delivering to it lately. Fixes re-register with our secret and
 * never drop waiting messages. The result is kept in site_content
 * "telegram.webhooks" for the Boss's page. Never logs a token or a Telegram
 * URL, and never throws into the watcher.
 */
type Admin = any;

export const WEBHOOKS_KEY = "telegram.webhooks";
export const KEEPER_EVERY_MS = 15 * 60_000;
/** A delivery error newer than this counts as trouble now. */
export const RECENT_ERROR_MS = 20 * 60_000;
/** Messages Telegram is holding that mean it can't get through. */
export const STUCK_PENDING = 25;

const SITE = "https://ogbot.co.uk";
export const MAIN_WEBHOOK = `${SITE}/api/public/telegram/webhook`;
export const TRADE_WEBHOOK = `${SITE}/api/public/trade-bot/webhook`;
export const workerWebhook = (id: string) => `${SITE}/api/public/worker-bots/${id}`;

export const MAIN_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "my_chat_member",
];
export const WORKER_UPDATES = ["message", "my_chat_member"];

/** What Telegram's getWebhookInfo says (the parts we read). */
export type WebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

export type WebhookCheck = {
  bot: string;
  ok: boolean;
  /** Why it was put right, or why it couldn't be read. */
  problem: string | null;
  fixed: boolean;
  pending: number;
  checkedAt: string;
};

/**
 * Whether a webhook needs putting right, and why (null when it's fine). Pure.
 * Telegram leaves allowed_updates out when every type is allowed, which is
 * fine too.
 */
export function webhookProblem(
  info: WebhookInfo | null | undefined,
  expected: { url: string; updates: string[] },
  now = Date.now(),
): string | null {
  if (!info) return "Telegram didn't answer";
  if (!info.url) return "not connected";
  if (info.url !== expected.url) return "pointed somewhere else";
  const allowed = info.allowed_updates;
  if (allowed?.length && expected.updates.some((u) => !allowed.includes(u)))
    return "missing some message types";
  const errAt = (info.last_error_date ?? 0) * 1000;
  const pending = info.pending_update_count ?? 0;
  if (errAt && now - errAt < RECENT_ERROR_MS)
    return `Telegram couldn't deliver lately (${(info.last_error_message ?? "error").slice(0, 80)})`;
  if (pending >= STUCK_PENDING) return `${pending} messages waiting`;
  return null;
}

type Call = (
  method: string,
  body: Record<string, unknown>,
) => Promise<{ ok: boolean; result?: unknown; description?: string } | null>;

async function keepOne(
  bot: string,
  call: Call,
  expected: { url: string; updates: string[]; secret: string },
  now: number,
): Promise<WebhookCheck> {
  const checkedAt = new Date(now).toISOString();
  const info = await call("getWebhookInfo", {}).catch(() => null);
  const problem = info?.ok
    ? webhookProblem(info.result as WebhookInfo, expected, now)
    : "Telegram didn't answer";
  const pending = info?.ok ? ((info.result as WebhookInfo).pending_update_count ?? 0) : 0;
  if (!problem) return { bot, ok: true, problem: null, fixed: false, pending, checkedAt };
  if (!info?.ok) return { bot, ok: false, problem, fixed: false, pending, checkedAt };
  const set = await call("setWebhook", {
    url: expected.url,
    secret_token: expected.secret,
    allowed_updates: expected.updates,
    // Waiting messages are kept: members get their replies once it's back.
    drop_pending_updates: false,
  }).catch(() => null);
  return {
    bot,
    ok: !!set?.ok,
    problem: set?.ok
      ? problem
      : `${problem}; reconnecting failed (${set?.description ?? "no answer"})`,
    fixed: !!set?.ok,
    pending,
    checkedAt,
  };
}

/** Checks (and fixes) every bot's webhook now. Never throws. */
export async function checkWebhooks(admin: Admin, now = Date.now()): Promise<WebhookCheck[]> {
  const out: WebhookCheck[] = [];
  try {
    const { telegramApi } = await import("./telegram-api.server");
    const { telegramWebhookSecrets } = await import("./connectors.server");
    const [secret] = await telegramWebhookSecrets();
    if (secret)
      out.push(
        await keepOne(
          "OG B0T",
          telegramApi,
          { url: MAIN_WEBHOOK, updates: MAIN_UPDATES, secret },
          now,
        ),
      );
  } catch {
    out.push({
      bot: "OG B0T",
      ok: false,
      problem: "couldn't check",
      fixed: false,
      pending: 0,
      checkedAt: new Date(now).toISOString(),
    });
  }
  try {
    const token = process.env.SIGNALS_BOT_TOKEN;
    if (token) {
      const w = await import("./telegram-worker.server");
      out.push(
        await keepOne(
          "OG Trade Bot",
          w.workerApi,
          { url: TRADE_WEBHOOK, updates: WORKER_UPDATES, secret: w.tradeBotSecret(token) },
          now,
        ),
      );
    }
  } catch {
    /* no trade bot: nothing to keep */
  }
  try {
    const key = process.env.TELEGRAM_CREDENTIAL_KEY;
    if (key) {
      const { data } = await admin
        .from("telegram_worker_bots")
        .select("id, name, username, enabled")
        .eq("enabled", true)
        .limit(25);
      const f = await import("./telegram-fleet.server");
      for (const b of (data ?? []) as {
        id: string;
        name?: string | null;
        username?: string | null;
      }[]) {
        const check = await keepOne(
          b.username ? `@${b.username}` : (b.name ?? "Worker bot"),
          (method, body) => f.fleetApi(b.id, method, body, key),
          { url: workerWebhook(b.id), updates: WORKER_UPDATES, secret: f.fleetSecret(b.id, key) },
          now,
        );
        out.push(check);
        if (check.fixed)
          await admin
            .from("telegram_worker_bots")
            .update({ webhook_connected: true })
            .eq("id", b.id);
      }
    }
  } catch {
    /* no fleet table or key: nothing to keep */
  }
  return out;
}

/**
 * The watcher's turn: checks every KEEPER_EVERY_MS and saves the result for
 * the Boss's page. Says what it did. Never throws.
 */
export async function maybeKeepWebhooks(admin: Admin, now = Date.now()): Promise<string> {
  try {
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", WEBHOOKS_KEY)
      .maybeSingle();
    const last = Date.parse(
      (JSON.parse((data as { value?: string } | null)?.value ?? "{}") as { at?: string }).at ?? "",
    );
    if (Number.isFinite(last) && now - last < KEEPER_EVERY_MS) return "not due";
    const checks = await checkWebhooks(admin, now);
    const at = new Date(now).toISOString();
    await admin
      .from("site_content")
      .upsert(
        { key: WEBHOOKS_KEY, value: JSON.stringify({ at, checks }), updated_at: at },
        { onConflict: "key" },
      );
    const fixed = checks.filter((c) => c.fixed).map((c) => c.bot);
    const broken = checks.filter((c) => !c.ok).map((c) => c.bot);
    return [
      `${checks.length} checked`,
      fixed.length ? `reconnected ${fixed.join(", ")}` : "",
      broken.length ? `still down: ${broken.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  } catch {
    return "failed";
  }
}

/** The last check, for the Boss's page. */
export function parseWebhookChecks(value: string | null | undefined): {
  at: string | null;
  checks: WebhookCheck[];
} {
  try {
    const v = JSON.parse(value ?? "") as { at?: string; checks?: WebhookCheck[] };
    return { at: v.at ?? null, checks: Array.isArray(v.checks) ? v.checks : [] };
  } catch {
    return { at: null, checks: [] };
  }
}
