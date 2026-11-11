-- The signal learning loop's growing history: every past setup it replays
-- (tuning-free: raw levels, the candles after, the chart setups showing) is
-- kept here, so each study only replays what's new and adds a week further
-- back, building up to 90 days to learn from. Samples older than 120 days are
-- deleted by the loop. Server-only.
CREATE TABLE IF NOT EXISTS public.signal_learn_samples (
  market text NOT NULL,
  version integer NOT NULL,
  t bigint NOT NULL,
  sample jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, version, t)
);

ALTER TABLE public.signal_learn_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_learn_samples FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signal_learn_samples TO service_role;
