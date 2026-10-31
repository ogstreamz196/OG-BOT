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
3. Update `AGENTS.md` for any behaviour you changed.
4. Add an entry to `docs/claude-sync-log.md` (newest at the top of
   **Log**), and take your line out of **In progress**.
5. PR into `lovable-sync`, merge, then give the person you're working for a
   Lovable prompt (pull lovable-sync, apply any new migrations unchanged,
   publish, and what to check).

## House rules

- PRs go into `lovable-sync`. Lovable builds and hosts the site from it and
  mirrors `supabase/migrations/` into `drizzle/migrations` itself.
- "Don't break anything": a missing table or secret makes a feature quietly
  do nothing, never crash. Migrations are idempotent (`IF NOT EXISTS`).
- Brand: **OG B0T** (letter O, zero only in B0T). Never "Supabase" in
  anything users see. No blue text: foreground, muted, emerald, rose, amber.
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
