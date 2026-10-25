/**
 * Connecting a Telegram account from Telegram itself. Someone without an OG B0T
 * account taps Connect (in a group, or /start in the private chat); OG B0T
 * sends a one-time link to ogbot.co.uk in their private chat, and whoever
 * signs in or creates an account through it gets that Telegram linked.
 *
 * The link only ever appears in that person's own private chat, so nobody else
 * can use it to tie someone else's Telegram to their account. Only a hash of
 * the token is stored, and it works once, for 24 hours.
 */
import { createHash, randomBytes } from "crypto";

type Admin = any;

const TOKENS = "telegram_connect_tokens";
export const CONNECT_TTL_MS = 24 * 3_600_000;
/** "tc_" + 32 random bytes, base64url. */
export const CONNECT_TOKEN_RE = /^tc_[A-Za-z0-9_-]{43}$/;
export const SITE_CONNECT_URL = "https://ogbot.co.uk/tg-connect";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh one-time connect token for this Telegram user, or null if it couldn't be saved. */
export async function createConnectToken(
  admin: Admin,
  user: { id: number; username?: string; first_name?: string },
  now = Date.now(),
): Promise<string | null> {
  const token = `tc_${randomBytes(32).toString("base64url")}`;
  try {
    const { error } = await admin.from(TOKENS).insert({
      token_hash: hashToken(token),
      telegram_user_id: user.id,
      telegram_username: user.username ?? null,
      telegram_first_name: user.first_name ?? null,
      expires_at: new Date(now + CONNECT_TTL_MS).toISOString(),
    });
    return error ? null : token;
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { ok: true; telegramUserId: number }
  | { ok: false; reason: "invalid" | "expired" | "used" | "failed" };

/**
 * Links the Telegram account behind `token` to `userId`. The token is used up
 * first, atomically, so it can only ever link one account. If that Telegram was
 * linked to another account before, it moves: only its owner could have got
 * the link.
 */
export async function claimConnectToken(
  admin: Admin,
  userId: string,
  token: string,
  now = Date.now(),
): Promise<ClaimResult> {
  if (!CONNECT_TOKEN_RE.test(token)) return { ok: false, reason: "invalid" };
  const { data: row, error } = await admin
    .from(TOKENS)
    .select("id, telegram_user_id, telegram_username, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) return { ok: false, reason: "failed" };
  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (Date.parse(row.expires_at) <= now) return { ok: false, reason: "expired" };

  const at = new Date(now).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from(TOKENS)
    .update({ used_at: at, used_by: userId })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (claimError) return { ok: false, reason: "failed" };
  if (!claimed?.length) return { ok: false, reason: "used" };

  const telegramUserId = Number(row.telegram_user_id);
  await admin
    .from("profiles")
    .update({ telegram_chat_id: null, telegram_username: null, telegram_linked_at: null })
    .eq("telegram_chat_id", telegramUserId)
    .neq("id", userId);
  const { error: linkError } = await admin
    .from("profiles")
    .update({
      telegram_chat_id: telegramUserId,
      telegram_username: row.telegram_username ?? null,
      telegram_linked_at: at,
      telegram_link_token: null,
    })
    .eq("id", userId);
  if (linkError) return { ok: false, reason: "failed" };
  return { ok: true, telegramUserId };
}
