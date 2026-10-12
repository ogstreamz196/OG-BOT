import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authorizeVaultApi, CORS, json } from "@/lib/vault-api.server";

const Body = z.object({ username: z.string().trim().min(1).max(120), pin: z.string().trim().min(1).max(120) });

export const Route = createFileRoute("/api/public/v1/vault/verify")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const auth = await authorizeVaultApi(request);
        if ("error" in auth) return auth.error;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ ok: false, error: "Send username and pin" }, 400);
        const { data } = await auth.db
          .from("vip_pass_credentials")
          .select("password,active")
          .ilike("username", parsed.data.username)
          .maybeSingle();
        const valid = !!data?.active && data.password === parsed.data.pin;
        return json({ ok: true, valid });
      },
    },
  },
});
