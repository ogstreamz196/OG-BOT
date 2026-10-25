-- Auto-posted scalp signals: every minute /api/public/signal-scan builds the
-- gold and bitcoin 5-minute scalps and posts any at the top confidence score
-- to the signals channel (signal-broadcast.server.ts). This remembers what was
-- posted so a market isn't posted again while its last post is still valid,
-- unless the new signal goes the other way. Server-only.
CREATE TABLE IF NOT EXISTS public.signal_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  timeframe text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  confidence_pct integer NOT NULL,
  entry numeric NOT NULL,
  expires_at timestamptz NOT NULL,
  message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_broadcasts_market_idx
  ON public.signal_broadcasts (market, expires_at DESC);

ALTER TABLE public.signal_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_broadcasts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signal_broadcasts TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('signal-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'signal-scan',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://project--07659a42-5b68-4c8b-83b5-ee9a625dbb92.lovable.app/api/public/signal-scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ogbot-retry-token', (SELECT token FROM private.song_retry_scheduler WHERE singleton = true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);
