-- Shadow trades: setups the bot did NOT send (under the 70% alert bar, a wait
-- the engine chose and why, or an alert the AI desk turned down), followed
-- silently with the tracker's rules so the Boss's signal report can show
-- whether each filter is earning its place. Never posted, never counted in
-- the results book or the record. One per market per 5 minutes (key).
-- Server-only.
CREATE TABLE IF NOT EXISTS public.signal_shadows (
  key text PRIMARY KEY,
  market text NOT NULL,
  label text NOT NULL,
  timeframe text NOT NULL DEFAULT '5M',
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry numeric NOT NULL,
  entry_type text NOT NULL,
  stop numeric NOT NULL,
  tp numeric NOT NULL,
  confidence_pct integer NOT NULL,
  reason text NOT NULL,
  decimals integer NOT NULL DEFAULT 2,
  pip numeric,
  "offset" numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  outcome text CHECK (outcome IN ('win', 'loss', 'flat', 'unfilled')),
  pips numeric,
  entered_at timestamptz,
  last_candle_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS signal_shadows_status_idx
  ON public.signal_shadows (status, created_at);
CREATE INDEX IF NOT EXISTS signal_shadows_created_idx
  ON public.signal_shadows (created_at DESC);

ALTER TABLE public.signal_shadows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_shadows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signal_shadows TO service_role;
