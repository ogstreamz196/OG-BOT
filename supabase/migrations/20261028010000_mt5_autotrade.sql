-- MT5 auto-trading (Boss's own Vantage account via MetaApi) and the copy-trade
-- worker bot. Each 70%+ auto-posted gold/bitcoin alert places one trade; the
-- signal watcher follows it to a close and the copy bot announces it.
-- Server-only. Safe to run more than once.

-- Worker bots can now have the "copy" job (announces the Boss's trades).
ALTER TABLE public.telegram_worker_bots
  DROP CONSTRAINT IF EXISTS telegram_worker_bots_role_check;
ALTER TABLE public.telegram_worker_bots
  ADD CONSTRAINT telegram_worker_bots_role_check
  CHECK (role IN ('trade', 'assistant', 'copy'));

CREATE TABLE IF NOT EXISTS public.mt5_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One trade per signal setup (market|direction|entry|stop).
  setup_key text NOT NULL UNIQUE,
  market text NOT NULL,
  label text NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  order_type text NOT NULL,
  volume numeric NOT NULL,
  entry numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  confidence_pct integer,
  -- MT5 ticket of the order; the position it opens has the same id.
  ticket text,
  status text NOT NULL CHECK (status IN ('pending', 'open', 'closed', 'cancelled', 'failed')),
  error text,
  profit numeric,
  expires_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mt5_trades_status_idx ON public.mt5_trades (status);
CREATE INDEX IF NOT EXISTS mt5_trades_created_idx ON public.mt5_trades (created_at DESC);

ALTER TABLE public.mt5_trades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mt5_trades FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mt5_trades TO service_role;
