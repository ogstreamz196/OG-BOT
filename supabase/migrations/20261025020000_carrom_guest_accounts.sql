-- OG CARROM guests who become OG B0T members: each guest pass (made when a
-- guest taps OG CARROM on the landing page) can create one account, recorded
-- here so a retried or copied pass reuses it instead of making another.
-- Server-only.
CREATE TABLE IF NOT EXISTS public.carrom_guest_accounts (
  guest_id text PRIMARY KEY,
  user_id uuid,
  username text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The hourly cap on new carrom accounts counts recent rows.
CREATE INDEX IF NOT EXISTS carrom_guest_accounts_created_idx
  ON public.carrom_guest_accounts (created_at DESC);

ALTER TABLE public.carrom_guest_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carrom_guest_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.carrom_guest_accounts TO service_role;
