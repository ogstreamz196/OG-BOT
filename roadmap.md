- [x] Verify and fix refer-to-earn end to end
- [x] Show the full global playlist in the global player
- [x] Offer 3 credits or 99p for global-track downloads
- [x] Verify relevant tests and preview
- [x] Default fresh tracks to Global while preserving per-track choice
- [x] Add referral, published-track, and player-activity dashboard to Earn
- [x] Sync Android live URL and publish ogbot.co.uk
- [x] Generate and verify four Global profanity-level tracks: Clean, Mild, Strong, Savage
- [x] Credit referral earnings from successful real payments exactly once
- [x] Update Earn balances and payment earnings live
- [x] Run end-to-end referral/payment and track-generation checks
- [x] Add the Privacy Policy link to the signed-in home page
- [x] Keep Messenger conversations and composers visible above mobile keyboards
- [x] Add an explicit browser-to-Android sign-in return for installed builds with /app-return support (no website-link verification needed)
- [x] Restrict APK welcome to manual account form and add a D.EV Google sign-in button; preserve web welcome
- [x] Allow Boss to delete non-privileged user accounts from user settings
- [x] Redesign web and APK sign-in forms with centred headings and clear input fields
- [x] Make the D.EV browser return use a direct-tap Android intent on both sign-in return pages
- [x] Restore files lost in the workspace move (payments/store/PurchaseHistory/webhooks/onboarding/Stripe helpers) and wire the RevenueCat VIP paywall UI on Settings
- [x] Vary song openings, enforce selected styles/languages and minimum length, and replace Any voice with Mix voice
- [x] Route all app AI through the owner's Gemini account with no Lovable AI fallback
- [x] Share chat work between Gemini and ChatGPT, use Perplexity for live facts, and increase small Battle rewards

## App upgrades (Sep 2026)

- [x] Auto-generate track titles when the title is left blank
- [x] Persistent mini-player across every page
- [x] Quick top-up sheet when coins run low mid-creation
- [x] Battle Zone daily streak bonuses + Roast of the Day
- [x] Shareable lyric card (9:16) stamped with the referral link
- [x] Daily free coin drop (1-3 coins, once per day, server-issued)
- [x] "Use this vibe" remix button on library and global tracks
- [x] Purchase-complete page after card checkout (/buy-coins/return)
- [x] Enlarge and polish private and global Messenger typing areas, then verify phone behavior
- [x] Share tracks with audio, OG BOT branding, and a permanent track-specific listening link

## Library Phase 2

- [x] Build two-tier track rows with metadata chips, seek bar, and action drawer
- [x] Add All, Unlocked, and Styles Library filters
- [ ] Walk generation, player, shuffle, and second-take playback end to end
- [x] Verify the finished Library experience on mobile

## Generation reliability (Oct 2026)

- [x] Remove one/two-track choice; include Take 2 free when first track is paid/unlocked
- [x] Show two tracks for the price of one on coin/card payment selection and verify both paths

- [x] Move web installation prompt to the top with Install now; exclude native Android
- [x] Enforce lyric slider levels, especially Savage, and verify targeted tests

- [x] Automatically recover or retry failed track generations in the background without charging coins
- [x] Verify retry scheduling, terminal failures, and clean app build

## Pending

- [x] Use the supplied OG-STREAMZ artwork on Welcome back and enlarge both welcome and sign-in logos
- [x] Free AI fallback cascade (Groq, OpenRouter) — waiting on user to add GROQ_API_KEY and OPENROUTER_API_KEY
- [x] Use Lexcel32 as the username example and derive yearly VIP IDs as OG plus the uppercase username

## Later

- [ ] Fix the primary Gemini key (Google says "project denied access") so lyrics stop using the paid backup key — blocked on owner checking Google Cloud

## Native store compliance (Oct 2026)

- [x] Battle Zone Report message / Block user in phone apps
- [x] iOS privacy manifest
- [x] Android app link package name = og.bot
- [x] Platform-correct store wording, no web checkout links in apps
- [ ] iOS production RevenueCat key — pending (owner to supply)
- [ ] Age rating questionnaires 16+/17+ at store submission (owner)
