FIRST, A NOTE ON THIS FILE: it lives on its own branch, "handoff", in ogstreamz196/og-196 and isn't part of the site. Once you've read all of it, reply to the user with a short summary confirming what you understood and where you'll start. Once they've confirmed, delete the handoff branch (git push origin --delete handoff, or delete the branch through the GitHub tools) so this file doesn't stay around. Don't merge this branch anywhere.

You're taking over work on OG B0T from another Claude session. Please read all of this before you touch anything. It covers the project, the house rules, how changes get shipped, what was built most recently and exactly where things were left.

THE PROJECT

OG B0T is a web app at https://ogbot.co.uk, plus a Telegram bot called "telegram og bot". The main code is in the GitHub repo ogstreamz196/og-196, which GitHub now also redirects to as ogstreamz196/OG-BOT. A separate carrom game lives in ogstreamz196/carromboard. The site is built and hosted by Lovable (Lovable Cloud runs the database too). Lovable syncs with the branch lovable-sync, so every pull request goes into lovable-sync and never into main.

The stack is TanStack Start with Nitro on Cloudflare Workers, React, Tailwind v4 and a Postgres database through the Supabase client (Lovable Cloud). Server functions use createServerFn().middleware([requireSupabaseAuth]).validator().handler(). Scheduled jobs are pg_cron calling net.http_post on /api/public/... routes, which check the x-ogbot-retry-token header with the verify_song_retry_token rpc. The Supabase project called "OG-BOT" that shows up in MCP tools is inactive and is not the live database, so you can't read live logs or data from there.

Read AGENTS.md in the repo first. It's the living record of how every part works (the Telegram screens and bottom bar, groups and roast battles, the Gaffer and Worker bots, signal cards, signal speed, auto-posted alerts, the results book, the signals chat tidy, and more). Keep it up to date whenever you change behaviour.

HOW WORK GETS SHIPPED

Branch off origin/lovable-sync, make the change, run the checks, commit, push, open a PR into lovable-sync, merge it yourself, and then give the user a "Lovable prompt": a short paragraph they paste into Lovable telling it to pull lovable-sync, apply any new migrations unchanged, publish, and verify specific things. The user usually says "merge it" and expects you to do that without asking again. When something is merged and they might be away, send a push notification.

Checks before every push: npx tsc --noEmit -p . must be clean; npx vitest run must pass apart from src/lib/routes.smoke.test.ts, which always fails in the sandbox; and NODE_OPTIONS=--max-old-space-size=6144 npx vite build must succeed. Migrations go in supabase/migrations/ with a timestamp name. Lovable mirrors them into drizzle/migrations itself, and the user applies them through Lovable. Make migrations idempotent (IF NOT EXISTS) and test them twice against a local Postgres 16 if you have one. Never edit src/routeTree.gen.ts by hand; regenerate it by running the dev server briefly in the background (timeout 45 npx vite --port 80xx). Route files export only Route.

HOUSE RULES (the user cares about these a lot)

"Don't break anything." Keep changes minimal and backwards compatible; a missing table or secret should make a feature quietly do nothing, not crash.
The brand is OG B0T: letter O in OG, zero only in B0T. Never write "0G". Leave ogbot196@gmail.com and ogbot.co.uk exactly as they are.
Never say "Supabase" in anything a user sees.
No blue text in the UI. Use text-foreground, muted, emerald, rose and amber, with Tailwind v4 tokens.
The bot's persona is the foul-mouthed OG: British, swearing, roasting. Copy you write for the bots should sound like him.
Group roasts must never use paid AI. fetchAiChat has a freeOnly option: the swearing OpenRouter model goes first, then the other free models, never Gemini.
Security: never ask for, paste, print or commit secrets, and never log Telegram API URLs (the bot token is in them). Earlier, the user pasted the signals bot token in chat and was told to revoke it with @BotFather /revoke and store the new one only as the Lovable secret SIGNALS_BOT_TOKEN. Check with the user that this was actually done.
No AI model names or IDs in commits, PR text or code.
The user writes casually, often from a phone, with typos. Work out what they mean and act; only ask when it really changes what you'd build. Answer them in plain, natural sentences, not walls of bullet points.

THE SIGNALS SYSTEM (where recent work happened)

The trade signal engine is in src/lib/trade-signal.ts and src/lib/trade-signal-context.server.ts. It builds gold (XAU, priced from PAX Gold) and bitcoin scalp signals. A card lists Stop Loss first, then Entry, then three targets named Quick Scalp, Potentially and Greedy Runner (from scaleTargets), and ends with one random line from SIGNAL_DISCLAIMERS. When there's no setup, the reply is a short "No signal" line plus a random foul line.

Auto-posting: /api/public/signal-scan runs every minute and repeats every 15 seconds. Any gold or bitcoin scalp scoring 90% confidence is posted as a "TOP SCALP ALERT" to the signals chat (secret SIGNALS_CHANNEL_ID) by a separate worker bot, the OG Trade Bot (secret SIGNALS_BOT_TOKEN, code in src/lib/telegram-worker.server.ts). OG B0T is the "Gaffer" and the trade bot is his "chart slave".

Following signals: /api/public/trade-signal-watch runs every minute and repeats every 12 seconds (src/lib/trade-signal-tracker.server.ts). It posts updates when an entry fills, a target or the stop loss is hit, or the higher trend flips. It no longer posts "time's up" messages for expired signals.

Results book (PR #107, table signal_results, src/lib/signal-results.server.ts): every signal that hits a target is booked as a win (pips to the furthest target reached) and every one that hits its stop loss first is booked as a loss. Each setup is counted once. Gold is counted in pips and bitcoin in $1 points, and they're never added together. When someone asks things like "how much did we make yesterday" or "since the weekend", the Telegram chat and the app chat (src/lib/og-chat.server.ts) add the real figures for today, yesterday, since Saturday, this week, the last 7 days and this month, all in UK time.

Signals chat tidy (PR #108, table signal_chat_messages, src/lib/signal-chat.server.ts): in the signals chat only, a new alert for a pair deletes that pair's older alert and the updates under it. A "📊 TODAY'S SCORE" message (wins, losses and pips per pair for the UK day) is resent silently as the last message after every alert or update, the old one is deleted, and a fresh day starts at UK midnight. Private chats and groups keep their own rule, where any new signal wipes the older ones.

WHERE THINGS WERE LEFT

After PR #108 went live, Lovable confirmed both migrations were applied and the watcher returned ok, but no score message appeared in the signals chat and no score row existed. The code had been skipping silently. The likeliest cause was SIGNALS_CHANNEL_ID being saved as an @name, which the score code didn't handle. PR #109 (merged) fixed that: the trade bot now looks up the chat's number with getChat. It also made every skip report its reason. The watch route now returns a "score" field (posted, up to date, or the exact reason), and POST {"score": true} to /api/public/signal-scan posts the score immediately and returns the same answer.

Your first job: ask the user to run this Lovable prompt if they haven't already, then work from the exact "score" text it returns:

"Pull the latest from lovable-sync (PR #109 is merged) and publish. Don't change any code. Once it's live, call POST /api/public/signal-scan with the usual x-ogbot-retry-token header and the body {"score": true}, and report the score value it returns word for word. Then call /api/public/trade-signal-watch the same way and report its score field. If either says failed or skipped, quote the full reason exactly and don't try to fix it. Finally, confirm whether a 📊 TODAY'S SCORE message is now showing in the signals chat."

If the reason mentions rights or "chat not found", the trade bot needs to be an admin in the signals chat with permission to post and delete messages. That's a setting the user changes in Telegram, not a code fix.

Two things were offered to the user but never built, so only do them if they ask: a daily evening recap post in the signals chat, and pinning the score at the top instead of reposting it at the bottom.

The previous session's PRs are numbered up to #109 in ogstreamz196/og-196, and their descriptions explain each change if you need more history.
