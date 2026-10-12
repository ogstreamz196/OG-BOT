import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/suno-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-ogbot-retry-token") ?? "";
        const { data: tokenValid, error: tokenError } = await supabaseAdmin.rpc(
          "verify_song_retry_token",
          { p_token: token },
        );
        if (tokenError || !tokenValid) {
          return new Response("Forbidden", { status: 403 });
        }
        const { retryDueSongs } = await import("@/lib/suno-auto-retry.server");
        try {
          return Response.json({ ok: true, ...(await retryDueSongs(token)) });
        } catch (error) {
          console.error("Automatic music recovery failed", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
