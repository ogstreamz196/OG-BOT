import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEV_ACCOUNT_EMAIL, isDevPinUser, readDevPinCheck, type DevPinCheck } from "./dev-pin";

const DEFAULT_HUB_URL = "https://zqwngcndkxgxuwqyxihi.supabase.co";

/** Calls og_bot's door to the hub's shared dev PIN check. Never logs the PIN or a key. */
async function hubRpc(fn: "dev_pin_check" | "dev_pin_unlock", body: Record<string, unknown>) {
  const key = process.env.OG_HUB_SERVICE_KEY;
  if (!key) return null;
  const url = (process.env.OG_HUB_URL || DEFAULT_HUB_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Profile": "og_bot",
    "Accept-Profile": "og_bot",
    "Content-Type": "application/json",
  };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
}

export type DevPinSignIn =
  | { ok: true; access_token: string; refresh_token: string }
  | { ok: false; message: string };

/**
 * dev.b055 + the dev PIN: checked by the hub (one PIN and one lockout for every
 * app), then a session for the Boss's D.EV account, made on the server with a
 * one-time sign-in link that's never emailed (the account's password and
 * Google sign-in stay as they are).
 */
export const devPinSignIn = createServerFn({ method: "POST" })
  .validator((d) =>
    z.object({ username: z.string().trim().max(40), pin: z.string().max(40) }).parse(d),
  )
  .handler(async ({ data }): Promise<DevPinSignIn> => {
    if (!isDevPinUser(data.username)) return { ok: false, message: "Wrong username or PIN." };
    let check: DevPinCheck;
    try {
      const res = await hubRpc("dev_pin_check", { p_pin: data.pin });
      if (!res) return { ok: false, message: "Dev sign-in isn't connected yet." };
      if (!res.ok) return { ok: false, message: "Dev sign-in couldn't be checked just now." };
      check = readDevPinCheck(await res.json());
    } catch {
      return { ok: false, message: "Dev sign-in couldn't be checked just now." };
    }
    if (!check.ok) return { ok: false, message: check.message ?? "Wrong PIN." };

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) return { ok: false, message: "Sign-in is unavailable right now." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: DEV_ACCOUNT_EMAIL,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (error || !tokenHash) return { ok: false, message: "Sign-in is unavailable right now." };
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: verified } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    const session = verified?.session;
    if (!session) return { ok: false, message: "Sign-in is unavailable right now." };
    return { ok: true, access_token: session.access_token, refresh_token: session.refresh_token };
  });

/** Boss: clear the dev PIN lockout (it's shared by every app). */
export const unlockDevPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as unknown as {
      rpc: (
        fn: "has_role",
        a: { _user_id: string; _role: string },
      ) => Promise<{ data: boolean | null }>;
    };
    const [admin, boss] = await Promise.all([
      supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
    ]);
    if (!admin.data && !boss.data) throw new Error("Forbidden");
    const res = await hubRpc("dev_pin_unlock", {}).catch(() => null);
    if (!res) throw new Error("Dev sign-in isn't connected yet.");
    if (!res.ok) throw new Error("The hub didn't answer. Try again in a minute.");
    return { ok: true };
  });
