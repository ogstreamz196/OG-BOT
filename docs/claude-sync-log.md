# Claude sync log

Both Claudes (the Boss's and the partner's) read this before starting and
add to it before merging. See `CLAUDE.md` for the routine.

## In progress

<!-- One line per open task: who · branch · what · files it touches -->

- Partner's Claude · (next branch) · Leaving Lovable, steps 3–5 (plan in
  `docs/lovable-exit-plan.md`). **The Boss wants the partner's Claude to do
  the takeover (2026-11-01).** The Boss's list for steps 3–5 and what the
  booking portal and vault show are in the plan's "For steps 3 to 5" and
  "What the other projects show". Will touch `vite.config.ts`, a new
  `wrangler.jsonc`, a deploy workflow, sign-in, `src/routes/lovable/email`,
  the database client.

## Planned (not started)

<!-- The Boss's shared to-do list: ideas agreed but not built yet. -->

- **OG VAULT (repo og-vault-react, branch main, database = the hub's
  `public` schema, so changes can be applied straight to the hub with
  the database tools):**
  - Done (PR #5 there, 2026-11-03): automatic installs on the Firestick
    through its own ADB, with a build check after. Native part needs store
    APK 1.2.0 (versionCode 3) built in Android Studio and published in Boss
    Controls → Store Updates. Details in that repo's AGENTS.md.
  - Done (OG VAULT PRs #6–#12): Admin tier, Admin Apps, My Apps (uploads
    up to 200 MB, Downloader codes), activity log, the dev.b033 PIN login
    (PIN set in Boss Controls → Members) and member PINs after a streaming
    sign-in. See that repo's AGENTS.md.
  - Done (OG VAULT PRs #14–#19, 2026-11-03): "Stream profile expiry" with
    a live countdown under the header (the stream login's end date, kept on
    the login); sign-in screen shows username + password and a PIN pad side
    by side; member PINs are 6+ digits, unique, and sign in on their own;
    the Boss has no PIN or password rules and can set any member's PIN; the
    dev login is now **dev.b055** (renamed from dev.b033, same account); the
    activity log is full, in plain words, by UK day, and records sign-ins.

- **OG KEYS**, the Boss's own password and API key manager, later an
  add-on like OG Ledger. Plan in `docs/og-keys-plan.md`. A coming-soon card
  is on the home pages and the Boss's API vault (System → API keys) is its
  first piece. Waiting on the Boss (low on credits) and an empty repo.

## Where things stand (handover)

<!-- Whoever finishes a session updates this so the other Claude can pick up. -->

- **Partner's Claude (2026-11-06, dev.b055 done):** dev.b055 + PIN works
  the same in OG B0T (#247), OG VAULT (OG-VAULT-REACT#25), the booking
  portal (og-booking-portal#30) and Padel Rival (PADEL-RIVAL-REACT#1), all
  merged. Waiting on the Boss for three things:
  - the hub Vault secret `dev_b055_pin`
  - the Lovable secret `OG_HUB_SERVICE_KEY` on Padel Rival
  - publishing OG VAULT and Padel Rival in Lovable (not in the workspace
    a Claude can reach)

  Cloudflare check: ogbot.co.uk isn't on Cloudflare yet (only
  fireunlock, ogstreamz and padelrival are).

- **Partner's Claude (2026-11-06):** #246 merged and published (no
  migrations). Next from the Boss: dev.b055 sign-in in every app with one
  shared key kept as a secret in the hub. Waiting on the Boss's answers
  (which apps, PIN or password), then the plan.

- **Boss's Claude (2026-11-03 09:15, signals stalled):** #222 merged.
  The Boss saw no signals from about 3am. Likely cause: #218's gate (live
  from about 2am) held back any confidence band averaging under 0R (common
  with the take profit inside the stop) and its 3-losses rule could never
  reset with nothing posting. Now only clearly losing records (−0.3R or
  worse) are held back, the streak rule is gone, and after 30 quiet minutes
  the next alert always goes out. Not verified live (no Lovable connector
  here): check the signals chat after the Boss publishes.

- **Boss's Claude (2026-11-03, keyless AI):** #221 merged (no
  migrations). The API vault is still empty: the Boss adds keys himself
  (Claudes can't sign up for accounts, and the sandbox can't reach AI
  providers to test). A keyless Pollinations fallback is now last in the
  free list; test with Ping on the live API keys page.

- **Boss's Claude (2026-11-03, API vault and OG KEYS teaser):** #220
  merged (no migrations). For the partner: the Boss made a hub secret key
  named `og_bot` (OGSTREAMZ → Settings → API Keys) only for OG B0T and
  added it in Lovable as `OG_HUB_SERVICE_KEY`; OG B0T's server uses it to
  read `og_bot.ai_keys`. Still to do on the Boss's side: add `og_bot` to
  the hub's exposed schemas (Settings → Data API). If the takeover's
  Worker needs a hub key, it can reuse that secret or get its own. The
  Boss → System → API keys section is now called "API vault"; it moves
  into OG KEYS later (`docs/og-keys-plan.md`).

- **Boss's Claude (2026-11-03, signal ETA):** #219 merged (no
  migrations). New house rule in CLAUDE.md: the Copy Trader B0T copies
  every signal, good or bad; all accuracy work goes on the signals bot.
  "No signal" cards now say what the chart is waiting for and when the
  next signal is likely.

- **Boss's Claude (2026-11-03, signal gate):** #218 merged (no
  migrations). The Boss's rule: accuracy changes go on the signals bot;
  the Copy Trader B0T copies every signal it posts and only gets copy
  changes. Staying on the demo account for now. Tune `signal-gate.ts`
  from results; held-back alerts show in the report as "Its record has
  been losing".

- **Boss's Claude (2026-11-03, extra AI keys):** #217 merged. Hub table
  `og_bot.ai_keys` created on the hub (supabase/hub/03_ai_keys.sql, no
  Lovable migration). Waiting on the Boss: the Lovable secret
  `OG_HUB_SERVICE_KEY` (the hub's secret key) and og_bot in the hub's
  exposed schemas; the panel says which is missing. For the takeover:
  this already reads from the hub, keep `OG_HUB_SERVICE_KEY` (or point it
  at the same key the Worker uses).

- **Boss's Claude (2026-11-03, choosy copy bot):** #216 merged (no
  migrations). Everyone is watching the Copy Trader B0T's live test; the
  Boss wants its success rate up and to keep tweaking as we go. It now
  only copies alerts that pass `copyDecision` (src/lib/copy-filter.ts),
  decided before entry. Tune those thresholds from its results.

- **Boss's Claude (2026-11-03, more signals):** #215 merged (no
  migrations). The Boss's focus now: win rate up, and more signals for
  free. Keep replies to the Boss about outcomes, not backend detail. Random
  signals every 10–25 min, the chart picked by what's winning, quick ones
  skipped against the 1h trend.

- **Boss's Claude (2026-11-03, later):** #214 merged (no migrations).
  Signals → Results has the Strategy scoreboard; Signals → Backtest has
  "Take profit size", a read-only replay of stored setups with today's
  target against 0.75:1 to 2:1. Nothing live changed. The Boss's AI is
  fine-tuning the bot next. For the customer dashboard later: the Boss will
  sell activation codes that let a customer link their account, start/stop
  the bot, see the live balance and set a max take profit and max daily
  loss; may run it on their own VPS rather than MetaApi to keep costs down.
  Not started; waiting on the Boss.

- **Boss's Claude (2026-11-03, Boss nav):** #213 merged (no migrations).
  Signals is its own Boss area at `/admin/signals` (Controls, Results,
  Report, Backtest, Bots); `/admin/bot?tab=signals|telegram` redirect there.
  System's Diagnostics, Boss actions and More tools are one "Tools & logs"
  tab (`?tab=tools`; old `tests`/`actions` redirect). New Signals panels go
  on `admin.signals.tsx`, not `admin.bot.tsx`.

- **Partner's Claude (2026-11-02, gold retired):** #205 merged (no
  migrations). Signals are Bitcoin only. **Don't add gold back** anywhere
  (scanner, learning, buttons, pages) unless the Boss says so; read
  `src/lib/signal-markets.ts` for markets. Still open: the 1:1 take profit
  question, and the takeover waiting on "Cloudflare prep done".

- **Partner's Claude (2026-11-02, later):** #204 merged (no migrations).
  Gold's no_room filter goes back on at the next filter study. Open
  question for the Boss: the take profit is smaller than the stop
  (about 0.67× when posted); a 1:1 or better target is a strategy call,
  not changed yet.

- **Partner's Claude (2026-11-02):** #203 merged (no migrations). TV and app
  help is always clean. If a member's normal chat gets wrongly cleaned (or a
  TV ask still swears), adjust the word lists in `src/lib/tv-help.ts` and its
  tests. The takeover waits on "Cloudflare prep done" from the Boss.

- **Partner's Claude (2026-11-01, 14:45):** #202 merged (no migrations).
  The Cloudflare prep steps are queued in `telegram.notes` and go out
  within a minute of Lovable publishing. Next for the takeover: wait for
  "Cloudflare prep done", then build the Worker on beta.ogbot.co.uk.

- **Partner's Claude (2026-11-01, 14:10):** #201 merged (no migrations).
  With `SAMPLE_VERSION` 6 the learning history rebuilds from the last 14
  days, then grows a week per study. Until the chart patterns re-prove
  themselves (12+ trades, 55%), they may not post; the engine's own
  signals are unaffected. Still mine: leaving Lovable steps 3–5.

- **Boss's Claude (2026-11-01, 02:55):** synced to `f81161eb` (#193, count
  every signal OG B0T gives — no migrations, nothing new to apply). Type check
  clean, 733 tests pass (6 skipped, none failing), published to ogbot.co.uk.
  Live check: Boss → OG Bot → Signals report loads with rows (6 signals, 2 won,
  3 lost, 40% win rate, 1 running, 0 cancelled; by chart / by confidence / by
  session all rendering). The two fast scalps (`wick_rejection`,
  `exhaustion_reversal` in `src/lib/trade-setups.ts`) only post through the
  proven-setup gate in `trade-signal-context.server.ts` (a setup has to be in
  `liveSetupStats` for that market and clear the confidence floor), and the
  learning history in `src/lib/signal-samples.server.ts` keeps every sample and
  rebuilds itself under a new version — nothing deleted. No open work from the
  Boss's Claude.

- **Partner's Claude (2026-11-01, 01:20):** #192 merged (no migrations).
  After Lovable publishes, within a minute the bottom results post should
  come from Copy Trader B0T, and the closed cards since 16:40 should show no
  dollar amounts. `/api/public/trade-signal-watch` returns `copyTally`
  ("copy bot took over (tidied n)", then "copy bot has it"). No open work
  besides leaving Lovable steps 3–5 (paused).

Updated by the Boss's Claude, 2026-10-31, 23:15, after #188. The Boss pressed
Purge & start at $1,000 at 16:40; the demo runs from there. Nothing open: no open
PRs, nothing in progress from the Boss's Claude. Old branches on GitHub are
merged work, not open work.

- **Boss's Claude (2026-10-31, 23:15):** synced to `44d8cb00` (#188, hub apply
  - data snapshot — `supabase/hub` only, nothing for Lovable Cloud, no
    migrations). One test was failing: `ai-endpoint.test.ts` "free only + Foul
    Mouth ... never Gemini". Cause was the test, not the router — the chat usage
    log is a fire-and-forget database write through the same global `fetch` the
    tests stub, so the `ai_usage_log` insert was counted as a Gemini call
    (confirmed by printing every fetched URL: openrouter → groq → the
    `ai_usage_log` insert). `stubFetch` now answers `/rest/v1/` writes itself and
    never passes them to the test's stub, so the tests only record real model
    calls. Type check clean, 719 tests pass (6 skipped, none failing), build OK,
    published to ogbot.co.uk.

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
- **OG B0T in the hub (partner's Claude, 2026-10-31, 23:00):** the
  `og_bot` schema is applied in the OGSTREAMZ hub (migration `og_bot_init`)
  and holds a full snapshot of Lovable Cloud's data from 22:53 UTC, including
  106 members with password hashes (a password test passed). Nothing live
  uses it yet, and it goes stale as Lovable keeps writing. **If you add a
  migration on Lovable, apply the same change to `og_bot` in the hub too**
  (and to the build), or re-run the build and add the difference. How the
  copy works, and its 10-requests-at-a-time rule, are in
  `supabase/hub/README.md`. Open: the Boss exposes `og_bot` in the API
  settings; the dummy account in the hub waits on a Boss-approved delete;
  `extensions.http` is now installed in the hub (used for the apply); the
  edge function `og-bot-import` is switched off (it can be deleted).

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
- **Wick and reversal scalps (#187):** waiting on the learning loop to
  prove them; the Boss's report and the lesson show each setup's record.
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

- **2026-11-06 · partner's Claude · #249 · Entries close to the price.**
  The Boss: entries too far from the price when posted, and too slow.
  Data (BTC, 4 days): pullback entries 25/41, −$178.56; market entries
  27/23, −$42.32. A pullback now waits at most 30% back to the 20 EMA
  (was halfway) and at most 15 minutes to fill (was 60). The limits are in
  `BOUNDS` and apply at once through `safeTuning`. No migrations. Still
  open: average loss ($8.5–10) is bigger than average win (~$7) on both
  entry types; the exits (gain lock, trailing) are the other Claude's,
  not changed here.

- **2026-11-06 · partner's Claude · #247 · dev.b055 in every app.**
  - One 4-digit PIN in the hub Vault (`dev_b055_pin`), checked by the hub
    with one lockout for all apps (`supabase/hub/05_dev_pin.sql`, applied
    as `ogstreamz_dev_pin`).
  - OG B0T: `dev.b055` + PIN on the normal sign-in signs in the D.EV
    account. Unlock is in Boss → System → API keys.
  - OG VAULT, the booking portal and Padel Rival are wired up in their own
    repos.

- **2026-11-06 · partner's Claude · #246 · Key replace, webhook keeper,
  OpenRouter, bored message.**
  - The API vault can replace a stored key in place.
  - Every bot's Telegram webhook is checked every 15 minutes and
    re-registered when it slips (waiting messages kept); see "Bot
    connections" in Boss → Signals → Bots.
  - OpenRouter retired our free model, so free models are now picked from
    its live list, with its free router as the fallback
    (`openrouter-models.server.ts`). Never hard-code an OpenRouter model id
    again.
  - The bored message counts group chat as activity, says the real quiet
    time, and has Bitcoin facts only.
  - No migrations.

- **Boss's Claude · 2026-11-04 · #244** · Gain-based trailing stop
  (`trade-signal-outcome.ts`): the Boss's refinement of the 30% gain lock. The
  take-profit trail now STARTS the stop at 30% of the gain so far (entry →
  best) and then follows the best price up, locking 30% of the growing gain
  (advanceSignal gets a gain-based trail via trail.gainKeep), moving the SL up
  only, never reducing profit. All backend-computed, market-closed. Tests
  updated; a new test proves the stop ratchets up and never back.

- **Boss's Claude · 2026-11-04 · #242** · Runner + gain lock
  (`trade-signal-outcome.ts`, `paper-account.server.ts`): the Boss's exit rules,
  all worked out on the backend and closed with market orders (nothing on the
  broker). (1) Leave a 30% runner: bank 70% at the take profit, run 30%
  (RUNNER). (2) When super close to the take profit (90% of the way, GAIN_LOCK),
  the stop locks at least 30% of the gain made so far (gainLockStop), ratcheting
  up with the best price, never a loss — so the trailing stop (tpTrailArm) now
  floors at 30% of the gain instead of 30% of the take-profit distance. paperPnl
  banks 70/30. New pure helpers (gainLockStop, superClose) tested. No new tables.

- **Boss's Claude · 2026-11-04 · #240** · Signal gate on real win rate
  (`signal-gate.ts`, `paper-account.server.ts`): the gate already held back a
  confidence band whose average R was clearly losing; it now also holds back a
  band that *wins too rarely* (under 42% over 12+ decided calls), even when a
  couple of big runners keep its average R just positive. lotInputs computes
  the band's real win rate from the same settled calls; the scan passes it in.
  Makes "what the bot posts" track the real hit rate, not just agreement. No
  new tables, no migration. Tested.

- **Boss's Claude · 2026-11-04 · #238** · BTC signal accuracy
  (`trade-signal.ts`, `signal-broadcast.server.ts`): two accuracy levers. (1)
  Futures positioning now nudges confidence (fundingAdjust): trading WITH an
  over-crowded book (buying into high funding, selling into negative) costs up
  to 14 points, 16 with open interest piling in; fading a crowded book adds up
  to 4. Uses the funding/OI already fetched; live only. So crowded-long BTC
  buys often fall under the alert bar and don't post. (2) Concurrency-scaled
  bar (concurrencyBar): beyond 3 running, each extra concurrent trade needs +2
  confidence up to 84, clawing back accuracy from the new 10-at-once cap. No
  new tables, no migration. Tested. Confidence stays indicator-based plus
  these nudges; backtest/learning run classic without funding.

- **Boss's Claude · 2026-11-03 · #236** · More signals, more at once
  (the Boss: "increase the frequency, up to 10 trades at the same time, any
  direction"): MAX_RUNNING_PER_MARKET 6→10, SAME_SIDE_GAP_MS 10→3 min,
  AFTER_STOP_MS 15→5 min, SAME_SETUP_R 0.5→0.3, random cadence 10–25→4–12 min.
  Confidence bar unchanged (70% broadcast, 60% random) so quality holds; the
  extra trades come from room and shorter cooldowns, not a lower bar. Tests
  updated.

- **Boss's Claude · 2026-11-03 · #234** · Copy Trader win/loss fix
  (`src/lib/signal-record.server.ts`): the streak/last-ten and "Won/Lost the
  last one" were ordered by signal creation time, so a trade that opened
  earlier but closed last (e.g. a BTC win that hit TP after a later loss)
  showed the wrong "last" result — a win read as a red loss. Form is now
  ordered by settle time (trade_signals.closed_at, else created_at). Tested.

- **Boss's Claude · 2026-11-03 · #232** · Sports Guide group chat
  (`src/lib/sports-group.server.ts`): in the Boss's sports group OG B0T now
  reads and chats, not just mirrors. Members (unlocked guide / VIP) get royal
  treatment + the fixtures on "which game is on"; non-members get a cheeky
  block and a push to join. Random cheeky banter about games to come / just
  gone every ~3h (cron, daytime). No AI, no new tables (reuses
  sports_guide_posts + site_content, so the data still moves off Lovable).
  Only verifiable live over Telegram.

- **Boss's Claude · 2026-11-03 · #230** · Swear level in steps
  (`src/lib/og-heat.ts`): everyone starts at 0 (clean, like the bored
  messages); first cuss → 45 and it disses them back, second → 60, +12
  per insult after, up to 100. Polite/plain chat eases it down, serious
  resets to 0. Never announced.

- **Boss's Claude · 2026-11-03 · #229** · Swear level follows the
  member (`src/lib/og-heat.ts`): starts at 0–45 per member, goes up when
  they swear or come at the bot, down when they're polite or serious, read
  from their last 12 messages, never shown. Replaces the app chat's fixed
  DEMON level. Cuss battles stay savage. No Foul Mouth teaser message.

- **Boss's Claude · 2026-11-03 · #228** · "Roast" → "cuss" everywhere
  people see it (screens, Telegram help, bot prompts with a never-say-roast
  rule). `/cuss` and `cuss @someone` work in groups; `/roast` still works.
  Internal names unchanged. Also refreshed the Planned list (OG VAULT's
  Admin tier and My Apps are done).

- **Boss's Claude · 2026-11-03 · #227** · Store-safe phone apps (a
  standing rule for every app, in CLAUDE.md): OG VAULT / the Vault Pass is
  now hidden in the Android/iOS app too (Settings card, store item, app
  chat), alongside trading, which already was. `src/lib/native-policy.ts`
  lists what stays website-only. Website unchanged.

- **Boss's Claude · 2026-11-03 · #226** · The "I'm bored" message moved
  to the signals chat (the Boss's correction): after an hour with no alert
  or update there, OG B0T posts a friendly gold/BTC fact, at most hourly,
  9am–10pm UK, replacing the previous one. Private chats get none now.

- **Boss's Claude · 2026-11-03 · #225** · Foul Mouth turned down to
  medium for everyday chat and random questions (cuss battles stay
  savage), the first reply of a conversation is polite, and an "I'm bored"
  Telegram nudge with a gold/BTC fact after an hour of quiet
  (`og-idle-nudge.server.ts`). No migrations.

- **Boss's Claude · 2026-11-03 · #224** · House rule in CLAUDE.md: never
  say "roast", say "cuss battle" (cuss = diss for fun). The app still has
  about 40 files with "roast" in their copy; they change when the Boss asks.

- **Boss's Claude · 2026-11-03 · #222** · Unstick the signal gate:
  `POST_BAD_EDGE` −0.3R instead of any loss, the loss-streak rule removed,
  and the 30-minute safety valve (`POST_QUIET_MIN`).

- **Boss's Claude · 2026-11-03 · #221** · Free AI with no key:
  Pollinations' open endpoint is the last free model before paid Gemini
  (`POLLINATIONS_NO_KEY=off` switches it off), with its own Ping on Boss →
  System → API keys.

- **Boss's Claude · 2026-11-03 · #220** · OG KEYS teaser: a
  coming-soon card (last in the mode grid on the landing page and the
  members' home, art made from the master logo) and the plan in
  `docs/og-keys-plan.md`, listed under Planned. The key section in Boss →
  System → API keys is renamed "API vault". Partner told about the
  `og_bot` hub key / `OG_HUB_SERVICE_KEY`.

- **Boss's Claude · 2026-11-03 · #219** · CLAUDE.md house rule: the
  copy bot copies every signal; accuracy goes on the signals bot. "No
  signal" cards end with "⏳ Waiting for … · next signal likely in about
  …" (signal-eta.server.ts: the wait reason in plain words, and the time
  from how often signals were posted at each hour over the last week).

- **Boss's Claude · 2026-11-03 · #218** · Accuracy moved from the copy
  bot to the signals bot. #216's copy filter is now `postDecision`
  (src/lib/signal-gate.ts), checked in `postOnce` for every automatic
  alert before the AI desk; a held-back alert is a shadow trade
  ("losing_record"). The demo/copy bot copies every posted signal again.

- **Boss's Claude · 2026-11-03 · #217** · Extra free AI keys. Boss →
  System → API keys has a section to add any number of Pollinations,
  OpenRouter and free Gemini keys (dropdown, paste, optional name; test,
  switch off, remove). Kept encrypted in the hub (`og_bot.ai_keys`), not on
  Lovable, and tried before the existing secrets, which stay the fallback.

- **Boss's Claude · 2026-11-03 · #216** · Choosy Copy Trader B0T. Before
  each entry `copyDecision` decides whether the copy bot (the demo account)
  copies the alert: not when that confidence band has been losing, not under
  70% unless the band is proven, not when the alert's strategy or chart has
  lost money over 12+ trades, and only 80%+ after 3 losses in a row. Skipped
  alerts get 0 lots, so they're never in its balance or win rate. The trade
  bot still posts and learns from every alert.

- **Boss's Claude · 2026-11-03 · #215** · More signals, higher win rate,
  all free (no AI). Random signals every 10–25 minutes (was 20–45). The
  chart (1m/5m/15m/1h) is picked by `pickFrame`, leaning towards the charts
  making money like `pickStrategy`, from one `signalStats` read. A 1m/5m/15m
  random signal is skipped when the 1-hour chart leans the other way at 60%+
  (`againstTheHour`).

- **Boss's Claude · 2026-11-03 · #214** · Two of the Boss's picks.
  (1) Strategy scoreboard on Signals → Results: each strategy's trades,
  wins, losses, profit per trade (R) and the demo account's dollars, over
  7/30/60 days. `strategyStats` now tallies through the pure
  `tallyStrategies` (same numbers for the picker, plus cash). (2) Take
  profit size on Signals → Backtest: the stored learning setups replayed
  with today's target and with 0.75, 1, 1.25, 1.5 and 2 times the stop,
  with the spread and the profit lock, in dollars at 0.1 lot. `evaluate`
  and `applyTuning` take an optional `tpToStop` that learning never passes,
  so learning is unchanged. Read only throughout; nothing deleted.

- **Boss's Claude · 2026-11-03 · #213** · Boss console navigation, the
  Boss's five asks. (1) Signals moved out of OG B0T into its own area,
  `/admin/signals`, with tabs Controls (portal, demo/start fresh, MT5),
  Results, Report, Backtest and Bots (webhook, worker fleet, groups). The
  panels are the same components, only moved. OG B0T keeps Persona,
  Health, Your alerts and Live users. (2) Members' filter chips combine
  (VIP + Telegram = VIP members with Telegram); "All" clears them.
  (3) System: Diagnostics, Boss actions and More tools are one "Tools &
  logs" tab. (4) Boss search: Ctrl/Cmd+K or "/" jumps to it from any Boss
  page. (5) On phones the tab strip is a dropdown; each area reopens the
  tab you last used (this browser only, when the link has no `?tab=`);
  "Needs your attention" is first on the dashboard. Every old link
  redirects; boss-search entries and tests updated.

- **2026-11-02 · partner's Claude · #206 · Claudes publish and check it
  themselves.** The Boss asked for Lovable to do as little as possible.
  Lovable already pulls every merge into `lovable-sync` by itself. A Claude
  now publishes with the Lovable connector's `deploy_project` and checks
  the live site and database itself (CLAUDE.md step 5). #203, #204 and #205
  were published this way at about 14:07 UTC: the live welcome page shows
  "Bitcoin setups", and gold scans stopped at 14:05.

- **2026-11-02 · partner's Claude · #205 · Gold retired, Bitcoin only.**
  `src/lib/signal-markets.ts` (SIGNAL_MARKETS / RETIRED_MARKETS) is the one
  list every scanner, learner, MT5, report, page and panel reads. Gold asks
  get one line, with no chart, AI or tracking. Telegram buttons are BTC only.
  BTC can run 6 alerts at once (was 3). Gold data stays stored. No
  migrations. Gold tests were rewritten (restore them from history if gold
  ever comes back).

- **2026-11-02 · partner's Claude · #204 · Fewer losing trades.** Since
  31 Oct midday the trade bot went 16 won, 27 lost. Trades let through by
  learned-off filters went 6 won, 16 lost (BTC no_room 10/15, gold no_room
  0/4). Cause: shadows are kept every 5 minutes, so one move counted as a
  dozen winners. Now `oneShadowPerMove` counts each move once (filters and
  the alert bar), and `TIGHTEN_MIN_DECIDED` is 4 instead of 10. No
  migrations. Not changed but worth knowing: live take profits sit at about
  0.67–0.87× the stop distance, so the engine needs 55–60% wins just to
  break even.

- **2026-11-02 · partner's Claude · #203 · TV and app help answered clean.**
  `src/lib/tv-help.ts` (pure text checks) spots TV device, TV app and
  app-help asks. The foul mouth is then off for that reply on the website,
  Telegram DMs, groups, Battle Zone, worker bots and the trade bot.
  `cleanForTvHelp` in `fetchAiChat`/`streamAiChat` is the catch-all.
  No migrations.

- **2026-11-01 · partner's Claude · #202 · Telegram notes.** OG B0T sends
  step-by-step messages queued in site_content `telegram.notes`
  (`[{to: email, text}]`) each minute, at most 8 per run, claimed first and
  never sent twice. The first batch queued is the 9 Cloudflare/GitHub prep
  steps (exit plan A, plus exposing `og_bot`) for faiyaz196@gmail.com.
  No migrations.

- **2026-11-01 · partner's Claude · #201 · Chart pattern fixes on top of
  #195/#196.** Bearish fair value gap retests could never fire (the gap's
  edges were swapped for sells); now fixed. Double top/bottom, flag and gap
  retests skip a pattern whose real stop is too wide (`beyond()`) instead of
  clamping the stop inside it. `SAMPLE_VERSION` 6 so the learning history
  re-records the patterns (v5 rows stay stored). Sell-side tests added, plus
  one pinning the 70% floor. No migrations.

- **2026-11-01 · partner's Claude · #192 · Copy Trader B0T takes over now.**
  Follow-up to #191. The tracker runs `ensureCopyTally` each minute. The
  first time a copy bot is on duty, it redraws the trade bot's closed cards
  since the purge without money, the copy bot posts the tally, and
  `signals.score.by` = `copy:<bot id>` is set so it runs once. Open chat
  cards are drawn through `chatJournal` (prices only). Stored cards and logs
  are untouched. No migrations.

<!-- Newest first. Who · date · PR · what changed · migration? · anything left for later -->

- **Boss's Claude · 2026-11-03 · #212** · The Boss pressed Publish → Update
  in Lovable after #211, so #207–#211 should be live (Boss dashboard, TP1
  trailing, free group signals, the ⚡ button everywhere). Not checked by a
  Claude: this session has no Lovable connector and ogbot.co.uk is blocked
  from its sandbox. Partner's Claude: worth a read-only check with yours
  (the signals chat's results post should carry the ⚡ keyboard after its
  next refresh). Notes only.

- **Boss's Claude · 2026-11-03 · #211** · The ⚡ button everywhere, old
  signal menus gone (Boss's ask). OG B0T's private bar: ⚡ full width, then
  Menu | Clear chat (unlinked: ⚡, then Clear chat | site, a free
  chart-engine signal). The 📈 Signals sub-menu and the group coin picker are
  gone (Bitcoin only); old buttons still on screens keep working and swap in
  the new bar. Groups get the button only where OG B0T hears taps (privacy
  off or admin; `hearsTaps`, `ensureGroupButton`, once a day). Worker bots'
  private chats carry it too and answer a tap with a BTC scalp. 1 min stays
  Boss-only. `telegram-flow.test.ts` rewritten for the new bar (7 tests that
  described the old menus) plus 2 new. No migration.

- **Boss's Claude · 2026-11-03 · #210** · An always-on "⚡ Generate BTC
  Signal Now" button at the bottom of the signals chat: a persistent reply
  keyboard (`GENERATE_SIGNAL_KEYBOARD`) on every results post, so it's
  re-sent with each refresh. A tap is read as "signal btc"
  (`isGenerateSignal`), the tap message is deleted, and the BTC scalp tags
  the member (free for all, #209). One line only: Telegram can't break a
  button's text. Needs OG B0T to stay admin in the signals chat (it sees the
  tap). No migration.

- **Boss's Claude · 2026-11-03 · #209** · Boss: signals are free for every
  member of the Telegram group. A signal request in a group (typed or a
  button) from someone with no connected account used to get the Connect
  nudge; now `freeGroupSignal` answers with the chart engine's card (no AI),
  recorded under the Boss's account with the member as requester
  (`feeds.freeGroup`), so it's followed and counted. Chat, roasts and account
  commands still need a connected account. `telegram-flow.test.ts` updated
  (that test used to expect the "not connected" alert). No migration.

- **Boss's Claude · 2026-11-03 · #208** · Boss: "balance takes priority, do
  trailing loss instantly as TP1 about to hit". At 90% of the way to the take
  profit a trade trails instead of closing there (`tpTrailArm`): stop 20% of
  the distance behind the best price (2 spreads at least, never under the
  lock), so 70% is locked at arming; a far cap at 3×. Profit-lock and
  trailing exits in profit now count as wins in the record (the 16 won / 27
  lost you logged in #204 left lock exits out). Trailing exits pay half a
  spread more in the demo. New CLAUDE.md house rules: Lovable credits are
  limited (do the work, publish with the connector, Publish → Update costs no
  credits), and balance first with no stop or take profit on the broker's
  order book (close at market, count the spread). No migration.

- **Boss's Claude · 2026-11-02 · #207** · (1) Boss dashboard: Signals tab
  is switches first (portal, the demo reset moved from Telegram, MT5) then
  record, report, backtest; `BossCommandBar` on /admin (free access popover
  with +1h/+24h/+7d, web signals switch, fleet, demo balance + copy bot);
  Settings' Boss card is the Boss Switchboard; search sends the demo reset to
  Signals. Every switch still lives in one place (`useBossSwitches` only
  reads; the bar calls the same mutations). (2) Signals: random signals every
  20–45 min (was 30–90) with Bitcoin the only market; the strategy picker
  scores by money made per trade in risks, not win rate (your #204 note:
  take profits under the stop distance), and learns from every trade-bot
  signal (`strategyOf`), not only random ones; the 1m/15m/1h proof runs all
  three charts every study. Built on #204/#205. No migration.

- **Boss's Claude · 2026-11-01 · #200** · Boss: "add check for all
  migrations, checklist for verification" (the move off Lovable waits until
  current work is done). `scripts/hub/migrations-checklist.mjs` builds
  `docs/migrations-checklist.md` (every migration, what it leaves behind,
  switch-day checks) and `supabase/hub/verify_migrations.sql` (read only,
  returns what's missing). **Checked on the hub today: all 530 objects from
  the 215 migrations and the drift are in `og_bot`, nothing missing.** No
  migration was added after the hub copy (#188). Still to recreate with the
  files: 3 storage access rules; and 6 cron jobs move to the new host. A test
  fails if a migration isn't in the checklist; CLAUDE.md says re-run the
  script. Partner's Claude: use this on switch day. No migration.

- **Boss's Claude · 2026-11-01 · #199** · **For the partner's Claude:**
  the Boss wants **you** to do the Lovable takeover (steps 3–5). The Boss's
  Claude only researched it: it read og-booking-portal and OG-VAULT-REACT
  (read only) and wrote the Boss's full to-do list (Cloudflare Workers Paid,
  token, GitHub secrets, Worker secrets, exposing `og_bot`, Google and Apple
  sign-in, Resend SMTP, Stripe off Lovable payments, the Drive sign-in, the
  edge function secrets) into `docs/lovable-exit-plan.md`. The Boss's main
  reason: stop paying for Lovable migration prompts. Docs only.

- **Boss's Claude · 2026-11-01 · #197** · (1) Signals given in the website
  and app chat were never recorded, so never followed or counted; now they
  are (`og-chat.server.ts` → `recordSignal`, chat id null). (2) Random
  signals, the request style: every 30–90 minutes a strategy picked at
  random (chart engine, AI desk inside its budget, any setup or pattern), a
  random market and chart; posted at 60%+ through `postOnce`, card tagged
  "🎲 <strategy>", `feeds.strategy` kept. The picker (`pickStrategy`) leans
  towards the winners and keeps trying the rest; a strategy losing money over
  12+ trades is picked far less. New: `signal-random.server.ts`,
  `maybeRandomSignal`, the hidden "setup:<id>" ask. No migration.

- **Boss's Claude · 2026-11-01 · #196** · Boss: "only post patterns on the
  chart they were proven on". #195 used the 5-minute proof on every chart.
  Now the 1m, 15m and 1h charts each prove the setups on their own history
  (`signal-frame-setups.server.ts`: one chart per study in turn, trend from
  the chart's own 20/50 EMA, the same evaluate rules and spread), stored as
  `MarketLearning.frameSetups`; `liveSetupStats(market, frame)` gives only
  that chart's proven setups, and live uses the same trend the proof used.
  No AI, no deletes, gold and bitcoin only. No migration.

- **Boss's Claude · 2026-11-01 · #195** · Classic chart patterns, gold and
  bitcoin only, no AI: `double_top_bottom`, `flag_continuation`,
  `fvg_retest` (only with the bigger timeframe's trend) in `trade-setups.ts`
  (`PATTERN_IDS`), stops past the invalidation level, targets 1/1.5/2 risks,
  62% confidence +10 with the trend. Proven before live like the other
  setups, but at 55% wins (`setupMinWinRate`), 12+ trades and positive after
  spread; `SAMPLE_VERSION` 5 (history rebuilds from 14 days, old samples
  kept). Scanner frames now 1m, 5m, 15m and 1h; proven setups read on all
  four (`SETUP_FRAMES`), the desk re-check uses the alert's own chart
  (`frameOf`). Not lowered: the 70% alert floor, the 90% TOP tier, the 1m
  80% floor. Note: setups are proven on 5-minute history and applied to the
  other charts. No migration.

- **Boss's Claude · 2026-11-01 · #194** · Trailing stops in the mix (Boss's
  ask): trades at 80%+ going with the bigger timeframe get an open take
  profit (a far cap at 3 risks) and a trailing stop instead of the 70/30
  lock: at 1 risk up the stop goes to the entry, then trails a risk behind
  the best price (`TRAIL`, `trailsThis`, `TrackedSignal.trail`,
  `feeds.trail`). MT5 stop follows; members hear once per extra risk locked
  in; a trailing exit in profit counts as a win. Card wording fits the
  partner's prices-only chat cards. No migration. Open: the learning loop
  doesn't replay trailing yet.

- **Boss's Claude · 2026-11-01 · #193** · Boss: "count any signal asked by
  the user as part of the counter, every signal it gives". The record has no
  confidence cut-off any more (`RECORD_MIN_CONFIDENCE` 0: members' requests
  and auto-posts, still never market-bias calls, still from the last reset).
  In the Copy Trader B0T's tally the streak, last ten and win rate are that
  record again (it was the demo's trades, #186), with "· every signal" on the
  win-rate line; each market in cash and the balance stay the copied trades.
  Built on the partner's #191/#192 (copy bot heading and copying lines
  untouched). No migration.

- **Partner's Claude · 2026-11-01 · #191** · Boss's split, approved from a
  mock-up: the OG Trade Bot only makes signals, with cards and updates in
  prices only (no lots or $). The Copy Trader B0T (@ogcopybot, connected
  tonight, fleet role "copy", on duty in OG SIGNAL TEST MODE) copies them and
  posts the one live tally at the bottom: "📋 COPY TRADER B0T", what it's
  copying now with $ so far, streak, last ten, win rate, each market in cash,
  balance (`copyingNow`, `copyBot` in `refreshScore`). The demo account's
  rules are unchanged. Updated `chat-cash-lines.test.ts` and the card-wording
  test to the new wording. No migration. Next (Boss): link real accounts
  through the copy bot.

- **Partner's Claude · 2026-11-01 · #190** · Boss's rule: don't gang people
  up unless they're online at the same time. A guest saying "hi" got lumped
  in with zeeshan and others from earlier because the Battle Zone read the
  room's last 20 lines whatever their age. Now the Battle Zone (members and
  guests) only reads the last 10 minutes (`roomSince`), and Telegram group
  battles only name and gang up on people active in the last 10 minutes
  (`crewNote`; other people's older lines are left out of the conversation).
  Test: `battle-room-window.test.ts`. No migration.

- **Partner's Claude · 2026-11-01 · #189** · Songs live on the Boss's Google
  Drive (Boss: "main, not backup"). Full plays and downloads (song-url, the
  public track page and playlist, Telegram) come from Drive through a signed,
  expiring `/api/public/song-audio` link with a fallback to the stored copy
  (`song-audio-link.ts` and its Deno copy, `song-audio.server.ts`). New songs
  go to Drive in the 5-minute song job, and Boss → Music → Drive moves the
  rest (191 of 219 weren't there yet). The library's Drive link now shows
  only once a song is unlocked: it used to show for locked songs, which gave
  the full song away. Previews, lyric videos and the stored full copies are
  unchanged and nothing is deleted. Needs the song-url function redeployed.
  No migration.

- **Partner's Claude · 2026-10-31 · #188** · Leaving Lovable step 2 done
  without a GitHub secret: `og_bot` applied in the hub through the database
  connection (the hub fetched `og_bot_init.sql` @ 6ac2f97 from GitHub and
  checked its md5), then a snapshot copy of all data from Lovable Cloud
  (members with password hashes, every `og_bot` table; counts match) through
  a temporary hub edge function, now switched off. Password test passed with
  a dummy account. Incident: the first copy attempt opened ~95 connections
  at once and the hub ran out for about a minute (22:42–22:43 UTC); stopped
  and cleaned up, everything answered normally after. Rule now in
  `supabase/hub/README.md`: at most 10 requests at a time. The build script
  drops pg_dump's `\restrict` lines. No Lovable migration.

- **Boss's Claude · 2026-10-31 · #187** · More entries, not random ones
  (Boss's ask: "super fast scalps, wicks and reversals"): two new extra
  setups in `trade-setups.ts`, wick rejection and exhaustion reversal, quick
  targets (1 to 2 risks). Like the others they only go live per market after
  the learning loop proves them (12+ trades, 50%+ wins, making money), and a
  live setup's confidence is now its proven win rate (`provenConfidence`), so
  only accurate ones clear the alert bar. `SAMPLE_VERSION` 4: the history
  rebuilds from 14 days back (older samples kept, never deleted), so the new
  setups need a few days of studies before any can go live. No migration.

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
