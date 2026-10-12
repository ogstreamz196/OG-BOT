import { createFileRoute } from "@tanstack/react-router";
import { authorizeVaultApi, CORS, json } from "@/lib/vault-api.server";

export const Route = createFileRoute("/api/public/v1/vault/credentials")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const auth = await authorizeVaultApi(request);
        if ("error" in auth) return auth.error;
        const { data, error } = await auth.db
          .from("vip_pass_credentials")
          .select("username,password,note,active,created_at")
          .order("created_at", { ascending: true });
        if (error) return json({ ok: false, error: "Couldn't load logins" }, 500);
        return json({ ok: true, credentials: data ?? [] });
      },
    },
  },
});
