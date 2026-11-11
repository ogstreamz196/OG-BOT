import { createFileRoute } from "@tanstack/react-router";

// The Python MT5 copier (tools/mt5-copier) reports the Boss's MT5 account
// here every 30 seconds: balance, equity, currency and server name, nothing
// else (no login, no password). The bot sizes lots from it and the results
// post shows it (src/lib/mt5-account.server.ts). Needs header x-copy-token.
export const Route = createFileRoute("/api/public/copy-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const acct = await import("@/lib/mt5-account.server");
        if (!(await acct.copyTokenOk(supabaseAdmin, request)))
          return new Response("Forbidden", { status: 403 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "bad json" }, { status: 400 });
        }
        if (!body || typeof body !== "object")
          return Response.json({ ok: false, error: "bad body" }, { status: 400 });
        const saved = await acct.saveReport(supabaseAdmin, body as Record<string, unknown>);
        if (!saved) return Response.json({ ok: false, error: "not saved" }, { status: 400 });
        // The results post follows the balance (and shows it once connected).
        const results = await acct.syncResultsBalance(supabaseAdmin);
        return Response.json({ ok: true, balance: saved.balance, peak: saved.peak, results });
      },
    },
  },
});
