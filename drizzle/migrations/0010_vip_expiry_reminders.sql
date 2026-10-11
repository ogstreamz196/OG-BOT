CREATE TABLE public.vip_expiry_reminders (
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, expires_at, kind)
);
GRANT ALL ON public.vip_expiry_reminders TO service_role;
ALTER TABLE public.vip_expiry_reminders ENABLE ROW LEVEL SECURITY;