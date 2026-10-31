# Claude sync log

Both Claudes (the Boss's and the partner's) read this before starting and
add to it before merging. See `CLAUDE.md` for the routine.

## In progress

<!-- One line per open task: who · branch · what · files it touches -->

- Partner's Claude · `lovable-exit` · Leaving Lovable step by step (plan in
  `docs/lovable-exit-plan.md`). Step 1 (own keys for Telegram, Google, Stripe)
  in this PR; steps 2–5 to follow. Touches the Telegram/Google/Stripe callers
  in `src/lib/*.functions.ts`, `telegram/webhook.ts` (secret check only) and,
  later, `vite.config.ts`, auth and email routes.

## Log

<!-- Newest first. Who · date · PR · what changed · migration? · anything left for later -->

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
