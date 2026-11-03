# Working on OG B0T (read this first, every session)

Two Claudes work on this repo: the Boss's and the partner's, each in its own
account. Neither can see the other's chats, so the repo is how they stay in
sync. Follow this every time.

## Before you start any task

1. `git fetch origin` and look at what's new on `lovable-sync` since you last
   worked: `git log --oneline -30 origin/lovable-sync`. Read the commit
   messages and, for anything touching what you're about to change, the diff.
2. Read `docs/claude-sync-log.md`: the newest entries, and the **In progress**
   list at the top.
3. Check open pull requests and branches pushed in the last day. If another
   Claude's open work touches the same files as your task, don't edit them in
   parallel: say so to the person you're working for and wait, or build on
   top of it once it's merged.
4. Read the parts of `AGENTS.md` that cover what you're changing. It's the
   living record of how everything works.
5. Always branch from a fresh `origin/lovable-sync`.

## While you work

- Add your task to **In progress** in `docs/claude-sync-log.md` on your
  branch, and push early (a draft PR is fine), so the other Claude can see it.
- Never revert, rewrite or delete the other Claude's work without the Boss
  saying so. If something of theirs looks wrong, explain it instead.

## Before you merge

1. `git fetch origin` again. If `lovable-sync` moved, merge it into your
   branch and run the checks again.
2. Checks: `npx tsc --noEmit -p .`, `npx vitest run` (only
   `src/lib/routes.smoke.test.ts` fails in the sandbox), and
   `NODE_OPTIONS=--max-old-space-size=6144 npx vite build`.
3. Update `AGENTS.md` for any behaviour you changed. Added a migration?
   Re-run `node scripts/hub/migrations-checklist.mjs` (a test fails until
   you do), so `docs/migrations-checklist.md` stays complete.
4. Add an entry to `docs/claude-sync-log.md` (newest at the top of
   **Log**, with the real PR number, not "this PR"), take your line out of
   **In progress**, and refresh **Where things stand** so the other Claude
   can pick up from there.
5. PR into `lovable-sync` and merge. Lovable picks up every merge by itself
   (check `latest_commit_sha` with the Lovable connector's `get_project`).
   Then publish it yourself with the Lovable connector's `deploy_project`
   (project 07659a42-5b68-4c8b-83b5-ee9a625dbb92) and check it yourself: the
   live site's code at ogbot.co.uk, and the database through `query_database`
   (read-only checks). The Boss wants Lovable to do as little as possible, so
   only give the person a Lovable prompt for what you can't do: a new
   migration Lovable must apply, or a secret only they can enter.
6. Old branches stay on GitHub (Claude sessions can't delete them). A branch
   only counts as open work if it has an open pull request or a line under
   **In progress**; anything already in `lovable-sync` is done.

## House rules

- PRs go into `lovable-sync`. Lovable builds and hosts the site from it and
  mirrors `supabase/migrations/` into `drizzle/migrations` itself.
- "Don't break anything": a missing table or secret makes a feature quietly
  do nothing, never crash. Migrations are idempotent (`IF NOT EXISTS`).
- Brand: **OG B0T** (letter O, zero only in B0T). Never "Supabase" in
  anything users see. No blue text: foreground, muted, emerald, rose, amber.
- **Never use the word "roast" (the Boss's rule, 2026-11-03).** Say **cuss
  battle** (to cuss = to diss someone for fun) in anything you write: app
  copy, bot replies, cards, docs and messages to the Boss. Old "roast" text
  still in the app gets changed to cuss/cuss battle when the Boss says so.
- Never commit, paste, print or log secrets or Telegram API URLs.
- Never edit `src/routeTree.gen.ts` by hand. Route files export only `Route`.
- No AI model names or IDs in commits, PRs or code.
- Group roasts never use paid AI. The AI desk's automatic runs have a daily
  budget and never use OpenRouter (the roasts' allowance).
- Stored trade and learning data is never deleted, by anyone, ever: not by
  a purge, a clean-up, a retention job or a migration. That covers
  `trade_signals`, `signal_learn_samples`, `signal_shadows`, the learning
  settings and every other table the signals learn from. When the Boss says
  "purge" it means the Telegram chat and the counters only (the purge notes
  a time and everything before it stops counting); the backend data stays
  for the AI to keep learning. Reads limit themselves to the window they
  need instead of anything being deleted.
- The Boss trades on Vantage, Standard STP (no commission, spread only).
- **Lovable credits are limited (the Boss's standing rule, for every
  project).** Do all the work yourself: code, checks, merging, publishing
  with the Lovable connector, and read-only checks. Never send the Boss a
  Lovable chat prompt for something a Claude can do; if a Claude really
  can't (a new migration Lovable must apply, a secret only the Boss can
  enter, or no Lovable connector in this session), say so, and remind the
  Boss that clicking Publish → Update in Lovable costs no credits.
- **The Copy Trader B0T copies every signal, good or bad (the Boss's rule,
  2026-11-03).** It copies everything the signals bot posts and never picks
  its own trades. So accuracy work goes on the signals bot: what it posts,
  how it reads the chart, and its estimate of when the next signal is
  likely. Change the copy bot only for how it copies (lots, tally, display).
- **Phone apps stay store-safe (the Boss's rule, 2026-11-03, for every app).**
  The Android/iOS apps load the live website, so anything that makes Google
  Play or App Store approval hard hides itself in the app at runtime
  (useIsNativeApp / Capacitor.isNativePlatform) and the website keeps it:
  trading (signals, market calls, brokers, copy trading, MT5), OG VAULT and
  the Vault Pass (IPTV logins, installing apps from outside the store), and
  paying for digital goods outside the store's billing. List and helpers in
  `src/lib/native-policy.ts`. New features like these are website-only from
  the start. Never break the website to do it, and keep the Android project
  building in Android Studio.
- **Balance first, and no stop or take profit on the order book.** Protect
  profit before chasing it (the 70/30 profit lock, the trailing stop as a
  take profit is about to hit). When the real trading bot is built, orders
  carry no stop loss or take profit at the broker: the bot closes with market
  orders when its own levels are reached, and every result counts the
  spread (a buy closes on the bid, a sell on the ask).
