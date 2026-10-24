import { createFileRoute } from "@tanstack/react-router";

// OG CARROM's server calls this when a guest who came from OG B0T's landing
// page picks a carrom username: it makes them an OG B0T account with that
// name (or the nearest free one), so they never sign up twice. Answers with
// the account id, the name used, a normal OG CARROM pass (so carrom links
// the profile the way it already does) and a one-time link back into OG B0T.
// Accounts start with no coins: welcome coins come later, on first sign-in,
// through the usual one-per-device check.

/** At most this many new carrom accounts an hour, whatever happens. */
const HOURLY_CAP = 300;
const RETURN_URL = "https://ogbot.co.uk/carrom-return";

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export const Route = createFileRoute("/api/public/carrom/register-guest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          token?: unknown;
          username?: unknown;
        } | null;
        const { verifyCarromGuestPass, isCarromUsername, guestNameCandidates, signCarromPass } =
          await import("@/lib/carrom-link.server");
        const guest =
          typeof body?.token === "string" ? await verifyCarromGuestPass(body.token) : null;
        if (!guest) return Response.json({ ok: false, reason: "invalid_pass" }, { status: 401 });
        if (!isCarromUsername(body?.username)) {
          return Response.json({ ok: false, reason: "invalid_username" }, { status: 400 });
        }
        const username = body.username;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        const finish = async (userId: string, name: string) => {
          const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
          const email = user?.user?.email;
          if (!email) throw new Error("account email missing");
          // One-time sign-in, opened from carrom's "Back to OG B0T" button.
          const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
          });
          if (error) throw new Error(error.message);
          const hash = link?.properties?.hashed_token;
          return Response.json({
            ok: true,
            userId,
            username: name,
            pass: await signCarromPass({ userId, name }),
            returnUrl: hash
              ? `${RETURN_URL}#t=${encodeURIComponent(hash)}`
              : "https://ogbot.co.uk/",
          });
        };

        // Claim the pass first, so two requests with it can't make two accounts.
        const { error: claimErr } = await db
          .from("carrom_guest_accounts")
          .insert({ guest_id: guest.guestId });
        if (claimErr) {
          if (claimErr.code !== "23505") {
            console.error("[carrom-guest] claim failed", claimErr);
            return Response.json({ ok: false, reason: "unavailable" }, { status: 503 });
          }
          // Already used: hand back the same account (a retry), or say it's busy.
          const { data: row } = await db
            .from("carrom_guest_accounts")
            .select("user_id, username")
            .eq("guest_id", guest.guestId)
            .maybeSingle();
          if (!row?.user_id) return Response.json({ ok: false, reason: "busy" }, { status: 409 });
          return finish(row.user_id, row.username ?? username);
        }
        const release = () =>
          db.from("carrom_guest_accounts").delete().eq("guest_id", guest.guestId);

        try {
          const hourAgo = new Date(Date.now() - 3600_000).toISOString();
          const { count } = await db
            .from("carrom_guest_accounts")
            .select("guest_id", { count: "exact", head: true })
            .gte("created_at", hourAgo);
          if ((count ?? 0) > HOURLY_CAP) {
            await release();
            return Response.json({ ok: false, reason: "busy" }, { status: 429 });
          }

          // The carrom name if no OG B0T member has it, else a numbered one.
          let name: string | null = null;
          for (const candidate of guestNameCandidates(username)) {
            const { data: taken } = await db
              .from("profiles")
              .select("id")
              .ilike("display_name", escapeLike(candidate))
              .limit(1);
            if (!taken?.length) {
              name = candidate;
              break;
            }
          }
          if (!name) {
            await release();
            return Response.json({ ok: false, reason: "name_taken" }, { status: 409 });
          }

          // A private placeholder address (never emailed): sign-in links need one.
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: `carrom-${guest.guestId.toLowerCase()}@players.ogbot.co.uk`,
            email_confirm: true,
            user_metadata: { display_name: name, source: "carrom" },
          });
          if (createErr || !created.user) throw new Error(createErr?.message ?? "create failed");
          const userId = created.user.id;
          // Record it straight away: from here a retry reuses this account.
          await db
            .from("carrom_guest_accounts")
            .update({ user_id: userId, username: name })
            .eq("guest_id", guest.guestId);
          // The sign-up trigger makes the profile; make sure it has this name.
          await db.from("profiles").update({ display_name: name }).eq("id", userId);
          await db.from("user_roles").insert({ user_id: userId, role: "user" });
          return finish(userId, name);
        } catch (e) {
          console.error("[carrom-guest] register failed", e);
          // Only free the pass if no account was made with it.
          const { data: row } = await db
            .from("carrom_guest_accounts")
            .select("user_id")
            .eq("guest_id", guest.guestId)
            .maybeSingle();
          if (!row?.user_id) await release();
          return Response.json({ ok: false, reason: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
