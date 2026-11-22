import { createFileRoute } from "@tanstack/react-router";

// The OG SIGNAL BOT app's access check (tools/mt5-copier/og_stick.py): its
// token in the x-copy-token header, the days left and state back. Read only:
// it never locks the token to a machine or MT5 account (the copy feed does
// that when the copier starts). 401 for a token that isn't valid, so the app
// asks the member to sign in again.
const json = (b: unknown, status = 200) =>
  Response.json(b, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/copier-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-copy-token") ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { tokenStatus } = await import("@/lib/copier-keys.server");
        const status = await tokenStatus(supabaseAdmin, token).catch(() => null);
        if (!status) return json({ ok: false, reason: "bad_token" }, 401);
        return json({ ok: true, ...status, renewUrl: "https://ogbot.co.uk/copier" });
      },
    },
  },
});
