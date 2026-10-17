import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Sign in with a username or VIP ID when it isn't the account's login name
 * (e.g. a Google member's username, or "OGBRIAN"). The account is looked up
 * and signed in here on the server, so the account's email address is never
 * sent back to the browser; only a session is.
 */

const WINDOW_MS = 15 * 60_000;
const MAX_TRIES = 8;
const tries = new Map<string, { count: number; until: number }>();

function tooManyTries(key: string): boolean {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.until < now) {
    tries.set(key, { count: 1, until: now + WINDOW_MS });
    if (tries.size > 5000) tries.delete(tries.keys().next().value!);
    return false;
  }
  t.count += 1;
  return t.count > MAX_TRIES;
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export type IdentifierSignIn =
  | { ok: true; access_token: string; refresh_token: string }
  | { ok: false; reason: "not_found" | "too_many" };

export const signInWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        identifier: z.string().trim().min(2).max(80),
        password: z.string().min(6).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<IdentifierSignIn> => {
    const id = data.identifier.trim();
    if (id.includes("@")) return { ok: false, reason: "not_found" };
    if (tooManyTries(id.toLowerCase())) return { ok: false, reason: "too_many" };

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { ok: false, reason: "not_found" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // VIP ID: "OG" + the username in capitals (typed with or without "OG").
    const compact = id.replace(/[^A-Za-z0-9]/g, "");
    const vipId = (/^og/i.test(compact) ? compact : `OG${compact}`).toUpperCase();
    const [byVip, byName] = await Promise.all([
      compact.length >= 3
        ? db.from("profiles").select("id, email").ilike("og_vip_id", vipId).limit(2)
        : Promise.resolve({ data: [] }),
      db.from("profiles").select("id, email").ilike("display_name", escapeLike(id)).limit(3),
    ]);

    const seen = new Set<string>();
    const accounts = [...(byVip.data ?? []), ...(byName.data ?? [])].filter(
      (p: { id: string }) => !seen.has(p.id) && seen.add(p.id),
    ) as { id: string; email: string | null }[];

    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    for (const acct of accounts.slice(0, 3)) {
      let email = acct.email;
      if (!email) {
        const { data: u } = await db.auth.admin.getUserById(acct.id);
        email = u?.user?.email ?? null;
      }
      if (!email) continue;
      const { data: signedIn } = await anon.auth.signInWithPassword({
        email,
        password: data.password,
      });
      if (signedIn?.session) {
        tries.delete(id.toLowerCase());
        return {
          ok: true,
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
        };
      }
    }
    return { ok: false, reason: "not_found" };
  });
