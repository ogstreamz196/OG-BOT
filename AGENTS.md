Subdirectories (e.g. src/components/welcome) have their own AGENTS.md; read it before changing files there.

## Privacy

- Collect only account-linking data and service records; never location, IP geography, device fingerprints or page-by-page activity (Play Store minimisation).

## Coins and access

- All coin moves (track purchases, welcome/Battle rewards, VIP IDs, diss-track charges/refunds) go through authenticated server functions and service-only atomic, idempotent RPCs, so retries or client calls never duplicate or authorise coin changes.
- VIP IDs are `OG` + uppercase username via the service-only function, synced on username change.
- Boss account deletion: authenticated server function, server-checked role, protected targets.
- Referral cashback: 6% of a referee's coin spend, 13% only for genuinely VIP leaders (never the intro offer), accrued in hundredths via pay_referral_cashback; none on VIP upgrades or card payments.
- Song creation needs ≥5 coins; after 3 unpaid tracks each sample costs 2, charged by start_generation_charge.
- Diss ambush timing lives in src/lib/diss-ambush.ts (marker in the chat thread); charge/refund in src/lib/diss-track.functions.ts.

## Native apps

- Browser OAuth return stays separate from Android App Links, via a package-targeted intent anchor on /app-return (Chrome needs a direct tap).
- Native welcome screen shows only the manual account form; web OAuth unchanged.
- Install popup ("Add shortcut") mounts before the route outlet, gated on Capacitor/standalone detection; reappears each visit until install is detected (appinstalled/standalone flag).

## AI

- Chat: free tiers (Groq, Pollinations, OpenRouter) first; paid Gemini only for media/"pro" or fallback. Foul Mouth on: only OpenRouter nemotron-3-super before Gemini. Perplexity only for live facts. Never Lovable AI or OpenAI for user inference.
- Lyrics: free tiers, then GEMINI_FREE_* keys, then paid Gemini; `GEMINI_BACKUP_API_KEY` only for lyrics after the primary fails. Offline songwriter if all fail; key failures go to ai_key_failures.
- Dictionary/intensity live in the songwriter prompt only; never reject lyrics for profanity density, and never auto-substitute words on moderation rejection.
- Battle Zone learns slang via service-only `learn_battle_words`; OG Bot openers come from the service-only catchphrase bank.
- OG Bot reads images only; errors via src/lib/og-error-message.ts; buildSystemPrompt limits Boss Controls talk to admin/boss.

## Tracks

- Share pages serve only completed, public, revealed tracks via short-lived signed URLs.
- Playlist controller pauses the previous audio when switching.
- Creation stages a draft with an `orchestration` payload; suno-retry resumes drafts with bounded, database-claimed retries that recover existing provider tasks first.

## Other

- Sports Guide posts mirror the Telegram group into a table readable only by item owners.
- /welcome is browser-only; its pendingComponent (src/components/seo/WelcomeSeoFallback.tsx) is crawler copy matching the landing page. Canonicals in src/lib/seo.ts; /sitemap-tracks.xml lists only completed, public, revealed tracks.
- The landing page's first screen is the master logo (src/assets/og-bot-master-logo.webp, a compressed copy of app-background.png that also serves as the site wallpaper), the headline, and the Battle Zone and Music Hub cards; keep both cards above the fold on phones. Card buttons stretch over the whole card, so they opt out of the global button press scale (active:transform-none) and avoid filter effects, either of which shrinks the tap area to the button.
