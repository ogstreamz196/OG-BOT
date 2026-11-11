-- lovable-cron-fallback-reviewed: 1-minute signal tracking requires per-minute candle checks; entry fills and stop hits on 1m/15m timeframes must be detected promptly, so a less frequent schedule would miss outcomes. User explicitly requested this exact migration.
-- Telegram trade signals, followed after they're sent: the watcher
-- (/api/public/trade-signal-watch, every minute) records fills, targets,
-- stops, trend flips and time-ups, messages the member, and the 30-day
-- results become the track record shown on new signals. Server-only.
CREATE TABLE IF NOT EXISTS public.trade_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  chat_id bigint,
  message_id bigint,
  market text NOT NULL,
  label text NOT NULL,
  feeds jsonb NOT NULL DEFAULT '{}'::jsonb,
  style text NOT NULL,
  timeframe text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry numeric NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('market', 'limit')),
  stop numeric NOT NULL,
  tp1 numeric NOT NULL,
  tp2 numeric NOT NULL,
  tp3 numeric NOT NULL,
  confidence_pct integer NOT NULL,
  quality text NOT NULL,
  decimals integer NOT NULL DEFAULT 2,
  pip numeric,
  card text,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('pending', 'open', 'tp1', 'tp2', 'tp3', 'stopped', 'breakeven', 'expired', 'unfilled', 'cancelled')
  ),
  best_target integer NOT NULL DEFAULT 0,
  entered_at timestamptz,
  closed_at timestamptz,
  last_price numeric,
  last_candle_at timestamptz,
  last_checked_at timestamptz,
  last_edit_at timestamptz,
  last_trend_check_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The watcher's every-minute scan (active signals only, so it stays tiny).
CREATE INDEX IF NOT EXISTS trade_signals_active_idx
  ON public.trade_signals (created_at)
  WHERE status IN ('pending', 'open', 'tp1', 'tp2');
-- Track record per market and timeframe over the last 30 days.
CREATE INDEX IF NOT EXISTS trade_signals_record_idx
  ON public.trade_signals (market, timeframe, created_at DESC);

ALTER TABLE public.trade_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trade_signals TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('trade-signal-watch');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'trade-signal-watch',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://project--07659a42-5b68-4c8b-83b5-ee9a625dbb92.lovable.app/api/public/trade-signal-watch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ogbot-retry-token', (SELECT token FROM private.song_retry_scheduler WHERE singleton = true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);