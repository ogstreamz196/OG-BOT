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
  KEY_ROW_PREFIX,
  keyRow,
  newKey,
  parseKey,
  parseKeyCommand,
  parseKeyTap,
  resetLock,
  restoreKey,
  revokeKey,
  tokenMessage,
  USER_TOKEN_PREFIX,
  userPanel,
  usersPanel,
  type Access,
  type CopierKey,
  type KeysPanel,
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
  const reason = access.status === "ok" ? undefined : access.reason;
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
      const made = await makeToken();
      const next: CopierKey = { ...key, id: made.hash.slice(0, 10) };
      if (!(await saveKey(admin, made.hash, next)))
        return { toast: "⚠️ Couldn't make a new key. Try again.", panel: null };
      await admin.from("site_content").delete().eq("key", keyRow(hash));
      await audit(admin, boss.userId, "new key", next);
      return {
        toast: "🔑 New key made",
        panel: userPanel(next, now, "✅ New key made. The old one no longer works."),
        extra: tokenMessage(next.name, made.token),
      };
    }
  }
}
