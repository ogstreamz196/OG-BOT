import { createFileRoute } from "@tanstack/react-router";

// The copy feed for the Boss's own Python MT5 copier (tools/mt5-copier):
// the OG Trade Bot's signals from the last day, with the level the bot would
// close at now. Read-only. Needs the header x-copy-token matching site_content
// "copy.feedToken" (24+ characters); without that token set, it's off (403).
// The last balance stored, so a copier polling twice a second writes at most
// once a minute (or when the balance moves a dollar).
let lastBalance: { value: number; at: number } | null = null;

export const Route = createFileRoute("/api/public/copy-feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { copyTokenOk } = await import("@/lib/mt5-account.server");
        if (!(await copyTokenOk(supabaseAdmin, request)))
          return new Response("Forbidden", { status: 403 });
        // The copier reports its MT5 balance (x-copy-balance), so the signals
        // chat's test account applies the gold balance rule on the real one.
        try {
          const { balanceHeader } = await import("@/lib/copy-feed");
          const reported = balanceHeader(request.headers.get("x-copy-balance"));
          const nowMs = Date.now();
          if (
            reported != null &&
            (!lastBalance ||
              nowMs - lastBalance.at > 60_000 ||
              Math.abs(reported - lastBalance.value) >= 1)
          ) {
            lastBalance = { value: reported, at: nowMs };
            const at = new Date(nowMs).toISOString();
            await supabaseAdmin.from("site_content").upsert(
              {
                key: "copy.balance",
                value: JSON.stringify({ balance: reported, at }),
                updated_at: at,
              },
              { onConflict: "key" },
            );
          }
        } catch {
          // Never blocks the feed.
        }
        const { signalsChatId } = await import("@/lib/signal-chat.server");
        const chat = await signalsChatId();
        if (chat == null) return Response.json({ ok: true, now: Date.now(), signals: [] });
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("trade_signals")
          .select(
            "id, market, direction, entry, stop, tp1, tp3, status, best_target, entered_at, closed_at, created_at, confidence_pct, feeds",
          )
          .eq("sender_worker", "trade")
          .eq("chat_id", chat)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) return Response.json({ ok: false, error: "read failed" }, { status: 500 });
        const { copyFeed, copySettings, testSignal } = await import("@/lib/copy-feed");
        // Settings every copier follows (site_content "copy.settings").
        const { data: remote } = await supabaseAdmin
          .from("site_content")
          .select("value")
          .eq("key", "copy.settings")
          .maybeSingle();
        const settings = copySettings(remote?.value);
        // A copier-only test signal, when the Boss has one switched on.
        const { data: test } = await supabaseAdmin
          .from("site_content")
          .select("value")
          .eq("key", "copy.testSignal")
          .maybeSingle();
        const extra = testSignal(test?.value, Date.now());
        const signals = copyFeed((data ?? []) as never);
        return Response.json(
          { ok: true, now: Date.now(), settings, signals: extra ? [extra, ...signals] : signals },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
