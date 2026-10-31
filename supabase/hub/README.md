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

## Applied (2026-10-31, partner's Claude)

- **Structure.** `og_bot_init.sql` (commit 6ac2f97) is in the hub as the
  migration `og_bot_init`. It was applied through the database connection,
  not the GitHub workflow: the hub fetched the exact file from GitHub and
  checked its md5 before running it. Result: 81 tables, 117 functions, 119
  rules and 10 realtime tables. Vault and Booking are untouched. The
  workflow's `apply` now refuses because `og_bot` exists; `verify` and
  `rollback` still work once `OG_BOT_HUB_DB_URL` is set.
- **Data, as a snapshot.** Copied at 22:40–22:53 UTC: 106 members into
  `auth.users`, with password hashes and Google links (the two D.EV
  accounts already existed, and their rows were pointed at the hub's ids),
  plus every row of every `og_bot` table. Per-table counts match Lovable
  Cloud at the time of the copy. The live app keeps writing to Lovable, so
  this goes stale: copy again at the switch.
- **Passwords carry over.** A dummy account signed up on the live site
  could sign in to the hub with the same password, and a wrong password was
  refused. Both sides store bcrypt `$2a$10$`. The dummy was deleted on
  Lovable; in the hub it still waits on a Boss-approved delete.

## How the data copy works (to run it again at the switch)

Only the database connections are needed, no secrets:

1. Deploy a temporary edge function `og-bot-import` in the hub
   (`verify_jwt` off, a fresh one-time token). It takes
   `{token, schema, table, rows}`, maps the two D.EV ids, and inserts with
   `jsonb_populate_recordset … on conflict do nothing`. It must open one
   connection per request and close it (`sql.end()`).
2. Pause `og_bot`'s user triggers during the copy (`disable trigger user`),
   so copied rows don't pay referrals, send alerts and so on.
3. From Lovable Cloud's database, `net.http_post` the rows in this order:
   `auth.users`, `auth.identities`, then the tables in foreign-key waves.
   **At most 10 requests at a time and at most 250 rows each.** Lovable's
   sender only goes out once a minute, and bigger batches can fail with an
   HTTP/2 stream error.
4. Compare per-table counts, turn the triggers back on, move the sequences
   past the copied rows, and switch the endpoint off.

**Lesson (incident, 22:42–22:43 UTC):** the first attempt sent about 95
requests at once, and the function kept every connection open. For about a
minute the hub ran out of connections. Vault, Booking and OG B0T were
checked afterwards and all answered normally. Never send more than 10 at a
time.
