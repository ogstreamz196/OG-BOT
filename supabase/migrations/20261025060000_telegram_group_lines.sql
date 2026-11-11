-- Telegram group battles: the lines aimed at OG B0T in a group (sender's
-- first name and text) and OG B0T's replies, kept for 24 hours so it can
-- remember who's piling on and roast them personally, then deleted. Never
-- linked to an account. Server-only.
CREATE TABLE IF NOT EXISTS public.telegram_group_lines (
  id bigserial PRIMARY KEY,
  chat_id bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'bot')),
  name text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_group_lines_chat_idx
  ON public.telegram_group_lines (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_group_lines_created_idx
  ON public.telegram_group_lines (created_at);

ALTER TABLE public.telegram_group_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_group_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_group_lines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_group_lines_id_seq TO service_role;
