// The bot's test account mirrors the Boss's copier (the Boss, 2026-11-12:
// "whatever settings I do inside the copy trade bot, make it reflect inside
// the signal group without announcing the change; this helps me see what's
// happening to my real account"). Each new trade's test-account lot is the
// lot the copier would take under site_content "copy.settings" (copierLot),
// and it's not taken when the copier wouldn't take it (copierSkips). Nothing
// is posted when a setting changes: the next trades simply follow it. The
// bot's own lot is kept as feeds.paper.botLots, which the copy feed sends,
// so the copier never applies its multiplier twice. Never throws.
import { copierBalance, copierLot, copierSkips, copySettings } from "./copy-feed";

type Admin = any;

/**
 * Whether the Boss's high-frequency switch is on (site_content "copy.settings"),
 * for the posting side: more trades at once and shorter waits (hftConcurrency).
 * Cached 15 seconds; off on any error.
 */
export async function hftOn(): Promise<boolean> {
  try {
    const { cached } = await import("./server-cache");
    return await cached("copy-settings-hft", 15_000, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("site_content")
        .select("value")
        .eq("key", "copy.settings")
        .maybeSingle();
      return copySettings((data as { value?: string } | null)?.value).hft === true;
    });
  } catch {
    return false;
  }
}

export async function mirrorCopier(
  admin: Admin,
  o: {
    market: string;
    botLots: number;
    confidence?: number | null;
    manual?: boolean;
    balance?: number | null;
  },
): Promise<{ lots: number; why?: string }> {
  try {
    if (!(o.botLots > 0)) return { lots: o.botLots };
    const { data } = await admin
      .from("site_content")
      .select("value")
      .eq("key", "copy.settings")
      .maybeSingle();
    const raw = (data as { value?: string } | null)?.value;
    if (!raw) return { lots: o.botLots };
    const s = copySettings(raw);
    // The copier's open trades: the trade bot's running trades the test account took.
    const { chatPurgedAt } = await import("./signal-chat.server");
    const purgedAt = await chatPurgedAt().catch(() => null);
    const since = Math.max(
      purgedAt == null ? 0 : new Date(purgedAt).getTime() || 0,
      Date.now() - 24 * 3600_000,
    );
    const { data: open } = await admin
      .from("trade_signals")
      .select("feeds")
      .eq("sender_worker", "trade")
      .in("status", ["open", "tp1", "tp2"])
      .gte("created_at", new Date(since).toISOString())
      .limit(200);
    const openCopied = ((open ?? []) as { feeds: { paper?: { lots?: number } } | null }[]).filter(
      (r) => Number(r.feeds?.paper?.lots) > 0,
    ).length;
    const skip = copierSkips(s, o.market, openCopied);
    if (skip) return { lots: 0, why: `not copied: ${skip}` };
    // The gold balance rule on the real account's balance when the copier has
    // reported it lately, else the test account's.
    const { data: bal } = await admin
      .from("site_content")
      .select("value")
      .eq("key", "copy.balance")
      .maybeSingle();
    const real = copierBalance((bal as { value?: string } | null)?.value, Date.now());
    return { lots: copierLot(s, { ...o, balance: real ?? o.balance }) };
  } catch {
    return { lots: o.botLots };
  }
}
