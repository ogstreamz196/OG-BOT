-- Telegram "screens": the messages OG B0T shows when a member taps a button
-- (menu, VIP, Vault, tracks, the signals picker, "no trade" cards). The next
-- screen deletes the previous ones so the chat stays clutter-free; typed
-- questions and their answers are never stored here. Server-only.
CREATE TABLE IF NOT EXISTS public.telegram_screen_messages (
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

ALTER TABLE public.telegram_screen_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_screen_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_screen_messages TO service_role;
