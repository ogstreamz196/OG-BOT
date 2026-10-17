import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { songIsNasheed, trackCardQuantity } from "@/lib/nasheed";

/**
 * Pay-by-card track creation (website only): guests, and members who pick
 * the 99p option instead of coins.
 *
 * A visitor who presses "Cook Master Track" gets a silent anonymous session.
 * Their draft song belongs to that guest account, they pay the existing 99p
 * one-off "track unlock" by card (same Stripe metadata, so the webhook and
 * reconcile path fulfil it unchanged), and only a paid draft is handed to the
 * normal song pipeline. Signing up or in later moves the guest's tracks into
 * the real account (claimGuestTracks).
 */

const isAnonymous = (claims: Record<string, unknown> | undefined) => claims?.is_anonymous === true;

export const createGuestTrackCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        songId: z.string().uuid(),
        returnUrl: z.string().url().max(2048),
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ clientSecret: string } | { error: string }> => {
    const { data: song } = await context.supabase
      .from("songs")
      .select("id, title, status, user_id")
      .eq("id", data.songId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!song) return { error: "Track not found" };
    if (song.status !== "draft") return { error: "This track is already cooking." };

    try {
      const { TRACK_UNLOCK_PENCE, TRACK_UNLOCK_CURRENCY } =
        await import("@/lib/track-unlock.server");
      const stripe = createStripeClient(data.environment as StripeEnv);
      const nasheed = await songIsNasheed(context.supabase, data.songId);
      const meta = {
        userId: context.userId,
        kind: "track_unlock",
        songId: data.songId,
        environment: data.environment,
        guest: "1",
      };
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: TRACK_UNLOCK_CURRENCY,
              unit_amount: TRACK_UNLOCK_PENCE,
              product_data: {
                name: nasheed ? "Nasheed Full Track (Pure Vocals)" : "Full track",
              },
            },
            // A Nasheed is two runs of the music engine: 2 × 99p.
            quantity: trackCardQuantity(nasheed),
          },
        ],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        payment_intent_data: {
          description: `Full track — ${song.title || "OG Bot track"}`,
          metadata: meta,
        },
        metadata: meta,
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createGuestTrackCheckout failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

const planSchema = z.object({
  lyrics: z.record(z.string(), z.unknown()),
  suno: z.record(z.string(), z.unknown()),
});

/**
 * Starts cooking a guest's draft once it's paid: requires the unlock ledger
 * row the card payment created, attaches the plan, then runs the normal
 * orchestrator. Safe to call again (already-cooking tracks are left alone).
 */
export const startGuestTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ songId: z.string().uuid(), plan: planSchema }).parse(d))
  .handler(async ({ data, context }) => {
    if (JSON.stringify(data.plan).length > 30_000) return { ok: false as const, reason: "too_big" };

    const { data: song } = await context.supabase
      .from("songs")
      .select("id, status")
      .eq("id", data.songId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!song) return { ok: false as const, reason: "not_found" };
    if (song.status !== "draft") return { ok: true as const, already: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: paid } = await supabaseAdmin
      .from("unlocked_songs")
      .select("id")
      .eq("user_id", context.userId)
      .eq("song_id", data.songId)
      .maybeSingle();
    if (!paid) return { ok: false as const, reason: "unpaid" };

    // Attach the plan once; the background worker can resume from it if this
    // request dies.
    await (supabaseAdmin as any)
      .from("songs")
      .update({
        orchestration: data.plan,
        orchestration_due_at: new Date(Date.now() + 4 * 60_000).toISOString(),
      })
      .eq("id", data.songId)
      .eq("status", "draft")
      .is("orchestration", null);

    const { getRequest } = await import("@tanstack/react-start/server");
    const auth = getRequest()?.headers.get("authorization")?.replace("Bearer ", "");
    const { orchestrateSong } = await import("./song-orchestrator.server");
    // Awaited like runQueuedSong (the worker would cut a detached promise short);
    // the client doesn't wait on this call.
    await orchestrateSong(data.songId, auth ? { Authorization: `Bearer ${auth}` } : null).catch(
      (e) => console.error("guest orchestrate failed", data.songId, e),
    );
    return { ok: true as const, already: false };
  });

/**
 * Moves a guest's tracks into the signed-in account. Proof of the guest
 * account is its refresh token (kept on the device that made the tracks);
 * the guest session is signed out afterwards.
 */
export const claimGuestTracks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ refreshToken: z.string().min(8).max(4096) }).parse(d))
  .handler(async ({ data, context }) => {
    if (isAnonymous(context.claims as Record<string, unknown>)) {
      return { ok: false as const, moved: 0, reason: "still_guest" };
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { ok: false as const, moved: 0, reason: "not_configured" };

    const { createClient } = await import("@supabase/supabase-js");
    const guestClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: refreshed, error } = await guestClient.auth.refreshSession({
      refresh_token: data.refreshToken,
    });
    const guest = refreshed?.user;
    if (error || !guest || !guest.is_anonymous) {
      return { ok: false as const, moved: 0, reason: "guest_not_found" };
    }
    if (guest.id === context.userId) return { ok: true as const, moved: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    // Drafts the guest never paid for are dropped, not moved: they'd sit stuck
    // in the library with nothing to cook them.
    const { data: paidRows } = await db
      .from("unlocked_songs")
      .select("song_id")
      .eq("user_id", guest.id);
    const paidIds = new Set((paidRows ?? []).map((r: { song_id: string }) => r.song_id));
    const { data: drafts } = await db
      .from("songs")
      .select("id")
      .eq("user_id", guest.id)
      .eq("status", "draft");
    const unpaid = (drafts ?? [])
      .map((r: { id: string }) => r.id)
      .filter((id: string) => !paidIds.has(id));
    if (unpaid.length) await db.from("songs").delete().in("id", unpaid);

    const { data: moved, error: moveErr } = await db
      .from("songs")
      .update({ user_id: context.userId })
      .eq("user_id", guest.id)
      .select("id");
    if (moveErr) return { ok: false as const, moved: 0, reason: "move_failed" };
    await db.from("unlocked_songs").update({ user_id: context.userId }).eq("user_id", guest.id);
    await guestClient.auth.signOut().catch(() => {});

    return { ok: true as const, moved: (moved ?? []).length };
  });
