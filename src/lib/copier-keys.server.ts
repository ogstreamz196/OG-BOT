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
  { kind: "master" } | { kind: "user"; access: Access; message?: string } | null;

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
