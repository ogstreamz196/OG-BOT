-- Extra AI keys the Boss adds in Boss → System → API keys (free Pollinations,
-- OpenRouter and Gemini keys). Hub only: OG B0T's server reads it with the
-- hub's secret key (OG_HUB_SERVICE_KEY); nobody signed in can read it.
-- Keys are stored encrypted (AES-GCM, src/lib/ai-keys.server.ts), so even
-- the SQL editor never shows one. Idempotent.
CREATE TABLE IF NOT EXISTS og_bot.ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('pollinations', 'openrouter', 'gemini')),
  label text,
  key_enc text NOT NULL,
  key_hint text,
  enabled boolean NOT NULL DEFAULT true,
  last_status text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_keys_provider_idx ON og_bot.ai_keys (provider, created_at);
ALTER TABLE og_bot.ai_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON og_bot.ai_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON og_bot.ai_keys TO service_role;
