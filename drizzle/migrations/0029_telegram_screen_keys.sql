-- Telegram screens get a third kind, "keys": the message carrying the
-- current bottom bar (main buttons or the signal buttons). Telegram hides
-- the bar when that message is deleted, so tidying never touches it; it's
-- only swapped when the bar changes. Safe to run before or after
-- 20261025030000_telegram_screen_kind.sql.
ALTER TABLE public.telegram_screen_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'screen';

ALTER TABLE public.telegram_screen_messages
  DROP CONSTRAINT IF EXISTS telegram_screen_messages_kind_check;

ALTER TABLE public.telegram_screen_messages
  ADD CONSTRAINT telegram_screen_messages_kind_check
  CHECK (kind IN ('screen', 'welcome', 'keys'));
