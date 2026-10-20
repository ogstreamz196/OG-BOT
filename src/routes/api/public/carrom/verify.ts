import { createFileRoute } from "@tanstack/react-router";

// carrom.ogbot.co.uk asks here whether an OG Carrom pass is genuine (only
// this server can check its signature). Answers with the account id and
// display name, nothing else.
export const Route = createFileRoute("/api/public/carrom/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
        const token = typeof body?.token === "string" ? body.token : "";
        const { verifyCarromPass } = await import("@/lib/carrom-link.server");
        const pass = token ? await verifyCarromPass(token) : null;
        if (!pass) return Response.json({ ok: false }, { status: 401 });
        return Response.json({ ok: true, userId: pass.userId, name: pass.name });
      },
    },
  },
});
