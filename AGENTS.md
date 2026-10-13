## Privacy

- Collect only account-linking data and service records; never collect location, IP-derived geography, full device fingerprints, or page-by-page activity because Play Store privacy minimisation is a product requirement.

## Coin integrity

- Owner track purchases use an authenticated server function and service-only atomic purchase RPC; database entitlement triggers reveal bonus siblings on payment or late insertion, preventing duplicate charges and browser-dependent grants.

- Issue welcome and Battle rewards only through service-only atomic database functions because retries, concurrency, and client calls must not duplicate coins.
- Assign yearly VIP IDs through the service-only database function as `OG` plus the uppercase username, and synchronize the ID when that username changes.
- Keep browser OAuth return separate from Android App Links and use a prebuilt, package-targeted intent anchor on the return page; Chrome requires a direct tap, and the installed APK must already handle /app-return.
- On the native Capacitor welcome screen show only the manual account form (no Google or Apple entry at all); leave web OAuth unchanged so existing website access remains intact.
- Boss account deletion runs in an authenticated server function with a server-checked role and protected targets, because client-side role visibility must never authorize destructive actions.

- Referral cashback is 6% of coins a referred member spends, 13% only when the leader is actually VIP (VIP role, admin/boss, or active paid subscription; never the 15-day intro offer); it is accrued in hundredths via pay_referral_cashback so small spends are not rounded away, and no cashback is paid on VIP upgrades or card payments.
- Guest Battle Zone mirrors the member room without the Go Private toggle: 5 roasts per guest, history from their first line, a fixed banter name from src/lib/guest-names.ts (plain data, no AI changes), and roasts judged like members' with winnings stored on their lines; claim_guest_battle moves them into the purse once per account and guest id.
- Creating a song is free but needs at least 5 coins; after 3 unpaid tracks (not unlocked, since the member's last own-track unlock) each new sample costs 2 coins, checked and charged atomically by start_generation_charge in suno-generate.

## AI providers

- Lyric intensity and the OG dictionary are enforced in the songwriter prompt only; never reject non-empty provider lyrics for profanity density, because post-check rejections exhausted the time budget and failed songs.
- Preserve submitted music lyrics on provider moderation rejection and return the rejection without automatic word substitutions; the selected explicit level must not silently become a radio edit.

- Ordinary text chat goes to keyed free tiers first (Groq, Pollinations, OpenRouter), with paid Gemini first only for media or heuristic "pro" questions and otherwise as fallback when free tiers fail, to save paid credits; there is no Boss toggle. Use `PERPLEXITY_API_KEY` only for live web facts and never use Lovable AI for end-user inference. With Foul Mouth on, only the free model that passed the live swearing test (OpenRouter nemotron-3-super) is used before Gemini, because Groq and Pollinations stay too polite.
- Lyrics run on free keys first, then Gemini (primary key, then backup key across several models); OpenAI is not used anywhere, because the owner removed it.
- `GEMINI_BACKUP_API_KEY` is the owner's paid emergency key: use it only for lyrics and image edits, after the primary key fails (401/403/404/429/5xx) — never for ordinary chat, because it costs real money.
- Battle Zone learns slang via the service-only `learn_battle_words` function (words only, no user ids, slur blocklist) and feeds popular words into the foul prompt.

## Public track sharing

- Public share pages may serve only completed, public, revealed tracks through short-lived signed audio URLs, so private and hidden tracks cannot leak.

## Library playback

- The shared playlist controller exclusively switches tracks and pauses the previous audio element, preventing overlapping playback across rows and takes.

## Generation recovery

- Failed music jobs use database-claimed, bounded background retries that recover an existing provider task before resubmitting the saved payload, preventing duplicate work or coin charges.

## Chat image edits

- Private-chat image editing was removed; OG Bot only reads and discusses images.

## Sports Guide

- Sports Guide posts are mirrored from the Telegram sports group by the existing bot webhook into a database table and read only by owners of the Sports Guide store item, so the in-app page is the paid product rather than a Telegram invite.

## Bot catchphrases

- Mount the browser installation banner before the route outlet and gate its event listener on Capacitor native/standalone detection; keep it in page flow so it cannot cover Android or web navigation.

- Telegram and web/in-app OG Bot replies take openers/closers from the shared service-only catchphrase bank with per-user unseen rotation and background free-tier refills, so greeting banter costs no premium tokens; Battle Zone stays freshly generated each message.
- OG Bot chat reads/discusses images only (no image editing); chat errors go through src/lib/og-error-message.ts so users never see raw codes.
- OG Bot prompts get a Boss-only or non-Boss permission block from buildSystemPrompt; only admin/boss roles may discuss Boss Controls.

- Lyrics: free Google AI Studio keys (GEMINI_FREE_API_KEY, GEMINI_FREE_BACKUP_API_KEY, GEMINI_FREE_3_API_KEY) run after Groq/Pollinations/OpenRouter and before paid Gemini keys, because the owner wants to save paid credits.
- Creation stages a draft row with an `orchestration` payload first; the suno-retry worker resumes orphaned drafts server-side, surviving dropped phones.
- generate-lyrics uses the offline songwriter when all AI keys fail; key failures (name/status only) go to ai_key_failures for Boss alerts.

## Search and AI search

- /welcome runs only in the browser, so its pendingComponent (src/components/seo/WelcomeSeoFallback.tsx) is the server-rendered copy crawlers read; keep its wording copied from the landing page. Canonical addresses live in src/lib/seo.ts ("/" points at /welcome), and /sitemap-tracks.xml lists only completed, public, revealed tracks.
- OG Bot diss ambush: the server decides when to pitch (src/lib/diss-ambush.ts, marker stored in the chat thread) and charges/refunds diss tracks via the idempotent service-only RPCs in src/lib/diss-track.functions.ts, so the browser never moves coins itself.
