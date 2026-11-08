import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "crypto";
import { z } from "zod";
import { vaultFresh, vaultLoginEmail, vaultSignatureOk } from "@/lib/vault-signin";

// OG VAULT -> OG B0T one-login. OG VAULT signs the body with VAULT_LINK_SECRET
// and posts it here; this endpoint verifies the signature and either signs the
// member in or creates their OG B0T account in OG B0T's own database. The secret
// lives in OG B0T's own environment, never in the Vault app.

const Body = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(200),
  ts: z.number(),
});

const tries = new Map<string, { n: number; until: number }>();
function locked(key: string): boolean {
  const now = Date.now();
  const t = tries.get(key);
  return !!t && t.until > now && t.n >= 5;
}
function fail(key: string) {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.until < now) tries.set(key, { n: 1, until: now + 15 * 60_000 });
  else t.n += 1;
  if (tries.size > 5000) tries.delete(tries.keys().next().value!);
}

const json = (b: unknown, status = 200) => Response.json(b, { status });

export const Route = createFileRoute("/api/public/vault-signin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.VAULT_LINK_SECRET;
        if (!secret) return json({ ok: false, error: "not_configured" }, 503);
        const raw = await request.text();
        if (!vaultSignatureOk(secret, raw, request.headers.get("x-vault-signature")))
          return json({ ok: false, error: "bad_signature" }, 401);
        let parsed;
        try {
          parsed = Body.parse(JSON.parse(raw));
        } catch {
          return json({ ok: false, error: "bad_request" }, 400);
        }
        if (!vaultFresh(parsed.ts)) return json({ ok: false, error: "expired" }, 401);

        // Only the plain handle is ever used or stored: strip any streaming
        // address prefix so nothing on OG B0T is tied to IPTV.
        const handle = parsed.username.trim().replace(/^m3u\./i, "");
        const email = vaultLoginEmail(handle);
        if (email.startsWith("@")) return json({ ok: false, error: "bad_request" }, 400);
        if (locked(email)) return json({ ok: false, error: "too_many" }, 429);

        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const { createClient } = await import("@supabase/supabase-js");
        const anon = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: signed } = await anon.auth.signInWithPassword({
          email,
          password: parsed.password,
        });
        if (signed?.user) return json({ ok: true, action: "signed_in" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: existing } = await db
          .from("profiles")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        if (existing) {
          fail(email);
          return json({ ok: false, action: "wrong_password" }, 401);
        }

        const { data: made, error } = await db.auth.admin.createUser({
          email,
          password: parsed.password,
          email_confirm: true,
          // No origin marker: the account must not reveal where the person came
          // from. It carries only their own display name.
          user_metadata: { display_name: handle },
        });
        if (error || !made?.user) {
          fail(email);
          return json({ ok: false, action: "wrong_password" }, 401);
        }
        const linkCode = `t_${randomBytes(16).toString("hex")}`;
        await db.from("profiles").update({ telegram_link_token: linkCode }).eq("id", made.user.id);
        return json({
          ok: true,
          action: "created",
          setup_url: "https://ogbot.co.uk/welcome",
          link_code: linkCode,
          telegram_url: `https://t.me/OGB0T_bot?start=${linkCode}`,
        });
      },
    },
  },
});
