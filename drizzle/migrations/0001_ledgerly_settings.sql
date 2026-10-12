CREATE TABLE public.ledgerly_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  api_key text,
  last_test_ok boolean,
  last_test_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ledgerly_settings TO service_role;
ALTER TABLE public.ledgerly_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.ledgerly_settings (id) VALUES (1) ON CONFLICT DO NOTHING;