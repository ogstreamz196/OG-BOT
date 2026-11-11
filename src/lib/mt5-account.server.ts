// The Boss's own Vantage MT5 account (the Boss, 2026-11-11: "remove the bot's
// test account and attach my mt5, copy same lot size"). The Python copier
// (tools/mt5-copier) reports the account every 30 seconds to
// /api/public/copy-report; the bot then sizes lots from this balance instead
// of the test account's, and the results post shows it. A report older than
// FRESH_MS counts as offline. The test account's stored data is kept (never
// deleted); it just isn't shown.

type Admin = any;

export const MT5_ACCOUNT_KEY = "copy.account";
export const COPY_TOKEN_KEY = "copy.feedToken";
/** A report this old or older means the copier (or the PC) is off. */
export const FRESH_MS = 10 * 60_000;

export type Mt5Account = {
  balance: number;
  equity: number;
  currency: string;
  /** e.g. "VantageMarkets-Demo". */
  server: string;
  /** The highest balance reported on this server, for the drawdown the lot sizing reads. */
  peak: number;
  /** When it was reported (ms). */
  at: number;
};

/** A stored account, or null when missing or broken. Pure. */
export function parseAccount(value: string | null | undefined): Mt5Account | null {
  if (!value) return null;
  try {
    const a = JSON.parse(value);
    const balance = Number(a.balance);
    const at = Number(a.at);
    if (!Number.isFinite(balance) || !Number.isFinite(at)) return null;
    return {
      balance,
      equity: Number.isFinite(Number(a.equity)) ? Number(a.equity) : balance,
      currency: String(a.currency ?? "USD").slice(0, 8),
      server: String(a.server ?? "").slice(0, 64),
      peak: Math.max(balance, Number(a.peak) || 0),
      at,
    };
  } catch {
    return null;
  }
}

/** A new report on top of the last one: the peak only ever rises (per server). Pure. */
export function mergeReport(
  prev: Mt5Account | null,
  report: { balance?: unknown; equity?: unknown; currency?: unknown; server?: unknown },
  now: number,
): Mt5Account | null {
  if (report.balance == null || report.balance === "") return null;
  const balance = Number(report.balance);
  if (!Number.isFinite(balance) || balance < 0 || balance > 1e9) return null;
  const equity = Number(report.equity);
  const server = String(report.server ?? "").slice(0, 64);
  // A different account (say demo → real) starts its own peak.
  const samePlace = !!prev && prev.server === server;
  return {
    balance,
    equity: report.equity != null && Number.isFinite(equity) ? equity : balance,
    currency: String(report.currency ?? "USD").slice(0, 8),
    server,
    peak: Math.max(balance, samePlace ? prev!.peak : 0),
    at: now,
  };
}

/** How far the balance is below its peak, in percent. Pure. */
export function drawdownPct(a: Mt5Account): number {
  return a.peak > 0 ? Math.max(0, ((a.peak - a.balance) / a.peak) * 100) : 0;
}

/** Whether a report is recent enough to trust. Pure. */
export function isFresh(a: Mt5Account | null, now: number): a is Mt5Account {
  return !!a && now - a.at < FRESH_MS && a.at <= now + 60_000;
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** The Boss's MT5 account when the copier reported it recently, else null. Never throws. */
export async function mt5Account(admin: Admin, now = Date.now()): Promise<Mt5Account | null> {
  try {
    const a = parseAccount(await setting(admin, MT5_ACCOUNT_KEY));
    return isFresh(a, now) ? a : null;
  } catch {
    return null;
  }
}

/** Saves a copier report. Returns the saved account, or null when it was rejected. */
export async function saveReport(
  admin: Admin,
  report: Record<string, unknown>,
  now = Date.now(),
): Promise<Mt5Account | null> {
  const prev = parseAccount(await setting(admin, MT5_ACCOUNT_KEY));
  const next = mergeReport(prev, report, now);
  if (!next) return null;
  const { error } = await admin.from("site_content").upsert(
    {
      key: MT5_ACCOUNT_KEY,
      value: JSON.stringify(next),
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: "key" },
  );
  return error ? null : next;
}

/** Whether a request carries the copier's token (header x-copy-token). */
export async function copyTokenOk(admin: Admin, request: Request): Promise<boolean> {
  const { createHash, timingSafeEqual } = await import("crypto");
  const given = request.headers.get("x-copy-token") ?? "";
  const want = String((await setting(admin, COPY_TOKEN_KEY)) ?? "");
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return want.length >= 24 && !!given && timingSafeEqual(hash(given), hash(want));
}

/** The results post's balance line for the MT5 account. Pure. */
export function mt5BalanceLine(a: Mt5Account): string {
  const money = `$${a.balance
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\.00$/, "")}`;
  return `💰 Balance: ${money} · Vantage MT5${/demo/i.test(a.server) ? " (demo)" : ""}`;
}
