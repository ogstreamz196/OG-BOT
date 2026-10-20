import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CARROM_URL = "https://carrom.ogbot.co.uk/";
const CARROM_APP_LINK = "ogcarrom://og-link";

/**
 * The OG Carrom link for a signed-in member: it carries a 5-minute pass (in
 * the #fragment, which never reaches a server log) so carrom sets up their
 * account with their OG BOT name. Guests just get the plain link.
 */
async function passFor(userId: string, challenge?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const { signCarromPass } = await import("@/lib/carrom-link.server");
  return signCarromPass({ userId, name: data?.display_name ?? "", challenge });
}

export const getCarromLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const claims = context.claims as { is_anonymous?: boolean } | undefined;
    if (claims?.is_anonymous) return { url: CARROM_URL };
    return { url: `${CARROM_URL}#og=${await passFor(context.userId)}` };
  });

/**
 * "Sign in with OG BOT" from the OG CARROM phone app: a pass locked to the
 * app's challenge, handed back to the app through its ogcarrom:// link.
 */
export const getCarromAppLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => {
    const challenge = (raw as { challenge?: unknown } | null)?.challenge;
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(challenge ?? ""))) throw new Error("Invalid request");
    return { challenge: challenge as string };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const claims = context.claims as { is_anonymous?: boolean } | undefined;
    if (claims?.is_anonymous) throw new Error("Sign in to OG BOT first");
    const token = await passFor(context.userId, data.challenge);
    return { url: `${CARROM_APP_LINK}?og=${encodeURIComponent(token)}` };
  });
