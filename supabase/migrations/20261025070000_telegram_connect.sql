-- Connecting a Telegram account from Telegram itself. OG B0T sends a member a
-- one-time link to ogbot.co.uk in their private chat; whoever signs in or
-- creates an account through it gets that Telegram linked. Only a hash of the
-- link's token is stored; it works once, for 24 hours. Server-only.
CREATE TABLE IF NOT EXISTS public.telegram_connect_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  telegram_user_id bigint NOT NULL,
  telegram_username text,
  telegram_first_name text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_connect_tokens_expires_idx
  ON public.telegram_connect_tokens (expires_at);

ALTER TABLE public.telegram_connect_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_connect_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_connect_tokens TO service_role;

-- In a group, people without an OG B0T account are asked to connect at most
-- once a day per group: this remembers when each one was last asked.
CREATE TABLE IF NOT EXISTS public.telegram_group_nudges (
  chat_id bigint NOT NULL,
  telegram_user_id bigint NOT NULL,
  nudged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, telegram_user_id)
);

ALTER TABLE public.telegram_group_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_group_nudges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_group_nudges TO service_role;
