-- The bot's results book: every gold and bitcoin signal that hits a target
-- (a win, with the pips to the furthest target reached) or its stop loss
-- first (a loss), written by the signal watcher as it happens. OG B0T reads
-- it to answer "how much did we make today / yesterday / since the weekend".
-- The same setup sent to several chats counts once (setup_key). Server-only.
CREATE TABLE IF NOT EXISTS public.signal_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_key text NOT NULL UNIQUE,
  signal_id uuid,
  market text NOT NULL,
  label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss')),
  best_target integer NOT NULL DEFAULT 0,
  pips numeric NOT NULL,
  unit text NOT NULL CHECK (unit IN ('pips', 'points')),
  decided_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_results_decided_idx
  ON public.signal_results (decided_at DESC);

ALTER TABLE public.signal_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signal_results TO service_role;
