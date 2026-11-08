import { createFileRoute } from "@tanstack/react-router";

// OG VAULT -> OG B0T one-login check. The secret and the whole check-or-create
// logic now live in the OGSTREAMZ hub Edge Function `ogstreamz-vault-signin`
// (the Boss, 2026-11-08: keep VAULT_LINK_SECRET in Supabase only, not Lovable).
// This route just forwards the request to that function and passes its reply
// straight back, so ogbot.co.uk needs no secret of its own. Callers still sign
// the body with VAULT_LINK_SECRET; the function verifies the signature.
const json = (b: unknown, status = 200) => Response.json(b, { status });

export const Route = createFileRoute("/api/public/vault-signin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) return json({ ok: false, error: "not_configured" }, 503);
        const raw = await request.text();
        try {
          const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/ogstreamz-vault-signin`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: key,
              authorization: `Bearer ${key}`,
              // The caller's signature, verified by the function (which holds the secret).
              "x-vault-signature": request.headers.get("x-vault-signature") ?? "",
            },
            body: raw,
            signal: AbortSignal.timeout(10_000),
          });
          const text = await res.text();
          return new Response(text, {
            status: res.status,
            headers: { "content-type": "application/json" },
          });
        } catch {
          return json({ ok: false, error: "upstream" }, 502);
        }
      },
    },
  },
});
