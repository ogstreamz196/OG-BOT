-- Telegram groups OG B0T (the Gaffer) runs. Worker bots (first: the OG Trade
-- Bot) only operate in a group while OG B0T is in it (og_bot_present), and only
-- the workers switched on for that group (active_workers) speak there.
-- Kept up to date from OG B0T's own updates (added, removed, messages) and the
-- Boss's "Sync" button. Server-only.
CREATE TABLE IF NOT EXISTS public.telegram_managed_groups (
  chat_id bigint PRIMARY KEY,
  chat_title text,
  chat_type text NOT NULL DEFAULT 'group' CHECK (chat_type IN ('group', 'supergroup', 'channel')),
  og_bot_present boolean NOT NULL DEFAULT false,
  og_bot_added_at timestamptz,
  active_workers jsonb NOT NULL DEFAULT '["trade"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_managed_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_managed_groups FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_managed_groups TO service_role;
