# One API & Integrations hub in Boss Controls

## What you get
One page, Boss Controls → System → **API & Integrations**, that replaces the separate "API keys", "Health" and "Ledgerly" tabs. Every key the app uses appears as a card with:
- Status badge (Working / Needs attention / Missing) and response time
- **Ping** button that tests that one key live
- **Replace key** button that opens the secure key form (keys never show in the page)
- Short note on what it powers and where to get a new key
- A **Ping all** button at the top

## Keys found and how they'll be grouped
| Group | Keys |
|---|---|
| AI chat & lyrics | OpenRouter (main + backup, the Foul Mouth model), Gemini (main + paid emergency backup), Groq (main + backup), Pollinations (main + backup), Perplexity (web search) |
| Music | Suno (shows credits left) |
| Payments | Stripe secret key, Stripe publishable key |
| Bookkeeping | Ledgerly: on/off switch, paste key, Test connection, last sync time, last error (moved here unchanged) |
| Telegram | OG Bot token, Telegram connection, webhook status |
| Google | Drive (purchase review/backups), Sheets (sync) |
| Bot hosting | OG_BOT_HOST, mothership URL, remote signing secret |

Other on/off switches found: only the Ledgerly sync toggle relates to APIs. It moves into the hub. No other API toggles remain (the free/paid AI toggle was removed earlier).

## Clean-up
- Delete the old placeholder "API keys" page (Suno-only instructions) and the separate Health/Ledgerly tabs; old links redirect to the new hub.
- Delete leftover `mem_index_update.txt` at the project root.
- Remove stale OpenAI wording (e.g. Telegram "ChatGPT quota" message, comment in AI routing).

## Technical details
- New server fn `pingApiKey({ key })` (admin-checked via has_role) reusing probes in `api-health.functions.ts`; add probes for Groq/OpenRouter/Pollinations/Gemini backup (tiny `max_tokens:1` call), Stripe (`/v1/balance`), Drive/Sheets via connector gateway.
- `ApiHub.tsx` renders a registry `API_REGISTRY` (key, label, group, docs URL, probe id). Ledgerly card embeds existing `LedgerlyPanel`.
- "Replace key" is handled by me through the secure secret form (in-app writing of server secrets is unsafe); the card shows the exact phrase to send, e.g. "replace GROQ_API_KEY".
- TABS in `admin.system.tsx`: health/keys/ledgerly merged into `apis`.
