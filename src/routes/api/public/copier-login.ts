import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Signing in on the copier stick's app (tools/mt5-copier): an ogbot username
// and password in, that user's copier key out (copier-keys.server.ts
// copierLogin). The password is checked on the server and never logged; the
// account's email is never sent back. Wrong logins are limited per username.
const Body = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(200),
});

const json = (b: unknown, status = 200) =>
  Response.json(b, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/copier-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json({ ok: false, reason: "bad_request" }, 400);
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { copierLogin } = await import("@/lib/copier-keys.server");
        const res = await copierLogin(supabaseAdmin, body.username, body.password).catch(
          () => ({ ok: false, reason: "bad_login" }) as const,
        );
        if (res.ok) return json(res);
        const status = res.reason === "too_many" ? 429 : res.reason === "no_access" ? 403 : 401;
        return json(res, status);
      },
    },
  },
});
