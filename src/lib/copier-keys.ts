// Per-user copier keys (the Boss, 2026-11-13: give the copier to several
// people, each with their own key and an expiry he manages remotely). Each key
// is one site_content row, "copy.key.<sha256 of the token>" (service-only, no
// migration), so the token itself is never stored. A key binds, on first use,
// to one USB stick and one MT5 account; only the Boss can reset that. One
// copy runs at a time. Expired or revoked keys still get the feed, paused, so
// the copier closes what it has open but opens nothing new. Everything here
// is pure; the database side is copier-keys.server.ts.

export const KEY_ROW_PREFIX = "copy.key.";
/** A user's token starts with this (the Boss's own token doesn't). */
export const USER_TOKEN_PREFIX = "ogk_";
/** Another copy seen this recently means the key is already running elsewhere. */
export const RUNNING_WINDOW_MS = 45_000;
/** The row is rewritten at most this often just to note "still running". */
export const SEEN_EVERY_MS = 30_000;
export const MAX_KEY_DAYS = 3650;

export type CopierKey = {
  /** The first 10 characters of the token's hash: safe to show and put on buttons. */
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
  /** The USB stick it's locked to (set on first use). */
  stick?: string;
  /** The MT5 account number it's locked to (set on first use). */
  account?: string;
  /** The copy running now: a random id per start of the copier, and when it last checked in. */
  instance?: string;
  lastSeen?: string;
  /** The account's balance as last reported. */
  balance?: number;
};

export const keyRow = (hash: string) => `${KEY_ROW_PREFIX}${hash}`;
export const keyId = (hash: string) => hash.slice(0, 10);

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, max);

/** A stored key from its row value, or null when it isn't one. Pure. */
export function parseKey(value: string | null | undefined): CopierKey | null {
  if (!value) return null;
  try {
    const t = JSON.parse(value) as Record<string, unknown>;
    const id = clean(t.id, 10);
    const expiresAt = String(t.expiresAt ?? "");
    if (!/^[0-9a-f]{10}$/.test(id) || !Number.isFinite(Date.parse(expiresAt))) return null;
    const balance = Number(t.balance);
    return {
      id,
      name: clean(t.name, 40) || "User",
      createdAt: String(t.createdAt ?? expiresAt),
      expiresAt,
      ...(t.revoked === true ? { revoked: true } : {}),
      ...(clean(t.stick, 80) ? { stick: clean(t.stick, 80) } : {}),
      ...(clean(t.account, 20) ? { account: clean(t.account, 20) } : {}),
      ...(clean(t.instance, 40) ? { instance: clean(t.instance, 40) } : {}),
      ...(Number.isFinite(Date.parse(String(t.lastSeen ?? "")))
        ? { lastSeen: String(t.lastSeen) }
        : {}),
      ...(t.balance != null && Number.isFinite(balance) ? { balance } : {}),
    };
  } catch {
    return null;
  }
}

/** A new key for a user, valid `days` from now. Pure. */
export function newKey(hash: string, name: string, days: number, now: number): CopierKey {
  const d = Math.min(MAX_KEY_DAYS, Math.max(1, Math.round(days)));
  return {
    id: keyId(hash),
    name: clean(name, 40) || "User",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + d * 86_400_000).toISOString(),
  };
}

/** Whole days left (0 once expired). Pure. */
export function daysLeft(k: CopierKey, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(k.expiresAt) - now) / 86_400_000));
}
export const isExpired = (k: CopierKey, now: number) => Date.parse(k.expiresAt) <= now;
/** A copy of it checked in within the running window. Pure. */
export const isRunning = (k: CopierKey, now: number) =>
  !!k.lastSeen && now - Date.parse(k.lastSeen) < RUNNING_WINDOW_MS;

/** What the copier says about itself on each check (headers). */
export type CopierHello = {
  stick: string;
  account: string;
  instance: string;
  balance?: number | null;
};

/** The copier's headers, cleaned. Pure. */
export function helloFrom(h: { get(name: string): string | null }): CopierHello {
  const b = Number(h.get("x-copy-balance"));
  return {
    stick: clean(h.get("x-copy-stick"), 80),
    account: clean(h.get("x-copy-account"), 20).replace(/[^0-9]/g, ""),
    instance: clean(h.get("x-copy-instance"), 40),
    balance: h.get("x-copy-balance") != null && Number.isFinite(b) && b >= 0 ? b : null,
  };
}

/**
 * refused: nothing is served (the wrong stick or account, a second copy, or a
 * copier too old to say which stick it's on). limited: the feed is served
 * paused, so open trades are still closed but nothing new opens.
 */
export type Access =
  | { status: "ok"; key: CopierKey; save: boolean }
  | { status: "limited"; reason: "expired" | "revoked"; key: CopierKey; save: boolean }
  | {
      status: "refused";
      reason: "update_needed" | "wrong_stick" | "wrong_account" | "running_elsewhere";
    };

/**
 * Whether this check from a copier is let in, and the key as it should be
 * stored afterwards (bound on first use, marked as running). Pure.
 */
export function checkAccess(k: CopierKey, hello: CopierHello, now: number): Access {
  if (!hello.stick || !hello.account || !hello.instance)
    return { status: "refused", reason: "update_needed" };
  if (k.stick && k.stick !== hello.stick) return { status: "refused", reason: "wrong_stick" };
  if (k.account && k.account !== hello.account)
    return { status: "refused", reason: "wrong_account" };
  if (k.instance && k.instance !== hello.instance && isRunning(k, now))
    return { status: "refused", reason: "running_elsewhere" };
  const bound = !k.stick || !k.account;
  const moved = k.instance !== hello.instance;
  const stale = !k.lastSeen || now - Date.parse(k.lastSeen) >= SEEN_EVERY_MS;
  const key: CopierKey = {
    ...k,
    stick: hello.stick,
    account: hello.account,
    instance: hello.instance,
    lastSeen: bound || moved || stale ? new Date(now).toISOString() : k.lastSeen,
    ...(hello.balance != null ? { balance: Math.round(hello.balance * 100) / 100 } : {}),
  };
  const save = bound || moved || stale;
  if (k.revoked) return { status: "limited", reason: "revoked", key, save };
  if (isExpired(k, now)) return { status: "limited", reason: "expired", key, save };
  return { status: "ok", key, save };
}

/** What the copier is told when it's refused or limited, in plain words. */
export const ACCESS_MESSAGE: Record<string, string> = {
  update_needed: "This copier is out of date. Get the latest version.",
  wrong_stick: "This key is locked to a different USB stick.",
  wrong_account: "This key is locked to a different MT5 account.",
  running_elsewhere: "This key is already running on another PC. Stop that one first.",
  expired: "Your access has run out. Open trades are still managed; nothing new opens.",
  revoked: "Your access is switched off. Open trades are still managed; nothing new opens.",
};

/* ── the Boss's changes ─────────────────────────────────────────────────── */

/** More days: from the expiry when it's still running, from now once expired. Pure. */
export function extendKey(k: CopierKey, days: number, now: number): CopierKey {
  const from = Math.max(now, Date.parse(k.expiresAt));
  const cap = now + MAX_KEY_DAYS * 86_400_000;
  return { ...k, expiresAt: new Date(Math.min(cap, from + days * 86_400_000)).toISOString() };
}
export const revokeKey = (k: CopierKey): CopierKey => ({ ...k, revoked: true });
export function restoreKey(k: CopierKey): CopierKey {
  const { revoked: _revoked, ...rest } = k;
  return rest;
}
/** Clears the stick and account lock, so the next first use binds again. Pure. */
export function resetLock(k: CopierKey): CopierKey {
  const { stick: _s, account: _a, instance: _i, lastSeen: _l, ...rest } = k;
  return rest;
}

/* ── the Boss's card in the Copy Trader B0T ─────────────────────────────── */

export const USERS_BUTTON = "👥 Copier users";
type Button = { text: string; callback_data: string };
export type KeysPanel = { text: string; reply_markup: { inline_keyboard: Button[][] } };

const state = (k: CopierKey, now: number) =>
  k.revoked
    ? "⛔ switched off"
    : isExpired(k, now)
      ? "⌛ expired"
      : `✅ ${daysLeft(k, now)} day${daysLeft(k, now) === 1 ? "" : "s"} left`;
const seen = (k: CopierKey, now: number) =>
  isRunning(k, now) ? "🟢 running now" : k.lastSeen ? "⚪️ not running" : "⚪️ never used";

/** The list of users. Pure. */
export function usersPanel(keys: CopierKey[], now: number, note?: string): KeysPanel {
  const sorted = [...keys].sort((a, b) => a.name.localeCompare(b.name));
  return {
    text: [
      ...(note ? [note, ""] : []),
      "👥 COPIER USERS",
      sorted.length
        ? "Each has their own key, locked to one USB stick and one MT5 account."
        : "Nobody yet.",
      "",
      ...sorted.map((k, i) => `${i + 1}. ${k.name}: ${state(k, now)} · ${seen(k, now)}`),
      ...(sorted.length ? [""] : []),
      "To add someone, send:  /adduser Name 30",
      "(the number is how many days of access)",
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [
        ...sorted.map((k) => [{ text: `👤 ${k.name}`, callback_data: `ck:u:${k.id}` }]),
        [{ text: "🔄 Refresh", callback_data: "ck:list" }],
      ],
    },
  };
}

/** One user's card. `confirmRemove` shows the second tap of removing. Pure. */
export function userPanel(
  k: CopierKey,
  now: number,
  note?: string,
  confirmRemove = false,
): KeysPanel {
  const until = new Date(k.expiresAt).toISOString().slice(0, 10);
  return {
    text: [
      ...(note ? [note, ""] : []),
      `👤 ${k.name}`,
      `${state(k, now)} (until ${until})`,
      seen(k, now),
      k.stick ? "🔒 Locked to a USB stick" : "🔓 No stick yet (locks on first use)",
      k.account ? `🔒 MT5 account ${k.account}` : "🔓 No MT5 account yet (locks on first use)",
      ...(k.balance != null ? [`💰 Balance last seen: ${k.balance.toFixed(2)}`] : []),
    ].join("\n"),
    reply_markup: {
      inline_keyboard: confirmRemove
        ? [
            [{ text: "🗑 Yes, remove for good", callback_data: `ck:dy:${k.id}` }],
            [{ text: "↩️ Keep", callback_data: `ck:u:${k.id}` }],
          ]
        : [
            [
              { text: "➕ 7 days", callback_data: `ck:x:${k.id}:7` },
              { text: "➕ 30 days", callback_data: `ck:x:${k.id}:30` },
              { text: "➕ 90 days", callback_data: `ck:x:${k.id}:90` },
            ],
            [
              k.revoked
                ? { text: "✅ Switch back on", callback_data: `ck:on:${k.id}` }
                : { text: "⛔ Switch off", callback_data: `ck:off:${k.id}` },
            ],
            [{ text: "🔓 Reset stick and account lock", callback_data: `ck:rl:${k.id}` }],
            [{ text: "🔑 New key (the old one stops)", callback_data: `ck:nk:${k.id}` }],
            [{ text: "🗑 Remove", callback_data: `ck:dl:${k.id}` }],
            [{ text: "⬅️ All users", callback_data: "ck:list" }],
          ],
    },
  };
}

/** The message that shows a new key, once. Pure. */
export function tokenMessage(name: string, token: string): string {
  return [
    `🔑 Key for ${name} (shown once, so save it now):`,
    "",
    token,
    "",
    "It goes in their copier as the token. It locks to their USB stick and MT5 account the first time it runs.",
  ].join("\n");
}

/** A tap on the users cards, as what to do. Pure. */
export type KeyTap =
  | { do: "list" }
  | { do: "show" | "off" | "on" | "reset" | "newkey" | "askRemove" | "remove"; id: string }
  | { do: "extend"; id: string; days: number }
  | null;
export function parseKeyTap(data: string): KeyTap {
  const [p, kind, id, val] = data.split(":");
  if (p !== "ck") return null;
  if (kind === "list") return { do: "list" };
  if (!/^[0-9a-f]{10}$/.test(id ?? "")) return null;
  const map: Record<string, "show" | "off" | "on" | "reset" | "newkey" | "askRemove" | "remove"> = {
    u: "show",
    off: "off",
    on: "on",
    rl: "reset",
    nk: "newkey",
    dl: "askRemove",
    dy: "remove",
  };
  if (kind === "x") {
    const days = Number(val);
    return [7, 30, 90].includes(days) ? { do: "extend", id, days } : null;
  }
  return map[kind] ? { do: map[kind], id } : null;
}

/** "/users", the button, or "/adduser Name 30". Pure. */
export function parseKeyCommand(
  text: string,
): { cmd: "users" } | { cmd: "add"; name: string; days: number } | { cmd: "badadd" } | null {
  const t = text.trim();
  if (t === USERS_BUTTON || /^\/users(?:@\w+)?$/i.test(t)) return { cmd: "users" };
  const m = /^\/adduser(?:@\w+)?(?:\s+(.*))?$/i.exec(t);
  if (!m) return null;
  const parts = (m[1] ?? "").trim().split(/\s+/).filter(Boolean);
  const days = Number(parts.at(-1));
  const name = clean(parts.slice(0, -1).join(" "), 40);
  if (!name || !Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) return { cmd: "badadd" };
  return { cmd: "add", name, days };
}
