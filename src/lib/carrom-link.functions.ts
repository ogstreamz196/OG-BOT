import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LINK_AUDIENCE, LINK_TTL_SECONDS, signLinkToken } from "./carrom-link";

const CARROM_ORIGIN = "https://carrom.ogbot.co.uk";

/**
 * One-tap sign-in to OG CARROM. Returns a short-lived signed token that carries
 * only this member's id and display name (never a session or password); the
 * carrom server checks the signature with the shared CARROM_LINK_SECRET.
 */
export const getCarromLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const secret = process.env.CARROM_LINK_SECRET;
    if (!secret) throw new Error("OG CARROM linking isn't set up yet.");
    const { data } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();
    const token = await signLinkToken(
      {
        sub: context.userId,
        name: data?.display_name ?? "",
        jti: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS,
        aud: LINK_AUDIENCE,
      },
      secret,
    );
    // The token goes in the fragment so it never reaches server logs or Referer headers.
    return { url: `${CARROM_ORIGIN}/link#t=${token}` };
  });
