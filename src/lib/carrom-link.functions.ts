import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CARROM_URL = "https://carrom.ogbot.co.uk/";

/**
 * The OG Carrom link for a signed-in member: it carries a 5-minute pass (in
 * the #fragment, which never reaches a server log) so carrom sets up their
 * account with their OG BOT name. Guests just get the plain link.
 */
export const getCarromLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const claims = context.claims as { is_anonymous?: boolean } | undefined;
    if (claims?.is_anonymous) return { url: CARROM_URL };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();
    const { signCarromPass } = await import("@/lib/carrom-link.server");
    const token = await signCarromPass({
      userId: context.userId,
      name: data?.display_name ?? "",
    });
    return { url: `${CARROM_URL}#og=${token}` };
  });
