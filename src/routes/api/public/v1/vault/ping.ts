import { createFileRoute } from "@tanstack/react-router";
import { authorizeVaultApi, CORS, json } from "@/lib/vault-api.server";

export const Route = createFileRoute("/api/public/v1/vault/ping")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const auth = await authorizeVaultApi(request);
        if ("error" in auth) return auth.error;
        const { count } = await auth.db
          .from("vip_pass_credentials")
          .select("id", { count: "exact", head: true })
          .eq("active", true);
        return json({ ok: true, key_name: "OG BOT Vault", active_credentials: count ?? 0 });
      },
    },
  },
});
