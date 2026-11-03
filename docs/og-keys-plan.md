# OG KEYS: plan (not started)

The Boss's ask (2026-11-03): a separate app just for the Boss's keys and
passwords, a password manager for them only at first, and later an add-on
other apps can plug into, the way OG Ledger is. Working name **OG KEYS**
(easy to change). Nothing is built yet; the Boss is low on Lovable credits.

## What exists today

- OG B0T's **API vault** (Boss → System → API keys, `ExtraAiKeysPanel`,
  #217): extra free Pollinations, OpenRouter and Gemini keys, AES-GCM
  sealed, stored in the OGSTREAMZ hub's `og_bot.ai_keys`, read by OG B0T's
  server with `OG_HUB_SERVICE_KEY`. This is the first piece of OG KEYS.
- A **coming-soon card** for OG KEYS on the landing page and the members'
  home (last card in the mode grid, art `src/assets/og-keys*.webp` from
  `scripts/brand/make-og-keys-teaser.py`). It only shows a "coming soon"
  message; replace its `onClick` with the real link when the app exists.

## The plan

1. **Its own repo and app** (the Boss creates an empty private GitHub repo,
   for example `ogstreamz196/og-keys`; Claudes can't create repos). Same
   stack as the other OGSTREAMZ apps, hosted on Cloudflare (no Lovable), its
   own `og_keys` schema in the OGSTREAMZ hub. Address like
   `keys.ogstreamz.co.uk`.
2. **Boss only at first:** sign in with the two D.EV emails only, plus a
   second factor (passkey or authenticator app). Everything sealed on the
   server with a key that never sits in the database.
3. **What it stores:** passwords (site, username, password, notes), API
   keys (provider, key, which apps use it), secure notes. Copy buttons,
   never shown in full unless revealed, a log of every reveal.
4. **Move OG B0T's API vault into it:** OG KEYS becomes the place keys are
   added; OG B0T (and later STAYZ, Vault, Ledger) asks OG KEYS for "the
   keys for provider X" over a server-to-server call with its own app
   token, and keeps today's secrets as the fallback.
5. **Add-on later:** like OG Ledger, other people's portals could switch it
   on for their own team, each company sealed apart.

## What the Boss will need to do when it's built

- Create the empty GitHub repo and tell a Claude its name.
- Point a subdomain at it in Cloudflare (a Claude gives the exact record).
- Add one or two secrets in Cloudflare (a sealing key and the hub key).
- Set up their passkey or authenticator app on first sign-in.
