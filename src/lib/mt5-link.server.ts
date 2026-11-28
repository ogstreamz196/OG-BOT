// Connecting the Boss's real or demo MT5 account online, through MetaApi (no PC, no USB).
// The Boss types the login, server and password once, in the secure form under Signals (or the
// Copy Trader B0T's link). The password goes straight to MetaApi to create the cloud account and is
// never stored, logged or sent anywhere else. The site keeps only the MetaApi account id and the
// login, server and mode, in site_content "mt5.account". Server only. Never throws to the caller.

import { hubFunction, hubMetaApiSet } from "./ai-keys.server";

type Admin = any;

export const LINK_KEY = "mt5.account";
const PROVISIONING = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const CACHE_MS = 60_000;

export type LinkedAccount = {
  id: string;
  mode: "demo" | "live";
  login: string;
  server: string;
  name: string;
  linkedAt: string;
};

let cache: { at: number; acc: LinkedAccount | null } | null = null;

/** The account the bot trades on: the one connected here, else the one set in the environment. */
export function linkedAccountId(): string | null {
  return cache?.acc?.id ?? (process.env["METAAPI_ACCOUNT_ID"] || null);
}

/** Reads the connected account (cached a minute). Null when none is connected. Never throws. */
export async function loadLinkedAccount(admin: Admin): Promise<LinkedAccount | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.acc;
  try {
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", LINK_KEY)
      .maybeSingle();
    const acc = parseLink((data as { value?: string } | null)?.value);
    cache = { at: Date.now(), acc };
    return acc;
  } catch {
    return cache?.acc ?? null;
  }
}

/** Checks one saved link (safe to store and read back). Pure. */
export function parseLink(raw: string | null | undefined): LinkedAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<LinkedAccount>;
    if (typeof j.id !== "string" || !j.id) return null;
    return {
      id: j.id,
      mode: j.mode === "live" ? "live" : "demo",
      login: String(j.login ?? ""),
      server: String(j.server ?? ""),
      name: String(j.name ?? ""),
      linkedAt: String(j.linkedAt ?? ""),
    };
  } catch {
    return null;
  }
}

export type ConnectInput = {
  mode: "demo" | "live";
  login: string;
  server: string;
  password: string;
  /** Required for live: the Boss types LIVE. */
  confirm?: string;
};

/** Validates the form. Returns an error message, or null when it's fine. Pure. */
export function checkConnectInput(i: ConnectInput): string | null {
  if (!/^\d{3,12}$/.test(i.login.trim())) return "The login is the account number (digits only).";
  if (!/^[A-Za-z0-9 ._-]{3,80}$/.test(i.server.trim()))
    return "The server is the name from your broker's login screen, for example Vantage-Demo.";
  if (i.password.length < 1 || i.password.length > 200) return "Enter the account password.";
  if (i.mode === "live" && (i.confirm ?? "").trim() !== "LIVE")
    return "To connect a live account, type LIVE in the box.";
  return null;
}

/**
 * Creates the MetaApi cloud account from the form, deploys it and makes it the bot's account.
 * Returns the saved link (no password) or an error message. Never throws.
 */
export async function connectAccount(
  admin: Admin,
  input: ConnectInput,
): Promise<{ ok: true; account: LinkedAccount } | { ok: false; error: string }> {
  const problem = checkConnectInput(input);
  if (problem) return { ok: false, error: problem };
  const token = process.env["METAAPI_TOKEN"];
  if (!token && hubMetaApiSet()) {
    return {
      ok: false,
      error: "New accounts can't be added from this page yet. The bot's MetaApi account is already set up in the hub.",
    };
  }
  if (!token) return { ok: false, error: "MetaApi isn't set up yet (the MetaApi token is missing)." };
  const login = input.login.trim();
  const server = input.server.trim();
  const name = `OG B0T ${input.mode === "live" ? "live" : "demo"} ${login}`;
  try {
    const res = await fetch(`${PROVISIONING}/users/current/accounts`, {
      method: "POST",
      headers: { "auth-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        login,
        password: input.password,
        name,
        server,
        platform: "mt5",
        magic: 0,
        type: "cloud-g2",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok || !data?.id) {
      console.warn(`[mt5-account] connect refused: HTTP ${res.status}`);
      return {
        ok: false,
        error: `MetaApi wouldn't connect that account (${res.status}). Check the login, server and password, then try again.`,
      };
    }
    // Start the account running on MetaApi's servers (no PC needed).
    await fetch(`${PROVISIONING}/users/current/accounts/${encodeURIComponent(data.id)}/deploy`, {
      method: "POST",
      headers: { "auth-token": token },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    const account: LinkedAccount = {
      id: data.id,
      mode: input.mode,
      login,
      server,
      name,
      linkedAt: new Date().toISOString(),
    };
    const { error } = await admin
      .from("site_content")
      .upsert(
        { key: LINK_KEY, value: JSON.stringify(account), updated_at: account.linkedAt },
        { onConflict: "key" },
      );
    if (error) return { ok: false, error: "Connected to MetaApi, but the site couldn't save the link. Try again." };
    cache = { at: Date.now(), acc: account };
    return { ok: true, account };
  } catch {
    return { ok: false, error: "MetaApi couldn't be reached just now. Try again in a minute." };
  }
}

/** The fields MetaApi's account-information returns that the link needs. */
export type HubAccountInfo = { login?: unknown; server?: unknown; type?: unknown };

/**
 * The account the hub holds, described the way the site stores a link. MetaApi reports a demo
 * account with a DEMO trade mode, so anything else counts as live. Pure.
 */
export function linkFromHubInfo(info: HubAccountInfo, linkedAt = ""): LinkedAccount {
  const login = String(info.login ?? "");
  const server = String(info.server ?? "");
  const mode: "demo" | "live" = /DEMO/i.test(String(info.type ?? "")) ? "demo" : "live";
  return { id: "hub", mode, login, server, name: "OG B0T (hub)", linkedAt };
}

/** The connected account's state on MetaApi (deploying, connected…). Never throws. */
export async function linkState(
  admin: Admin,
): Promise<{ account: LinkedAccount; state: string; connection: string } | null> {
  const account = await loadLinkedAccount(admin);
  const token = process.env["METAAPI_TOKEN"];
  if (!token) {
    // No token here: MetaApi is reached through the hub, which holds the one account the bot uses.
    if (!hubMetaApiSet()) return account ? { account, state: "no token", connection: "unknown" } : null;
    const r = await hubFunction<HubAccountInfo>("ogstreamz-metaapi", { method: "GET", path: "/account-information" }, 10_000);
    const info = r && r.status >= 200 && r.status < 300 && r.data ? r.data : null;
    if (!info) return account ? { account, state: "unknown", connection: "unknown" } : null;
    // MetaApi answers from its last known data even when the broker link is down, so an answer is
    // not proof of a connection. Only MetaApi's own page shows that, so the site doesn't claim it.
    return {
      account: account ?? linkFromHubInfo(info),
      state: "answering",
      connection: "not confirmed (check MetaApi)",
    };
  }
  if (!account) return null;
  try {
    const res = await fetch(`${PROVISIONING}/users/current/accounts/${encodeURIComponent(account.id)}`, {
      headers: { "auth-token": token },
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => null)) as { state?: string; connectionStatus?: string } | null;
    return { account, state: j?.state ?? "unknown", connection: j?.connectionStatus ?? "unknown" };
  } catch {
    return { account, state: "unknown", connection: "unknown" };
  }
}

/** Unlinks the account from the bot. The MetaApi account itself is kept (re-link later). Never throws. */
export async function disconnectAccount(admin: Admin): Promise<boolean> {
  try {
    const { error } = await admin.from("site_content").delete().eq("key", LINK_KEY);
    cache = { at: Date.now(), acc: null };
    return !error;
  } catch {
    return false;
  }
}
