# Moving OG B0T off Lovable

Five steps, in order. Every step is reversible, and the live app keeps running
on Lovable until the final switch (step 5). Each step's work and progress is
logged in `docs/claude-sync-log.md`.

Keys and passwords never go in chat or in the repo. They go only in the
Lovable secrets form (today) or the Cloudflare and Supabase dashboards
(later).

## Boss's to-do

Things only the Boss can do. Claudes: remind the Boss when work is waiting
on one of these, and tick it off here once done.

- [x] ~~Add the hub database secret in GitHub~~: no longer needed. The
      structure was applied through the database connection on 2026-10-31. The
      secret only matters for the workflow's `verify` and `rollback`.
- [ ] **After the apply:** in the OGSTREAMZ dashboard, go to Settings → API →
      Exposed schemas and add `og_bot`.
- [ ] **Decide about the restored OG-BOT database project.** It's empty and
      unused, since OG B0T is staying in the hub. It could be paused again.

## Step 1 · Own keys for connected services (done in PR #164)

Today Telegram, Google Drive, Google Sheets and Stripe calls can go through
Lovable's connector gateway (`connector-gateway.lovable.dev`, using
`LOVABLE_API_KEY`). `src/lib/connectors.server.ts` now sends each call
straight to the real service when that service's own key is set, and through
the gateway otherwise.

| Service               | Own key(s)                                                                                                       | Status today                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Telegram (main bot)   | `OG_BOT_TOKEN`                                                                                                   | Already set: the main helper already used it. Now every caller uses it. |
| Google Drive + Sheets | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (the Boss's Google account) | New. Until they're set, the gateway is used.                            |
| Stripe                | `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET`)                                                                  | Already supported by `stripe.server.ts`.                                |

**Telegram webhook.** It used to accept only a secret derived from Lovable's
`TELEGRAM_API_KEY`. It now accepts that one, one derived from `OG_BOT_TOKEN`,
or `TELEGRAM_WEBHOOK_SECRET`, so it keeps working once Lovable's key is gone.
Pressing **Re-register webhook** registers the first one available.

**Google keys.** Create these in Google Cloud for the Boss's account:

1. Create an OAuth client of type "Web application".
2. Use the OAuth Playground with your own credentials. Select the scopes
   `https://www.googleapis.com/auth/drive` and
   `https://www.googleapis.com/auth/spreadsheets`, then exchange for a
   refresh token.
3. Set the consent screen to "In production". In "Testing", refresh tokens
   expire after 7 days.

The files stay in the same Drive (the Boss's), so nothing moves.

**Stripe caution.** If Lovable's payments connector is not the Boss's own
Stripe account, switching to `STRIPE_SECRET_KEY` points at a different
account. Existing customers, subscriptions and webhooks would not be there.
Check that in the Stripe dashboard before setting it. Webhooks then need an
endpoint in the Boss's account with its signing secret in
`STRIPE_WEBHOOK_SECRET`.

**Undo:** remove the own key. That service goes back through the gateway.

## Step 2 · OG B0T's database inside the OGSTREAMZ hub (prepared in PR #165)

The Boss chose to keep OG B0T in the OGSTREAMZ hub, as its own `og_bot`
schema next to `og_booking` and `padel` (free plan, shared). Files and
details are in `supabase/hub/README.md`.

**Findings:**

- **Database size.** OG B0T's tables are 11 MB (the hub is 15 MB of 500 MB),
  and it has 108 members.
- **Shared accounts.** The only accounts already in the hub are the two
  D.EV emails, as expected.
- **Files.** Stored files total 1.95 GB, almost all of it song files. That's
  more than the hub's 1 GB, so song files go to Cloudflare R2 (hub rule 7).
- **Repo history.** `supabase/migrations` was incomplete: Lovable changed the
  live database directly. `supabase/hub/01_drift_from_live.sql` records those
  changes, and the result was checked object by object against live.
- **Sign-ups.** OG B0T's sign-up trigger only acts on users tagged
  `app = og_bot`. Google and self sign-ups call `og_bot.ensure_member()` after
  sign-in.

**To apply:**

1. Add the GitHub secret `OG_BOT_HUB_DB_URL`.
2. Set `supabase/hub/request.json` to `apply` and merge.
3. Add `og_bot` to the hub's exposed schemas.

Nothing live uses it until step 5.

**Undo:** the `rollback` action (`og_bot_rollback.sql`).

## Step 3 · Cloudflare Workers hosting, tested on beta.ogbot.co.uk

The build already uses Lovable's Vite preset, which targets Cloudflare.

1. Replace `@lovable.dev/vite-tanstack-config` with the plain plugins it
   wraps (TanStack Start, React, Tailwind, tsconfig paths, Nitro with
   Cloudflare). Lovable's MCP plugin is kept only while on Lovable.
2. Add `wrangler.jsonc` and a GitHub Action that deploys `lovable-sync` to a
   Worker on `beta.ogbot.co.uk`. Secrets go in the Worker's settings.
3. Point beta at the new database from step 2 and test everything there.
   Live stays on Lovable.

**Undo:** delete the Worker and its DNS record.

## Step 4 · Own sign-in and login emails

1. **Google and Apple sign-in.** Today they use Lovable's `cloud-auth-js`.
   Move them to the database's own OAuth: the shared "OG Vault" Google client
   for Google, and an Apple Developer account (paid yearly) for Apple. Add the
   site's URL to the allowed redirects.
2. **Login emails.** Today `src/routes/lovable/email` is Lovable's email
   hook. Move to the database's built-in auth emails sent through a free SMTP
   provider (for example, Resend's free tier), with the same templates.
3. Both are behind a switch, tested on beta first.

**Undo:** switch back to the Lovable path.

## Step 5 · Data copy and the switch

1. Freeze writes briefly, with a maintenance notice.
2. Copy data in one go, table by table, from Lovable Cloud into the new
   project. Copy storage files too.
3. **Passwords.** Accounts keep their bcrypt hashes in `auth.users`. If the
   copy can read `encrypted_password`, passwords carry over unchanged. Test
   this first with a dummy account: create it on Lovable, copy it, sign in on
   beta with the same password. If hashes can't be read, members get a
   "set your password" email, and Google sign-in members are unaffected.
4. Point the domain at the Worker. Re-register the Telegram webhook, and the
   Stripe and Suno callback URLs if they changed.

**Undo:** point the domain back at Lovable. Lovable's database is left
untouched, so writes made after the switch would need copying back.
