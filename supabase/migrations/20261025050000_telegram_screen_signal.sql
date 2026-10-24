-- Telegram screens get a fourth kind, "signal": a followed signal card and
-- the updates sent under it. A member's next signal deletes them, so only
-- the latest signal is ever in the chat. Safe to run before or after the
-- earlier telegram_screen_messages migrations.
ALTER TABLE public.telegram_screen_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'screen';

ALTER TABLE public.telegram_screen_messages
  DROP CONSTRAINT IF EXISTS telegram_screen_messages_kind_check;

ALTER TABLE public.telegram_screen_messages
  ADD CONSTRAINT telegram_screen_messages_kind_check
  CHECK (kind IN ('screen', 'welcome', 'keys', 'signal'));
