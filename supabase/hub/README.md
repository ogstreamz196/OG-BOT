# OG B0T in the OGSTREAMZ hub

OG B0T is moving off Lovable Cloud into the shared OGSTREAMZ database, as its
own `og_bot` schema, the same way OG Booking (`og_booking`) and Padel
(`padel`) live there. See `docs/lovable-exit-plan.md`. The hub's rules are in
the comment on its `public` schema.

These files are **not** in `supabase/migrations`, so Lovable never applies
them to Lovable Cloud.

| File                     | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_drift_from_live.sql` | Changes made on Lovable Cloud's live database that never reached `supabase/migrations` (8 tables, 6 columns, 18 functions, triggers, indexes, rules). Found by comparing a replay of every migration with the live schema.                                                                                                                                                                                                                                                                                      |
| `02_to_og_bot.sql`       | Turns the replayed copy into `og_bot`. It moves `public` and `private` into `og_bot` and fixes function bodies and search paths. It adds the sign-up trigger, which only fires for users tagged `app = og_bot` and never fails for other apps. It adds `ensure_member()`, which members call after Google sign-in or self sign-up because those can't carry the tag. It gives the D.EV emails admin, boss and dev access (hub rule 4). It sets access exactly as on Lovable Cloud and adds the realtime tables. |
| `og_bot_init.sql`        | **Generated**: the whole `og_bot` schema for the hub. Rebuild it with `scripts/hub/build-og-bot-init.sh`, which needs a local Postgres.                                                                                                                                                                                                                                                                                                                                                                         |
| `og_bot_rollback.sql`    | Removes `og_bot` and its two `auth.users` triggers. Nothing of any other app is touched.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `request.json`           | What the GitHub workflow should do next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Running it on the hub

1. **Add the secret.** In GitHub, open the repo's Settings → Secrets and variables → Actions. Add `OG_BOT_HUB_DB_URL`: the hub's connection string from the database dashboard (Connect → Session pooler). It goes only there, never in code or chat.
2. **Run the action.** Set `"action"` in `request.json` to `apply` and merge into `lovable-sync`. The workflow `.github/workflows/og-bot-hub.yml` runs it and writes the counts to the run summary. It refuses to apply twice.
3. **Expose the schema.** In the hub's dashboard, go to Settings → API → Exposed schemas and add `og_bot` (hub rule 5).

The other actions are `verify` (counts only) and `rollback`.

## Checked locally (2026-10-31)

- **Matches live.** The replay plus `01` matches Lovable Cloud's live schema object for object: every table, column, function, access rule, trigger, constraint and index. The storage buckets differ, because they were made outside migrations; files move in a later step.
- **Safe in a hub with other apps.**
  - `og_bot_init.sql` applies in one transaction on a fake hub that already has Vault in `public` and Booking's own sign-up trigger.
  - A Booking sign-up doesn't create an OG B0T profile.
  - A D.EV account gets admin, boss and dev.
  - Rolling back leaves Booking's data and trigger intact.

## Still to do in later steps

- **Song files (1.9 GB):** they go to Cloudflare R2, because the hub's file storage is 1 GB and is shared by every app.
- **Scheduled jobs:** these are Lovable Cloud's `pg_cron` jobs (signal scan, signal watch, song retries, reminders, daily coin floor, VIP expiry). They become Cloudflare Worker cron triggers.
- **New-member alert URL:** `notify_boss_new_user` still points at the Lovable app URL. It changes when hosting moves.
- **Data:** members, their data and the copy itself are step 5.
