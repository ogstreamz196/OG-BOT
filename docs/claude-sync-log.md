# Claude sync log

Both Claudes (the Boss's and the partner's) read this before starting and
add to it before merging. See `CLAUDE.md` for the routine.

## In progress

<!-- One line per open task: who · branch · what · files it touches -->

- Partner's Claude · (next branch) · Leaving Lovable, steps 3–5 (plan in
  `docs/lovable-exit-plan.md`): Cloudflare beta hosting, own sign-in and
  emails, data copy. Will touch `vite.config.ts`, a new `wrangler.jsonc`,
  sign-in, `src/routes/lovable/email` and the database client's schema.
  **Paused (checked by the Boss's Claude, 2026-10-31):** the partner's
  Claude ran out of usage before starting this; no branch or PR exists for
  it yet. Pick up from step 3 in `docs/lovable-exit-plan.md`.

## Where things stand (handover)

<!-- Whoever finishes a session updates this so the other Claude can pick up. -->

Updated by the Boss's Claude, 2026-10-31, after #184. The Boss pressed
Purge & start at $1,000 at 16:40; the demo runs from there. Nothing open: no open
PRs, nothing in progress from the Boss's Claude. Old branches on GitHub are
merged work, not open work.

- **Partner's Claude (updated 2026-10-31, 17:00):** back after a pause the
  Boss asked for; no open PRs or branches of its own. Since #180 it has only
  read live state and written this note. Live at 16:59 UTC: Purge & start
  ran at 16:40:25 (`signals.chat.purgedAt`), demo `{start: 1000}` from then.
  The first card after it (BTC sell, 16:45) is in the four-line layout with
  dollars on 0.05 lot (`why`: "76% sure, 20 calls like it lost -0.3R on
  average") and is still open. A BTC sell from 16:40:20, five seconds before
  the purge, is also still open: it's followed quietly and doesn't count.
  The dollar live line ("📍 … (+$…) · time") on a card update hasn't been
  seen yet; check the 16:45 card's next update. Partner's Claude's own open
  work is only leaving Lovable steps 3–5 (paused, see **In progress**).
- **Both Claudes fixed the same failing tests at once** (#180 merged, the
  Boss's Claude's #181 closed unmerged as a duplicate). To stop that: put
  your line under **In progress** and push it _before_ you start, even for a
  five-minute fix.
- **Published and checked by Lovable (2026-10-31):** everything up to #182.
  712 tests pass, 6 skipped, none failing (the 6 signal checks included);
  type check clean. Seen working: API keys (Telegram "own key"), the demo
  panel (started with $1,000, balance $988.40 at the time, Purge & start
  text mentions the announcement), Boss search, friendship memory table. The
  hub folder is in the project but nothing from it was applied to Lovable
  Cloud (correct). Not checkable by Lovable: the signals chat itself
  (four-line cards, cash updates, the results post); the Boss checks it. The Boss has the publish
  prompts; if a later check shows the signals chat still in the old long
  layout or in points, Lovable hasn't published yet.
- **Signals chat, as the Boss wants it now:** four-line cards
  (`compactCard`), short updates in cash on the demo's lot (`chatLine`,
  `chatLiveLine`), a results post with streak, last ten, win rate, each
  market in cash and "💰 Balance" (`resultsAnnouncement`). Keep it clutter
  free; the Boss reviews layout before it ships ("show me first").
- **Trade management:** lots 0.05 to 0.3 learned from wins and losses
  (`chooseLot`), the 70/30 profit lock (`PROFIT_LOCK`), take profit moves
  (`tpMove`). Rules in AGENTS.md.
- **Open ideas, not started:** teach the learning loop to replay take profit
  moves (`feeds.tpMoves` is being recorded); count a profit-lock exit as a
  win in the counter (Boss hasn't decided); drop the time in front of each
  card update (offered, no answer yet).
- **Boss's to-dos:** GitHub secret `OG_BOT_HUB_DB_URL` (step 2 of leaving
  Lovable waits on it), expose `og_bot` after the apply, Google keys,
  check the Stripe account before `STRIPE_SECRET_KEY`. OG-BOT and O.G VAULT
  database projects are paused on purpose; OGSTREAMZ is the only active one.
- **Leaving Lovable steps 3 to 5:** the partner's Claude's, paused (see In
  progress).

## Log

<!-- Newest first. Who · date · PR · what changed · migration? · anything left for later -->

- **Boss's Claude · 2026-10-31 · #186** · The Boss saw 1 win, 3 losses and a
  balance of $1,002.15 in the results post. Cause: the counter counted every
  70%+ signal since the reset from any chat (members' own requests, trades
  from before the purge), while the balance and markets counted only the
  demo's trades. Now, while the demo runs, the whole post comes from the
  demo's own trades (`demoTally`): a win made money, a loss lost it, so it
  always adds up. No migration.

- **Partner's Claude · 2026-10-31 · #185** · Notes only: partner's state in
  **Where things stand** (live check after the 16:40 Purge & start), and the
  done "press Purge & start" to-do taken off the Boss's list.

- **Boss's Claude · 2026-10-31 · #184** · "No need to give life story": the
  "money where my mouth is" post is three lines (`demoAnnouncement`) and the
  Vantage intro one short line (`VANTAGE_INTRO`). Keep chat posts short. No
  migration.

- **Boss's Claude · 2026-10-31 · #183** · Notes only: Lovable published and
  checked everything up to #182 (712 pass, none failing); recorded in
  **Where things stand**.

- **Partner's Claude · 2026-10-31 · #180** · Lovable's publish check showed
  6 failing tests (alert repeats, the 15-minute wait after a stop, trades side
  by side, and 2 desk-scout tests). Cause: `chatPurgedAt()` reads the live
  database, and Lovable's build machine has it. Since the Boss's purge there
  is a real purge time, and the tests' pretend October clock makes every
  pretend alert look older than it. Test-only fix: both files mock
  `chatPurgedAt` to null. Reproduced the failure and confirmed the fix with a
  live purge time simulated. Live alerts are unaffected (they're always
  stamped after the purge). **Any new test that runs the scan must mock
  `chatPurgedAt` the same way.** No migration.

- **Partner's Claude · 2026-10-31 · #179** · The Boss wants a full fresh start
  now: "Purge & start" (freshStart) posts OG B0T's "money where my mouth
  is" announcement (`demoAnnouncement(start, true)`: chat cleared, counter
  from zero) instead of `testModeNote` (kept, unused). The Boss presses Purge
  & start at $1,000 after publishing. Trade and learning data is never
  deleted (#170). No migration.

- **Boss's Claude · 2026-10-31 · #178** · Correction to #177: Claude sessions
  can't delete GitHub branches, so `CLAUDE.md` now says a branch is open work
  only with an open PR or an **In progress** line. Docs only.

- **Boss's Claude · 2026-10-31 · #177** · Handover tidy-up: real PR numbers
  in the log, a **Where things stand** section at the top for whoever picks
  up next, and two steps added to `CLAUDE.md` (keep that section current;
  how to tell open work from old branches). Today's branches stay on GitHub
  (sessions can't delete branches); all of them are merged. Docs only.

- **Boss's Claude · 2026-10-31 · #176** · Signals chat talks in money:
  the tracker's updates there are short and in cash on the demo's lot
  (`chatLine`, `chatLiveLine`, `chatTpMoveLine`), and the closing line shows
  the demo's own result. Members' own chats keep the old wording. No migration.

- **Boss's Claude · 2026-10-31 · #175** · Open signals-chat cards posted in
  the old long layout switch to the compact one on the tracker's next pass
  (`compactCard` on `row.card`, saved back). No migration.

- **Boss's Claude · 2026-10-31 · #174** · Results post clutter free (Boss's
  ask): header, streak line, last 10 as ✅/🛑, "🏆 75% win rate · ✅ 3 · 🛑 1",
  each market in cash from the demo ("₿ Bitcoin −$17.30", `paperByMarket`)
  instead of pips, and "💰 Balance: $…" (no "$1,000 DEMO", no change since
  start, since date or running/cancelled). A closed trade's card line is just
  "💰 +$… on this one". No migration.

- **Boss's Claude · 2026-10-31 · #173** · Signals-chat cards trimmed to
  what the Boss wants: the trade, the stop, the take profit (with the demo
  lot's money) and timeframe and confidence (`compactCard` in
  `signal-broadcast.server.ts`). No balance, lot or why lines, no profit-lock
  line, no "Every timeframe agrees" heading: the results post covers the
  balance. Cards for members' own requests are unchanged. No migration.

- **Boss's Claude · 2026-10-31 · #172** · The take profit moves while a
  trade runs, always announced (Boss's ask): further out while price is still
  pushing hard right by it, in when it stalls short and pulls back (`tpMove`,
  `TP_MOVE` in `trade-signal-outcome.ts`; tracker posts it in the card's
  journal; MT5 follows via `moveTakeProfit`). `feeds.tp0` keeps the original
  (the profit lock stays on it), `feeds.tpMoves` records each move for later
  learning. No migration. Open: the learning loop doesn't replay moves yet.

- **Boss's Claude · 2026-10-31 · #171** · Demo lots and a profit lock, on
  the Boss's say-so. Lots now go 0.05 to 0.3 (the Boss's limit) in 0.05
  steps, learned from wins and losses (`chooseLot`, `lotInputs` in
  `paper-account.server.ts`): confidence, how calls like it did lately (in
  risks), smaller after losses in a row or a drop from the best balance, the
  stop never risking over 5% of the balance. Every card says why. **Profit
  lock** (`PROFIT_LOCK`, `profitLock` in `trade-signal-outcome.ts`): 70% of
  the way to TP1, the stop moves to 30% of the way; replaces the learned
  breakeven (`Tuning.beAt` retired), the learning loop judges with it too,
  MT5 stop follows it. Older signals keep their old rule. No migration.

- **Boss's Claude · 2026-10-31 · #170** · **Boss's rule, for both
  Claudes: trade and learning data is never deleted, ever.** "Purge" means
  the Telegram chat and the counters only. Removed the three automatic
  clean-ups that broke it: `signal_learn_samples` over 120 days, samples from
  an older `SAMPLE_VERSION`, and `signal_shadows` over 120 days. They stay
  stored now, and the reads already only take the window they need. New
  guard test `src/lib/trade-data-kept.test.ts` fails if any code or migration
  deletes from `trade_signals`, `signal_learn_samples` or `signal_shadows`;
  add a table to its `KEPT` list when you add learning data. `CLAUDE.md`
  house rule spelled out. No migration.

- **Boss's Claude · 2026-10-31 · #169** · On the Boss's say-so, the empty
  OG-BOT database project is paused; O.G VAULT was already paused. The only
  active project in the org is now the OGSTREAMZ hub (the live app still runs
  on Lovable Cloud, which is separate and untouched). Restore OG-BOT only if
  the Boss asks. Docs only.

- **Boss's Claude · 2026-10-31 · #168** · Progress check after the
  partner's Claude ran out of usage, read-only apart from this log: #164–#167
  all merged, no open PRs, no unmerged branches. Type check and build pass;
  the tests pass (one run hit a timing flake in the BTC card test under load,
  then two clean full runs). Databases: the OGSTREAMZ hub has no `og_bot`
  tables yet (step 2 not applied, `supabase/hub/request.json` is `none`,
  waiting on the Boss's `OG_BOT_HUB_DB_URL` GitHub secret); the OG-BOT project
  is active and empty; O.G VAULT is paused. Steps 3–5 not started. Docs only.

- **Partner's Claude · 2026-10-31 · #167** · Built on the Boss's Claude's test
  account (#159/#160): a $1,000 demo that starts **without** a purge, so the
  chat and the win/loss counter stay (`demoStart`, Boss button "Start the …
  demo, keep the chat and counter", or signal-scan `{"demoStart": true}`). OG
  B0T posts a one-off "money where my mouth is" announcement, and the results
  post now ends with the live demo balance (`demoLine`). Refuses if a test
  account is already running. No migration. Open: the Boss presses the button
  once after publishing.

- **Partner's Claude · 2026-10-31 · #166** · Added a "Boss's to-do" list at the
  top of `docs/lovable-exit-plan.md`: the GitHub secret `OG_BOT_HUB_DB_URL`
  (step 2 waits on it), exposing `og_bot` after the apply, and the restored,
  empty OG-BOT database project. Also outside the repo: Vault confirmed fully
  on the hub, Vault's 119 older install-history rows copied into the hub
  (checksums match), the old O.G VAULT project paused, OG-BOT project
  restored (empty). OG B0T stays in the hub. Docs only.

- **Partner's Claude · 2026-10-31 · #165** · Leaving Lovable, step 2
  prepared: OG B0T's whole database structure as the `og_bot` schema for the
  OGSTREAMZ hub (Boss's choice), in `supabase/hub/` (not
  `supabase/migrations`, so Lovable never applies it). Found and recorded the
  live changes Lovable made outside the migrations (`01_drift_from_live.sql`);
  the result matches live object for object. `scripts/hub/build-og-bot-init.sh`
  rebuilds `og_bot_init.sql`; `.github/workflows/og-bot-hub.yml` applies,
  verifies or rolls it back when `supabase/hub/request.json` changes on
  lovable-sync (secret `OG_BOT_HUB_DB_URL`). Nothing applied to the hub yet.
  No Lovable migration. **If you add a migration on Lovable, run the build
  script again** so the hub copy keeps up.

- **Partner's Claude · 2026-10-31 · #164** · Leaving Lovable, step 1
  (`docs/lovable-exit-plan.md`): `src/lib/connectors.server.ts` sends
  Telegram, Google Drive/Sheets and Stripe calls straight to the real API
  when that service's own key is set (`OG_BOT_TOKEN`; `GOOGLE_OAUTH_CLIENT_ID`
  - `_SECRET` + `_REFRESH_TOKEN`; `STRIPE_SECRET_KEY`), else through the
    gateway as before. Every gateway caller now uses it. The Telegram webhook
    accepts the old secret and one derived from `OG_BOT_TOKEN` (or
    `TELEGRAM_WEBHOOK_SECRET`). API keys health page shows "own key" or
    "gateway". No migration. Open: the Google keys aren't set yet, so Google
    still uses the gateway; check whether Lovable's Stripe connector is the
    Boss's own Stripe account before setting `STRIPE_SECRET_KEY`.

- **Boss's Claude · 2026-10-31 · #163** · Desktop header had no room at
  1280–1440 (logos squashed, title cut): removed the header "Search songs"
  box, which did nothing (nothing listened to its `sonix:search` event; the
  Music page has its own search boxes); the brand lockup no longer shrinks,
  the title takes the rest and is text-xl until 2xl. `AppShell.tsx` only. No
  migration.
- **Boss's Claude · 2026-10-31 · #162** · Added `CLAUDE.md` (the routine
  both Claudes follow) and this log. No migration.
- **Boss's Claude · 2026-10-31 · #161** · Phones: focused fields scroll clear
  of the sticky header and the bottom menu (scroll-padding). Desktop: header
  "Powered by" words only at 2xl, brand area clipped to its column. No
  migration.
- **Boss's Claude · 2026-10-31 · #160** · Boss → OG Bot → Telegram: "Signals
  chat: start fresh" panel (new start balance + Purge & start). A purge
  deletes no stored data; it notes `signals.chat.purgedAt`. No migration.
  The Boss hasn't pressed it yet (no test account running).
- **Boss's Claude · 2026-10-31 · #159** · $1,000 test account (Vantage
  Standard STP) on every signals-chat alert: 0.1 lot, 0.3 on extremely
  confident quick scalps; balance on every card; P&L on Vantage bid/ask.
  `paper-account.server.ts`, `signals-fresh-start.server.ts`. No migration.
- **Boss's Claude · 2026-10-31 · #154–#158** · Signals learn their own
  entries, exits and take profits on Vantage: Vantage quotes and spread
  model (`broker-quotes.server.ts`), bid/ask hit rules, learned breakeven and
  runner (MT5 stop moved to entry), learned entry style, learned stop and
  take-profit pads around real levels, walk-forward learning test.
  `SAMPLE_VERSION` is 3. No migrations.
- **Boss's Claude · 2026-10-30 · #145–#152** · Gold from Binance's XAUUSDT
  perpetual, 90-day growing learning history (`signal_learn_samples`
  migration), shadow trades (`signal_shadows` migration), Boss signal report,
  timing (learned time stops, blackouts), pair checks (dollar, order flow),
  15-minute scalps, learned alert bar, AI desk daily budget, learned filters.
