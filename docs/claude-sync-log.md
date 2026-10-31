# Claude sync log

Both Claudes (the Boss's and the partner's) read this before starting and
add to it before merging. See `CLAUDE.md` for the routine.

## In progress

<!-- One line per open task: who · branch · what · files it touches -->

- Partner's Claude · (next branch) · Leaving Lovable, steps 2–5 (plan in
  `docs/lovable-exit-plan.md`): waiting on the Boss's database-project
  choice. Will touch `vite.config.ts`, a new `wrangler.jsonc`, sign-in and
  `src/routes/lovable/email`.

## Log

<!-- Newest first. Who · date · PR · what changed · migration? · anything left for later -->

- **Partner's Claude · 2026-10-31 · #164** · Leaving Lovable, step 1
  (`docs/lovable-exit-plan.md`): `src/lib/connectors.server.ts` sends
  Telegram, Google Drive/Sheets and Stripe calls straight to the real API
  when that service's own key is set (`OG_BOT_TOKEN`; `GOOGLE_OAUTH_CLIENT_ID`
  + `_SECRET` + `_REFRESH_TOKEN`; `STRIPE_SECRET_KEY`), else through the
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
