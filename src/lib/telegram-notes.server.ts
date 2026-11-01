/**
 * Notes queued for a member's Telegram, sent by OG B0T one message at a time.
 * A Claude (or the Boss) puts them in site_content "telegram.notes" — only
 * Boss accounts can write site_content, so members can't use it to message
 * anyone. The every-minute tracker sends what's waiting, oldest first, a few
 * per run, and marks each one sent (the notes stay as a record).
 *
 * value: [{ "to": "member@email", "text": "…", "sentAt"?: "ISO" }, …]
 * A note for a member without Telegram linked is marked "skipped".
 */
type Admin = any;

export const NOTES_KEY = "telegram.notes";
/** Per run: Telegram's own pace for one chat is about one a second. */
const PER_RUN = 8;

export type TelegramNote = { to: string; text: string; sentAt?: string; skipped?: string };

export function parseNotes(raw: string | null | undefined): TelegramNote[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v)
      ? v.filter((n) => n && typeof n.to === "string" && typeof n.text === "string")
      : [];
  } catch {
    return [];
  }
}

export async function sendTelegramNotes(admin: Admin): Promise<string> {
  try {
    const { data: row } = await admin
      .from("site_content")
      .select("value")
      .eq("key", NOTES_KEY)
      .maybeSingle();
    const raw = (row as { value?: string } | null)?.value;
    if (!raw) return "none";
    const notes = parseNotes(raw);
    const due = notes.map((n, i) => ({ n, i })).filter(({ n }) => !n.sentAt && !n.skipped);
    if (!due.length) return "none";
    const batch = due.slice(0, PER_RUN);

    // Claim the batch first (only if nobody changed the notes meanwhile), so
    // two overlapping runs never send the same note twice.
    const at = new Date().toISOString();
    const claimed = notes.map((n, i) => (batch.some((b) => b.i === i) ? { ...n, sentAt: at } : n));
    const { data: won } = await admin
      .from("site_content")
      .update({ value: JSON.stringify(claimed), updated_at: at })
      .eq("key", NOTES_KEY)
      .eq("value", raw)
      .select("key");
    if (!won?.length) return "busy";

    const emails = [...new Set(batch.map(({ n }) => n.to.toLowerCase()))];
    const { data: people } = await admin
      .from("profiles")
      .select("email, telegram_chat_id")
      .in("email", emails);
    const chatOf = new Map<string, number>(
      ((people ?? []) as { email: string | null; telegram_chat_id: number | null }[])
        .filter((p) => p.email && p.telegram_chat_id != null)
        .map((p) => [p.email!.toLowerCase(), Number(p.telegram_chat_id)]),
    );

    const { telegramApi } = await import("./telegram-api.server");
    let sent = 0;
    const missed = new Map<number, string>();
    for (const { n, i } of batch) {
      const chat_id = chatOf.get(n.to.toLowerCase());
      if (!chat_id) {
        missed.set(i, "no Telegram linked");
        continue;
      }
      const res = await telegramApi("sendMessage", {
        chat_id,
        text: n.text.slice(0, 4096),
        disable_web_page_preview: true,
      });
      if ((res as { ok?: boolean } | null)?.ok) sent++;
      else missed.set(i, "Telegram refused it");
    }
    if (missed.size) {
      const { data: now } = await admin
        .from("site_content")
        .select("value")
        .eq("key", NOTES_KEY)
        .maybeSingle();
      const latest = parseNotes((now as { value?: string } | null)?.value).map((n, i) =>
        missed.has(i) ? { ...n, sentAt: undefined, skipped: missed.get(i) } : n,
      );
      await admin
        .from("site_content")
        .update({ value: JSON.stringify(latest), updated_at: new Date().toISOString() })
        .eq("key", NOTES_KEY);
    }
    return `sent ${sent}${missed.size ? `, skipped ${missed.size}` : ""}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}
