/** Ledgerly-style prompt for the other Lovable project. Built from the live origin, never hard-coded. */
export function buildVaultReceiverPrompt(origin: string) {
  const base = `${origin.replace(/\/$/, "")}/api/public/v1/vault`;
  return `Add an "OG Vault Pass Sync" integration to this app's Boss Controls, inside the VIP users section.

1. Admin card "OG Vault Pass Sync" (Boss/admin only)
- "Enable OG Vault Sync" toggle, OFF by default. Nothing is called while it's off or no key is saved.
- "OG Vault API Key" password field (placeholder "ogv_..."). Store it server-side only (secure settings table). Never send the full key to the browser; show it masked, e.g. "ogv_••••••••abcd". Allow replace/remove.
- "Test Connection" button -> backend calls:
  GET ${base}/ping
  Header: Authorization: Bearer <KEY>
  - 200 { ok: true, key_name, active_credentials } -> show "Connected to OG BOT Vault (N active logins)"
  - 401 -> "Invalid or revoked API key"
- Status badge (Not configured / Connected / Error), last successful sync time, last error.
- "Sync now" button and a read-only list of synced logins (username, active, note).

2. Server-side sync (server only, never browser code)
- GET ${base}/credentials  (Authorization: Bearer <KEY>)
  Response: { ok: true, credentials: [{ username, password, note, active, created_at }] }
- Save into a vault_credentials table (username unique case-insensitive, password, note, active, synced_at). RLS on, no public read.
- Upsert by username; mark rows missing from the response as inactive.
- Run on "Sync now" and automatically every 15 minutes. 6-second timeout, non-blocking: a failure must never break this app — log it and save the last error for the admin card.

3. Login check
- When a user enters a Vault username + PIN, accept only if an active synced row matches. For a live check you can call:
  POST ${base}/verify  (Authorization: Bearer <KEY>, JSON { "username": "...", "pin": "..." })
  Response: { ok: true, valid: true|false }

4. Don't break any existing logic. Add a help note: "Copy the key from OG BOT → Boss Controls → API & Integrations → OG Vault API, paste it here, then press Test Connection."`;
}
