import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TWEAKER_PIN_KEY, cleanPin, parseStoredPin, pinError } from "./tweaker-pin";

async function assertBoss(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: string },
    ) => Promise<{ data: boolean | null }>;
  };
  const [admin, boss] = await Promise.all([
    supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: context.userId, _role: "boss" }),
  ]);
  if (!admin.data && !boss.data) throw new Error("Forbidden");
}

/** Salted SHA-256 of a PIN. Node only; the PIN itself is never stored or logged. */
async function hashPin(salt: string, pin: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

async function readStored(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", TWEAKER_PIN_KEY)
    .maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** Boss: is a TradeTweaker PIN set? (Never returns the PIN or its hash.) */
export const getTweakerPinState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBoss(context);
    return { set: !!parseStoredPin(await readStored()) };
  });

/** Boss: check a PIN. Returns only whether it matched. */
export const verifyTweakerPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { pin: string } => ({
    pin: cleanPin((d as { pin?: unknown } | null)?.pin as string),
  }))
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const stored = parseStoredPin(await readStored());
    if (!stored) return { ok: true as const, unset: true as const };
    const ok = (await hashPin(stored.salt, data.pin)) === stored.hash;
    return { ok, unset: false as const };
  });

/** Boss: set or change the PIN. Stored as a fresh salt + hash. */
export const setTweakerPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown): { pin: string } => {
    const pin = cleanPin((d as { pin?: unknown } | null)?.pin as string);
    const err = pinError(pin);
    if (err) throw new Error(err);
    return { pin };
  })
  .handler(async ({ context, data }) => {
    await assertBoss(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomBytes } = await import("node:crypto");
    const salt = randomBytes(8).toString("hex");
    const value = `${salt}:${await hashPin(salt, data.pin)}`;
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: TWEAKER_PIN_KEY, value }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("boss_audit_log").insert({
      actor_id: context.userId,
      action: "set_tweaker_pin",
      category: "signals",
      target_key: TWEAKER_PIN_KEY,
      metadata: {},
    });
    return { ok: true as const };
  });
