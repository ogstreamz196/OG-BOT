// The database side of the per-user copier keys (copier-keys.ts): looking a
// key up from the token a copier sends, the feed's access check, and the
// Boss's users card in the Copy Trader B0T. Keys live in site_content
// ("copy.key.<hash>", service-only), so there's no migration and a missing
// row simply means no access.
import {
  ACCESS_MESSAGE,
  checkAccess,
  extendKey,
  helloFrom,
  isMyCommand,
  keyForLogin,
  myCopier,
  myPanel,
  KEY_ROW_PREFIX,
  keyRow,
  newKey,
  parseKey,
  parseKeyCommand,
  parseKeyTap,
  parseMyTap,
  resetLock,
  restoreKey,
  revokeKey,
  setPaused,
  tokenMessage,
  USER_TOKEN_PREFIX,
  userPanel,
  usersPanel,
  type Access,
  type CopierKey,
  type KeysPanel,
  type MyCopier,
} from "./copier-keys";

type Admin = any;
type Stored = { hash: string; key: CopierKey };

async function sha256(text: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(text).digest("hex");
}

async function makeToken(): Promise<{ token: string; hash: string }> {
  const { randomBytes } = await import("crypto");
  const token = `${USER_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { token, hash: await sha256(token) };
}

async function listKeys(admin: Admin): Promise<Stored[]> {
  const { data } = await admin
    .from("site_content")
    .select("key, value")
    .like("key", `${KEY_ROW_PREFIX}%`)
    .limit(500);
  return ((data ?? []) as { key: string; value: string }[])
    .map((r) => ({ hash: r.key.slice(KEY_ROW_PREFIX.length), key: parseKey(r.value) }))
    .filter((r): r is Stored => !!r.key);
}

async function saveKey(admin: Admin, hash: string, key: CopierKey): Promise<boolean> {
  const { error } = await admin
    .from("site_content")
    .upsert(
      { key: keyRow(hash), value: JSON.stringify(key), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return !error;
}

async function audit(admin: Admin, userId: string | undefined, what: string, key: CopierKey) {
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: userId ?? null,
      action: "copier_key",
      category: "signals",
      target_key: what.slice(0, 60),
      metadata: { id: key.id, name: key.name, expiresAt: key.expiresAt },
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** A fresh token for the same key (same expiry and lock); the old token stops. */
async function rotateToken(
  admin: Admin,
  stored: Stored,
  change: Partial<CopierKey> = {},
): Promise<{ token: string; hash: string; key: CopierKey } | null> {
  const made = await makeToken();
  const key: CopierKey = { ...stored.key, ...change, id: made.hash.slice(0, 10) };
  if (!(await saveKey(admin, made.hash, key))) return null;
  await admin.from("site_content").delete().eq("key", keyRow(stored.hash));
  return { ...made, key };
}

/* ── signing in on the stick ────────────────────────────────────────────── */

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_TRIES = 8;
const loginTries = new Map<string, { count: number; until: number }>();
function tooManyLogins(key: string): boolean {
  const now = Date.now();
  const t = loginTries.get(key);
  if (!t || t.until < now) {
    loginTries.set(key, { count: 1, until: now + LOGIN_WINDOW_MS });
    if (loginTries.size > 5000) loginTries.delete(loginTries.keys().next().value!);
    return false;
  }
  t.count += 1;
  return t.count > LOGIN_MAX_TRIES;
}

/** The ogbot account a username and password belong to, or null. Never returns the email. */
async function accountFor(
  admin: Admin,
  username: string,
  password: string,
): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const tryEmail = async (email: string | null | undefined) => {
    if (!email) return null;
    const { data } = await anon.auth.signInWithPassword({ email, password });
    return data?.user?.id ?? null;
  };
  // A username account's own login name first, as the website does.
  const { vaultLoginEmail } = await import("./vault-signin");
  const direct = vaultLoginEmail(username);
  const first = direct.startsWith("@") ? null : await tryEmail(direct);
  if (first) return first;
  // Else an account whose display name is that username (e.g. one that has
  // since added a real email address).
  const like = username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: rows } = await admin
    .from("profiles")
    .select("id, email")
    .ilike("display_name", like)
    .limit(3);
  for (const p of (rows ?? []) as { id: string; email: string | null }[]) {
    let email = p.email;
    if (!email) {
      const { data: u } = await admin.auth.admin.getUserById(p.id);
      email = u?.user?.email ?? null;
    }
    const uid = await tryEmail(email);
    if (uid) return uid;
  }
  return null;
}

export type CopierLogin =
  | { ok: true; token: string; name: string; expiresAt: string }
  | { ok: false; reason: "bad_login" | "too_many" | "no_access" };

/**
 * Signing in on the stick's app with an ogbot username and password: checks
 * the password, finds the key the Boss gave that username, ties it to the
 * account and hands back a fresh token for the app to keep (the old token
 * stops; the expiry and the stick/account lock carry over).
 */
export async function copierLogin(
  admin: Admin,
  username: string,
  password: string,
): Promise<CopierLogin> {
  const handle = username.trim().toLowerCase();
  if (tooManyLogins(handle)) return { ok: false, reason: "too_many" };
  const userId = await accountFor(admin, username.trim(), password).catch(() => null);
  if (!userId) return { ok: false, reason: "bad_login" };
  loginTries.delete(handle);
  const stored = keyForLogin(await listKeys(admin), handle, userId);
  if (!stored) return { ok: false, reason: "no_access" };
  const made = await rotateToken(admin, stored, { userId });
  if (!made) return { ok: false, reason: "no_access" };
  return { ok: true, token: made.token, name: made.key.name, expiresAt: made.key.expiresAt };
}

/* ── the copy feed ──────────────────────────────────────────────────────── */

export type CopyAccess =
  | { kind: "master" }
  | { kind: "user"; access: Access; message?: string }
  | null;

/**
 * Who a copy-feed request is from: the Boss's own token (as before), a user's
 * key (checked and, when needed, saved: first-use lock, still running), or
 * nobody (null).
 */
export async function copyAccess(admin: Admin, request: Request): Promise<CopyAccess> {
  const given = request.headers.get("x-copy-token") ?? "";
  if (!given) return null;
  if (!given.startsWith(USER_TOKEN_PREFIX)) {
    const { copyTokenOk } = await import("./mt5-account.server");
    return (await copyTokenOk(admin, request)) ? { kind: "master" } : null;
  }
  if (given.length < 30 || given.length > 80) return null;
  const hash = await sha256(given);
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", keyRow(hash))
    .maybeSingle();
  const key = parseKey((data as { value?: string } | null)?.value);
  if (!key) return null;
  const access = checkAccess(key, helloFrom(request.headers), Date.now());
  if (access.status !== "refused" && access.save) await saveKey(admin, hash, access.key);
  const reason = access.status !== "ok" ? access.reason : access.key.paused ? "paused" : undefined;
  return { kind: "user", access, ...(reason ? { message: ACCESS_MESSAGE[reason] } : {}) };
}

/* ── the Boss's users card ──────────────────────────────────────────────── */

type Message = { text: string; reply_markup?: KeysPanel["reply_markup"] };

/**
 * The copy bot's answer to "/users", the 👥 button or "/adduser Name 30" from
 * the Boss's private chat, or null when it isn't one of those (or isn't the
 * Boss), so the usual reply goes instead.
 */
export async function copierKeysReply(
  admin: Admin,
  chatId: number,
  sent: string,
): Promise<Message[] | null> {
  const cmd = parseKeyCommand(sent);
  if (!cmd) return null;
  const { isBossChat } = await import("./copy-settings-bot.server");
  const boss = await isBossChat(admin, chatId).catch(
    () => ({ ok: false }) as { ok: boolean; userId?: string },
  );
  if (!boss.ok) return null;
  const now = Date.now();
  if (cmd.cmd === "badadd")
    return [
      usersPanel(
        (await listKeys(admin)).map((s) => s.key),
        now,
        "⚠️ Use /adduser Name 30 (a name, then the days of access).",
      ),
    ];
  if (cmd.cmd === "add") {
    const { token, hash } = await makeToken();
    const key = newKey(hash, cmd.name, cmd.days, now);
    if (!(await saveKey(admin, hash, key)))
      return [
        usersPanel(
          (await listKeys(admin)).map((s) => s.key),
          now,
          "⚠️ Couldn't save that. Try again in a minute.",
        ),
      ];
    await audit(admin, boss.userId, "add", key);
    return [{ text: tokenMessage(key.name, token) }, userPanel(key, now, "✅ Added.")];
  }
  return [
    usersPanel(
      (await listKeys(admin)).map((s) => s.key),
      now,
    ),
  ];
}

/**
 * A tap on the users cards ("ck:…"), Boss only: the toast, the card to put in
 * place, and (for a new key) one more message that shows the key once.
 */
export async function copierKeysTap(
  admin: Admin,
  fromId: number,
  data: string,
): Promise<{ toast: string; panel: KeysPanel | null; extra?: string }> {
  const { isBossChat } = await import("./copy-settings-bot.server");
  const boss = await isBossChat(admin, fromId).catch(
    () => ({ ok: false }) as { ok: boolean; userId?: string },
  );
  if (!boss.ok) return { toast: "Only the Boss can change these.", panel: null };
  const tap = parseKeyTap(data);
  if (!tap) return { toast: "", panel: null };
  const now = Date.now();
  const all = await listKeys(admin);
  const list = (note?: string) =>
    usersPanel(
      all.map((s) => s.key),
      now,
      note,
    );
  if (tap.do === "list") return { toast: "Up to date", panel: list() };
  const found = all.find((s) => s.key.id === tap.id);
  if (!found) return { toast: "That user's gone.", panel: list() };
  const { hash, key } = found;
  const store = async (next: CopierKey, what: string, toast: string) => {
    if (!(await saveKey(admin, hash, next)))
      return { toast: "⚠️ Couldn't save that. Try again.", panel: null };
    await audit(admin, boss.userId, what, next);
    return { toast: `✅ ${toast}`, panel: userPanel(next, now) };
  };
  switch (tap.do) {
    case "show":
      return { toast: "", panel: userPanel(key, now) };
    case "extend":
      return store(extendKey(key, tap.days, now), `extend ${tap.days}`, `${tap.days} days added`);
    case "off":
      return store(revokeKey(key), "off", "Switched off");
    case "on":
      return store(restoreKey(key), "on", "Switched back on");
    case "reset":
      return store(resetLock(key), "reset lock", "Lock cleared: it binds again on next use");
    case "askRemove":
      return { toast: "", panel: userPanel(key, now, "Remove this user for good?", true) };
    case "remove": {
      const { error } = await admin.from("site_content").delete().eq("key", keyRow(hash));
      if (error) return { toast: "⚠️ Couldn't remove. Try again.", panel: null };
      await audit(admin, boss.userId, "remove", key);
      return {
        toast: "🗑 Removed",
        panel: usersPanel(
          all.filter((s) => s.hash !== hash).map((s) => s.key),
          now,
        ),
      };
    }
    case "newkey": {
      // A fresh token for the same user: same expiry and lock, the old token stops.
      const made = await rotateToken(admin, found);
      if (!made) return { toast: "⚠️ Couldn't make a new key. Try again.", panel: null };
      const next = made.key;
      await audit(admin, boss.userId, "new key", next);
      return {
        toast: "🔑 New key made",
        panel: userPanel(next, now, "✅ New key made. The old one no longer works."),
        extra: tokenMessage(next.name, made.token),
      };
    }
  }
}

/* ── the user's own view ────────────────────────────────────────────────── */

async function keyOfUser(admin: Admin, userId: string): Promise<Stored | null> {
  return (await listKeys(admin)).find((s) => s.key.userId === userId) ?? null;
}

/** A signed-in user's own copier (website), or null when they have none. */
export async function myCopierFor(admin: Admin, userId: string): Promise<MyCopier | null> {
  const stored = await keyOfUser(admin, userId);
  return stored ? myCopier(stored.key, Date.now()) : null;
}

/** The user pauses or resumes their own copier. Null when they have none or it didn't save. */
export async function setMyCopierPaused(
  admin: Admin,
  userId: string,
  paused: boolean,
): Promise<MyCopier | null> {
  const stored = await keyOfUser(admin, userId);
  if (!stored) return null;
  const next = setPaused(stored.key, paused);
  if (!(await saveKey(admin, stored.hash, next))) return null;
  return myCopier(next, Date.now());
}

/** The ogbot account linked to a Telegram private chat, or null. */
async function accountOfChat(admin: Admin, chatId: number): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

const NOT_LINKED =
  "Link this Telegram to your ogbot.co.uk account first (ogbot.co.uk → Settings → Telegram), then send /mycopier again.";

/** "/mycopier" in the Copy Trader B0T's private chat: the user's own card, or null when it isn't that. */
export async function myCopierReply(
  admin: Admin,
  chatId: number,
  sent: string,
): Promise<KeysPanel | null> {
  if (!isMyCommand(sent)) return null;
  const userId = await accountOfChat(admin, chatId).catch(() => null);
  if (!userId) return { text: NOT_LINKED, reply_markup: { inline_keyboard: [] } };
  const stored = await keyOfUser(admin, userId);
  return myPanel(stored?.key ?? null, Date.now());
}

/** A tap on the user's own card ("ck:me:…"). */
export async function myCopierTap(
  admin: Admin,
  fromId: number,
  data: string,
): Promise<{ toast: string; panel: KeysPanel | null }> {
  const tap = parseMyTap(data);
  if (!tap) return { toast: "", panel: null };
  const userId = await accountOfChat(admin, fromId).catch(() => null);
  if (!userId) return { toast: "Link your ogbot account first.", panel: null };
  const stored = await keyOfUser(admin, userId);
  const now = Date.now();
  if (!stored) return { toast: "No copier access yet.", panel: myPanel(null, now) };
  if (tap === "refresh") return { toast: "Up to date", panel: myPanel(stored.key, now) };
  const next = setPaused(stored.key, tap === "pause");
  if (!(await saveKey(admin, stored.hash, next)))
    return { toast: "⚠️ Couldn't save that. Try again.", panel: null };
  return {
    toast: tap === "pause" ? "⏸ Paused: nothing new opens" : "▶️ New trades are on again",
    panel: myPanel(next, now),
  };
}

/* ── OG SIGNAL BOT TOKEN: bought in the store ───────────────────────────── */

/**
 * A paid OG SIGNAL BOT TOKEN (the store webhook, perk "signal_token[:days]"):
 * adds the days to the buyer's key, or makes them one tied to their account.
 * The token itself isn't shown here: the member gets it on their /copier
 * page (issueMyToken) or by signing in on the stick's app. Tells them on
 * Telegram when their account is linked. Never throws.
 */
export async function grantSignalToken(
  admin: Admin,
  userId: string,
  days: number,
  reference: string,
): Promise<{ ok: boolean; created: boolean; expiresAt?: string }> {
  try {
    const { boughtKey } = await import("./copier-keys");
    const now = Date.now();
    const stored = await keyOfUser(admin, userId);
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name, email, telegram_chat_id")
      .eq("id", userId)
      .maybeSingle();
    const p = (profile ?? {}) as {
      display_name?: string | null;
      email?: string | null;
      telegram_chat_id?: number | string | null;
    };
    const name = (p.display_name || p.email?.split("@")[0] || "Member").slice(0, 40);
    let key: CopierKey;
    let hash: string;
    if (stored) {
      key = boughtKey(stored.key, { hash: stored.hash, name, userId }, days, now);
      hash = stored.hash;
    } else {
      const made = await makeToken();
      hash = made.hash;
      key = boughtKey(null, { hash, name, userId }, days, now);
    }
    if (!(await saveKey(admin, hash, key))) return { ok: false, created: false };
    await audit(admin, userId, `bought ${days}d ${reference}`, key);
    const chat = Number(p.telegram_chat_id);
    if (Number.isFinite(chat) && chat !== 0) {
      const { sendTelegramText } = await import("./sports-guide.server");
      await sendTelegramText(
        chat,
        [
          `✅ <b>OG SIGNAL BOT TOKEN</b>: ${days} days added.`,
          `Your access runs until ${new Date(key.expiresAt).toLocaleDateString("en-GB")}.`,
          "Get your token and the setup steps at https://ogbot.co.uk/copier",
        ].join("\n"),
      ).catch(() => undefined);
    }
    return { ok: true, created: !stored, expiresAt: key.expiresAt };
  } catch (e) {
    console.warn("[copier-keys] grantSignalToken failed", e instanceof Error ? e.message : e);
    return { ok: false, created: false };
  }
}

/**
 * The member's token, made fresh and shown once (their /copier page): the
 * old token stops, the expiry and the machine lock carry over. Null when
 * they have no key, or it's switched off.
 */
export async function issueMyToken(
  admin: Admin,
  userId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const stored = await keyOfUser(admin, userId);
  if (!stored || stored.key.revoked) return null;
  const made = await rotateToken(admin, stored);
  if (!made) return null;
  await audit(admin, userId, "member new token", made.key);
  return { token: made.token, expiresAt: made.key.expiresAt };
}

/* ── the Boss's tokens panel (Signals Control Room) ─────────────────────── */

export type BossKeyRow = {
  id: string;
  name: string;
  /** The ogbot account it's paired with: display name, else email. */
  account: { userId: string; label: string } | null;
  state: "active" | "expired" | "off";
  daysLeft: number;
  expiresAt: string;
  running: boolean;
  lastSeen: string | null;
  mt5: string | null;
  balance: number | null;
  /** Locked to a machine already (cleared with "reset"). */
  locked: boolean;
  paused: boolean;
};

/** Every key, soonest to run out first, with the paired account's name. */
export async function bossKeyRows(admin: Admin): Promise<BossKeyRow[]> {
  const { daysLeft, isExpired, isRunning } = await import("./copier-keys");
  const now = Date.now();
  const all = await listKeys(admin);
  const ids = [...new Set(all.map((s) => s.key.userId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await admin.from("profiles").select("id, display_name, email").in("id", ids);
    for (const p of (data ?? []) as {
      id: string;
      display_name?: string | null;
      email?: string | null;
    }[])
      names.set(p.id, p.display_name || p.email || "Member");
  }
  return all
    .map(({ key: k }) => ({
      id: k.id,
      name: k.name,
      account: k.userId ? { userId: k.userId, label: names.get(k.userId) ?? "Member" } : null,
      state: (k.revoked ? "off" : isExpired(k, now) ? "expired" : "active") as BossKeyRow["state"],
      daysLeft: daysLeft(k, now),
      expiresAt: k.expiresAt,
      running: isRunning(k, now),
      lastSeen: k.lastSeen ?? null,
      mt5: k.account ?? null,
      balance: k.balance ?? null,
      locked: !!(k.stick || k.account),
      paused: !!k.paused,
    }))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

export type BossKeyAction = "extend" | "off" | "on" | "reset" | "remove";

/** One action on a key from the Control Room, audit-logged. */
export async function bossKeyAction(
  admin: Admin,
  actorId: string,
  id: string,
  action: BossKeyAction,
  days = 30,
): Promise<{ ok: boolean; message: string }> {
  const found = (await listKeys(admin)).find((s) => s.key.id === id);
  if (!found) return { ok: false, message: "That token's gone." };
  const now = Date.now();
  if (action === "remove") {
    const { error } = await admin.from("site_content").delete().eq("key", keyRow(found.hash));
    if (error) return { ok: false, message: "Couldn't remove it. Try again." };
    await audit(admin, actorId, "remove (web)", found.key);
    return { ok: true, message: "Removed" };
  }
  const next =
    action === "extend"
      ? extendKey(restoreKey(found.key), days, now)
      : action === "off"
        ? revokeKey(found.key)
        : action === "on"
          ? restoreKey(found.key)
          : resetLock(found.key);
  if (!(await saveKey(admin, found.hash, next)))
    return { ok: false, message: "Couldn't save. Try again." };
  await audit(
    admin,
    actorId,
    action === "extend" ? `extend ${days} (web)` : `${action} (web)`,
    next,
  );
  const message =
    action === "extend"
      ? `${days} days added`
      : action === "off"
        ? "Switched off"
        : action === "on"
          ? "Switched back on"
          : "Machine lock cleared: it binds again on next use";
  return { ok: true, message };
}

/** An ogbot account by email or display name (exactly one), or why not. */
async function findAccount(
  admin: Admin,
  who: string,
): Promise<{ userId: string; label: string } | { error: string }> {
  const w = who.trim();
  if (w.length < 3) return { error: "Type their email or username." };
  const esc = w.replace(/[\\%_]/g, (c) => `\\${c}`);
  const col = w.includes("@") ? "email" : "display_name";
  const { data } = await admin
    .from("profiles")
    .select("id, display_name, email")
    .ilike(col, esc)
    .limit(2);
  const rows = (data ?? []) as {
    id: string;
    display_name?: string | null;
    email?: string | null;
  }[];
  if (!rows.length)
    return { error: `No account with that ${col === "email" ? "email" : "username"}.` };
  if (rows.length > 1) return { error: "More than one account matches. Use their email." };
  return { userId: rows[0].id, label: rows[0].display_name || rows[0].email || "Member" };
}

/**
 * Pairing from the Control Room: an unpaired key (made in Telegram with
 * /adduser) tied to an account, or, with no key given, days for that account
 * (a new key tied to it, or added to the one it has). The member then gets
 * their token on /copier.
 */
export async function bossPairAccount(
  admin: Admin,
  actorId: string,
  who: string,
  opts: { keyId?: string; days?: number },
): Promise<{ ok: boolean; message: string }> {
  const acct = await findAccount(admin, who);
  if ("error" in acct) return { ok: false, message: acct.error };
  const all = await listKeys(admin);
  const theirs = all.find((s) => s.key.userId === acct.userId);
  if (opts.keyId) {
    const found = all.find((s) => s.key.id === opts.keyId);
    if (!found) return { ok: false, message: "That token's gone." };
    if (found.key.userId && found.key.userId !== acct.userId)
      return { ok: false, message: "That token is already paired with another account." };
    if (theirs && theirs.hash !== found.hash)
      return {
        ok: false,
        message: `${acct.label} already has a token. Add days to that one instead.`,
      };
    const next = { ...found.key, userId: acct.userId };
    if (!(await saveKey(admin, found.hash, next)))
      return { ok: false, message: "Couldn't save. Try again." };
    await audit(admin, actorId, "pair (web)", next);
    return {
      ok: true,
      message: `Paired with ${acct.label}. They get the token on their OG SIGNAL BOT page.`,
    };
  }
  const days = Math.min(MAX_KEY_DAYS_SERVER, Math.max(1, Math.round(opts.days ?? 30)));
  const res = await grantSignalToken(admin, acct.userId, days, `boss ${actorId.slice(0, 8)}`);
  if (!res.ok) return { ok: false, message: "Couldn't save. Try again." };
  return {
    ok: true,
    message: `${days} days ${res.created ? "on a new token for" : "added for"} ${acct.label}. They get the token on their OG SIGNAL BOT page.`,
  };
}
const MAX_KEY_DAYS_SERVER = 3650;

/**
 * A refunded OG SIGNAL BOT TOKEN (the payments webhook, full refund): the
 * buyer's key is switched off (not deleted), so the copier closes what's open
 * and opens nothing new. The Boss can switch it back on in the Control Room.
 */
export async function refundSignalToken(
  admin: Admin,
  userId: string,
  reference: string,
): Promise<boolean> {
  const stored = await keyOfUser(admin, userId).catch(() => null);
  if (!stored || stored.key.revoked) return false;
  const next = revokeKey(stored.key);
  if (!(await saveKey(admin, stored.hash, next))) return false;
  await audit(admin, userId, `refund off ${reference}`, next);
  return true;
}

/**
 * Claiming the OG SIGNAL BOT TOKEN while the store item is free (price 0):
 * checks the item really is free and active, and the account may claim
 * (freeClaimAllowed), then grants its days like a purchase.
 */
export async function claimFreeToken(
  admin: Admin,
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  const { FREE_RENEW_DAYS, TOKEN_ITEM_SLUG, freeClaimAllowed, tokenPerkDays } =
    await import("./copier-keys");
  const { data: item } = await admin
    .from("store_items")
    .select("price_cents, coin_price, perk_slug, active")
    .eq("slug", TOKEN_ITEM_SLUG)
    .maybeSingle();
  const it = item as {
    price_cents?: number;
    coin_price?: number | null;
    perk_slug?: string | null;
    active?: boolean;
  } | null;
  const days = tokenPerkDays(it?.perk_slug);
  if (!it?.active || !days || Number(it.price_cents) !== 0 || (it.coin_price ?? 0) > 0)
    return { ok: false, message: "The OG SIGNAL BOT TOKEN isn't free right now." };
  const stored = await keyOfUser(admin, userId);
  const allowed = freeClaimAllowed(stored?.key ?? null, Date.now());
  if (!allowed.ok)
    return {
      ok: false,
      message:
        allowed.reason === "off"
          ? "Your token is switched off. Message the Boss to get it back on."
          : `You already have your token. Claim again when ${FREE_RENEW_DAYS} days or fewer are left.`,
    };
  const res = await grantSignalToken(admin, userId, days, "free claim");
  if (!res.ok) return { ok: false, message: "Couldn't set it up. Try again in a minute." };
  return {
    ok: true,
    message: `${days} days of OG SIGNAL BOT added. Get your token on the next page.`,
  };
}

/** The OG SIGNAL BOT zip's download link (Control Room), or null when none is set. */
export async function downloadUrl(admin: Admin): Promise<string | null> {
  const { DOWNLOAD_URL_KEY, cleanDownloadUrl } = await import("./copier-keys");
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", DOWNLOAD_URL_KEY)
    .maybeSingle();
  return cleanDownloadUrl((data as { value?: string } | null)?.value);
}

/** The Boss sets (or clears, with "") the zip's download link. */
export async function setDownloadUrl(
  admin: Admin,
  actorId: string,
  url: string,
): Promise<{ ok: boolean; message: string }> {
  const { DOWNLOAD_URL_KEY, cleanDownloadUrl } = await import("./copier-keys");
  const clean = url.trim() ? cleanDownloadUrl(url) : "";
  if (clean == null) return { ok: false, message: "Use a full https:// link." };
  const at = new Date().toISOString();
  const { error } = await admin
    .from("site_content")
    .upsert({ key: DOWNLOAD_URL_KEY, value: clean, updated_at: at }, { onConflict: "key" });
  if (error) return { ok: false, message: "Couldn't save. Try again." };
  await admin
    .from("boss_audit_log")
    .insert({
      actor_id: actorId,
      action: "copier_download_url",
      category: "signals",
      target_key: DOWNLOAD_URL_KEY,
      metadata: { url: clean },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return { ok: true, message: clean ? "Download link saved" : "Download link cleared" };
}

export type TokenPass = {
  itemId: string;
  priceCents: number;
  currency: string;
  days: number;
  /** Free for a limited time (price 0): claimed, not bought. */
  free: boolean;
};

/** The OG SIGNAL BOT pass on sale (the store item), or null when it's not on sale. */
export async function tokenPass(admin: Admin): Promise<TokenPass | null> {
  const { TOKEN_ITEM_SLUG, tokenPerkDays } = await import("./copier-keys");
  const { data } = await admin
    .from("store_items")
    .select("id, price_cents, coin_price, currency, perk_slug, active")
    .eq("slug", TOKEN_ITEM_SLUG)
    .maybeSingle();
  const it = data as {
    id: string;
    price_cents: number;
    coin_price: number | null;
    currency: string;
    perk_slug: string | null;
    active: boolean;
  } | null;
  const days = tokenPerkDays(it?.perk_slug);
  if (!it?.active || !days) return null;
  return {
    itemId: it.id,
    priceCents: Number(it.price_cents) || 0,
    currency: it.currency || "gbp",
    days,
    free: !(Number(it.price_cents) > 0) && !(it.coin_price ?? 0),
  };
}

export type TokenStatus = {
  name: string;
  state: "active" | "expired" | "off";
  daysLeft: number;
  expiresAt: string;
  paused: boolean;
};

/**
 * What the OG SIGNAL BOT app shows before (and while) it trades: the token's
 * days left and state, read only. Unlike the copy feed it never locks the
 * token to a machine or account, so the app can check it at any time. Null
 * for a token that isn't (or is no longer) valid.
 */
export async function tokenStatus(admin: Admin, token: string): Promise<TokenStatus | null> {
  if (!token.startsWith(USER_TOKEN_PREFIX) || token.length < 30 || token.length > 80) return null;
  const { daysLeft, isExpired } = await import("./copier-keys");
  const { data } = await admin
    .from("site_content")
    .select("value")
    .eq("key", keyRow(await sha256(token)))
    .maybeSingle();
  const k = parseKey((data as { value?: string } | null)?.value);
  if (!k) return null;
  const now = Date.now();
  return {
    name: k.name,
    state: k.revoked ? "off" : isExpired(k, now) ? "expired" : "active",
    daysLeft: daysLeft(k, now),
    expiresAt: k.expiresAt,
    paused: !!k.paused,
  };
}
