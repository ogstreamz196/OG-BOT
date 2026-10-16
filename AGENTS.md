Subdirectories (e.g. src/components/welcome) have their own AGENTS.md; read it before changing files there.

## Privacy

- Collect only account-linking data and service records; never location, IP geography, device fingerprints or page-by-page activity (Play Store minimisation).

## Coins and access

- All coin moves (track purchases, welcome/Battle rewards, VIP IDs, diss-track charges/refunds) go through authenticated server functions and service-only atomic, idempotent RPCs, so retries or client calls never duplicate or authorise coin changes.
- VIP IDs are `OG` + uppercase username via the service-only function, synced on username change.
- Boss account deletion: authenticated server function, server-checked role, protected targets.
- Boss member directory (src/lib/admin-members.functions.ts): every member loads in one server call (paged reads, no row cap); the list pages on the client. Account deletes everywhere go through src/components/admin/DeleteAccountDialog.tsx (type DELETE) and never offer Boss or Dev accounts. Member activity shows device type only, never location.
- Boss password reset (user settings): authenticated server function, server-checked role, protected targets; audit-logged without the password.
- Boss account merge (user settings, src/lib/admin-merge-accounts.functions.ts): server-checked role, duplicate must not be privileged; coins move via mint_coins_admin as the Boss (debit duplicate, credit main, never deduct_coins, which pays referral cashback); content is re-owned; the emptied duplicate is left for the Boss to delete; audit-logged.
- Telegram bot links to the site for a linked chat carry a one-time magic-link token (src/lib/telegram-signin.server.ts → /tg) so Telegram's in-app browser signs into the linked account instead of offering sign-up.
- Referral cashback: 6% of a referee's coin spend, 13% only for genuinely VIP leaders (never the intro offer), accrued in hundredths via pay_referral_cashback; none on VIP upgrades or card payments.
- Card-payment return checks (reconcileCoinSession, reconcileTrackUnlock) never pay referral rewards; reconcileCoinSession leaves `store:` sessions to the webhook, which credits store items once under its own reference.
- Store coin purchases (Sports Guide, Vault pass) always confirm price and balance-after first; the old Telegram Sports Guide invite function stays switched off.
- Tracks are paid before cooking via the pay step (src/components/library/PayChoiceDialog.tsx): coins_per_full_unlock coins through prepay_track, or £0.99 by card on the website (draft without a plan → track-unlock checkout → startGuestTrack once the unlock row exists). start_generation_charge still guards the minimum for unpaid samples.
- Guest tracks (website only, src/components/welcome/GuestStudio.tsx + src/lib/guest-track.functions.ts, whose card checkout/start functions members use too): a silent anonymous session stages a draft with no plan; the 99p card unlock (kind "track_unlock") pays for it; startGuestTrack attaches the plan only once the unlock row exists; claimGuestTracks moves paid tracks into the account after sign-in and drops unpaid drafts. Anonymous sessions get no bootstrap (welcome coins, device slot, roles, referral), no new-member alert, no RevenueCat id, and are kept out of /_authenticated. If anonymous sign-ins are off, guests fall back to signing up first.
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
