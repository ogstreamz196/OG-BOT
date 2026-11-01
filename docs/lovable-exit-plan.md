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
- [x] ~~Decide about the restored OG-BOT database project~~: paused on
      2026-10-31 (the Boss's call). OGSTREAMZ is the only active project.

### For steps 3 to 5 (the Boss's list, written 2026-11-01)

The Boss wants off Lovable mainly so database changes stop going through
paid Lovable migration prompts. The partner's Claude does the takeover (the
Boss's call). Keys and passwords never go in chat: each goes straight into
the dashboard named.

**A. Cloudflare (hosting)**

- [ ] **Workers Paid ($5 a month)**: Cloudflare → Workers & Pages → Plans.
      The free plan's CPU limit per request is far too small for the scanner
      and the learning loop (Lovable pays this today).
- [ ] **ogbot.co.uk on Cloudflare**: listed under Websites; if not, add the
      site and change the nameservers at the registrar.
- [ ] **API token**: My Profile → API Tokens → "Edit Cloudflare Workers"
      template, plus Zone → DNS → Edit for ogbot.co.uk.
- [ ] **GitHub secrets** (OG-BOT repo → Settings → Secrets and variables →
      Actions): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, so every
      merge publishes itself.
- [ ] **Worker secrets** (Cloudflare → Workers & Pages → the Worker →
      Settings → Variables and Secrets), copied from Lovable's secrets page
      once the Worker exists. From the code: `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `OG_BOT_TOKEN`,
      `SIGNALS_BOT_TOKEN`, `SIGNALS_CHANNEL_ID`, `TELEGRAM_CREDENTIAL_KEY`,
      `TELEGRAM_WEBHOOK_SECRET`, `OG_BOT_REMOTE_MINT_SECRET`, `GEMINI_API_KEY`,
      `GROQ_API_KEY`, `GROQ_BACKUP_API_KEY`, `OPENROUTER_API_KEY`,
      `OPENROUTER_BACKUP_API_KEY`, `PERPLEXITY_API_KEY`, `METAAPI_TOKEN`,
      `METAAPI_ACCOUNT_ID`, `METAAPI_REGION`, `SUNO_API_KEY`,
      `STRIPE_SECRET_KEY`, the three `GOOGLE_OAUTH_*`, and the build values
      `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
      `VITE_SUPABASE_PROJECT_ID`, `VITE_STRIPE_PUBLISHABLE_KEY`. Check the
      list again against `process.env` / `import.meta.env` before asking.

**B. The hub database**

- [ ] **Expose `og_bot`** (the item above).
- [ ] **Hub secret key**: OGSTREAMZ → Settings → API → secret (service role)
      key, into the Worker secrets.
- [ ] **A quiet half hour for switch day** (final data copy behind a short
      maintenance notice).

**C. Sign-in and login emails** (Lovable today: `cloud-auth-js`,
`src/routes/lovable/email`)

- [ ] **Google sign-in**: Google Cloud Console → the "OG Vault" OAuth client →
      add `https://ogbot.co.uk` to authorised origins and check the hub's
      callback is in the redirects (the vault likely added it). Supabase →
      Authentication → URL Configuration: add `https://ogbot.co.uk` and
      `https://beta.ogbot.co.uk`.
- [ ] **Apple sign-in: keep or drop?** Needs an Apple Developer account
      (£79 a year). Dropped, those members use email or Google.
- [ ] **Login emails**: a free Resend account with ogbot.co.uk as a sending
      domain (a Claude can add its DNS records with the token), then its SMTP
      details into Supabase → Authentication → Emails → SMTP.

**D. Payments**

- [ ] **Stripe**: today it's Lovable's managed payments (`stripe.server.ts`
      routes through the connector gateway, `VITE_PAYMENTS_CLIENT_TOKEN`).
      Check it's the Boss's own Stripe account, then a restricted secret key,
      a webhook to the new address, and the publishable key, into the Worker.

**E. Google Drive** (songs play from the Boss's Drive since #189, through
the connector gateway)

- [ ] **One Google sign-in for Drive**: the Boss signs in with the account
      that owns the songs and presses Allow once (a Claude gives the link);
      the three `GOOGLE_OAUTH_*` values go into the Worker. Without it songs
      stop playing off Lovable.

**F. Song and lyric functions** (`supabase/functions`: suno-\*, song-url,
generate-lyrics, lyric-video, og-interview, reveal-variation,
unlock-full-song, admin-reprocess)

- [ ] **Their secrets in the hub**: Supabase → OGSTREAMZ → Edge Functions →
      Secrets: the Gemini keys, `SUNO_API_KEY`, `OG_BOT_TOKEN`,
      `TELEGRAM_API_KEY` if still used, `OG_BOT_SITE_URL`.

**G. After switch day**

- [ ] **Keep Lovable a week as a safety net**, then downgrade it.

**Note on cost:** the hub is on Supabase's free plan. OG B0T's minute jobs
should fit; if the hub hits its limits, Supabase Pro is $25 a month.

### What the other projects show (checked by the Boss's Claude, 2026-11-01)

- **og-booking-portal** is the model: Cloudflare Pages connected to GitHub
  (push to `main` deploys, PRs get previews), `wrangler.toml` holds the
  plain variables and the dashboard holds the secrets, CI type-checks,
  tests, builds and applies every migration to a throwaway Postgres. Its
  data is in the hub's `og_booking` schema; new migrations go in
  `supabase/migrations/` and are applied to the hub one file at a time
  (Claude through the Supabase connection, or the SQL editor), never
  `supabase db push` (the hub carries other apps' history).
- **OG-VAULT-REACT** is halfway: data in the hub's `public` schema, but still
  hosted by Lovable (vault.ogstreamz.co.uk is a Cloudflare Worker proxy in
  front of the Lovable app). It's TanStack Start like OG B0T.
- **So OG B0T needs Cloudflare Workers, not Pages** (server functions, minute
  jobs); the Lovable preset already builds for Cloudflare with Nitro.
- **Lovable pieces still in use** (beyond step 1's connector gateway):
  Lovable payments for Stripe, `cloud-auth-js` sign-in, the Lovable email
  hook, `src/integrations/lovable`, `lovable-error-reporting.ts`, and
  `LOVABLE_API_KEY` in the edge functions.

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

**Verification:** `docs/migrations-checklist.md` lists every migration and
the switch-day checks; `supabase/hub/verify_migrations.sql` (read only)
returns whatever the hub is missing. Last result: 2026-11-01, all 530
objects from the 215 migrations and the recorded drift are in `og_bot`
(no rows). Run it again, on the hub and on Lovable Cloud, on switch day.

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
