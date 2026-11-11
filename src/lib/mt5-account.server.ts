// The copier's token check (header x-copy-token = site_content
// "copy.feedToken", 24+ characters), for the copy feed. Anyone the Boss gives
// the token to can run the Python copier (tools/mt5-copier) and copy the
// bot's trades at the bot's lot sizes; nothing is reported back (the Boss,
// 2026-11-11: the bot's test account stays the reference, "so when others
// want to copy they just come online").

type Admin = any;

export const COPY_TOKEN_KEY = "copy.feedToken";

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from("site_content").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** Whether a request carries the copier's token (header x-copy-token). */
export async function copyTokenOk(admin: Admin, request: Request): Promise<boolean> {
  const { createHash, timingSafeEqual } = await import("crypto");
  const given = request.headers.get("x-copy-token") ?? "";
  const want = String((await setting(admin, COPY_TOKEN_KEY)) ?? "");
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return want.length >= 24 && !!given && timingSafeEqual(hash(given), hash(want));
}
