-- Telegram screens get a kind: "welcome" is the welcome after /start or a
-- clear, which OG B0T swaps for a short permanent intro as soon as the
-- member does anything; every other row is an ordinary "screen".
ALTER TABLE public.telegram_screen_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'screen';

DO $$
BEGIN
  ALTER TABLE public.telegram_screen_messages
    ADD CONSTRAINT telegram_screen_messages_kind_check CHECK (kind IN ('screen', 'welcome'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
