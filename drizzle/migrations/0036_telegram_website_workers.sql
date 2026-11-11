CREATE TABLE public.telegram_worker_bots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bot_id bigint NOT NULL UNIQUE,
 name text NOT NULL,
 username text NOT NULL,
 role text NOT NULL DEFAULT 'assistant' CHECK (role IN ('trade','assistant')),
 instructions text NOT NULL DEFAULT '',
 token_ciphertext text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 webhook_connected boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_worker_bots TO service_role;
REVOKE ALL ON public.telegram_worker_bots FROM PUBLIC, anon, authenticated;
ALTER TABLE public.telegram_worker_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_signals ADD COLUMN IF NOT EXISTS sender_worker text;
CREATE TABLE public.telegram_worker_updates (
 worker_id uuid NOT NULL REFERENCES public.telegram_worker_bots(id) ON DELETE CASCADE,
 update_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (worker_id, update_id)
);
GRANT ALL ON public.telegram_worker_updates TO service_role;
REVOKE ALL ON public.telegram_worker_updates FROM PUBLIC, anon, authenticated;
ALTER TABLE public.telegram_worker_updates ENABLE ROW LEVEL SECURITY;