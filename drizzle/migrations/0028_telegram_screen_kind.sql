ALTER TABLE public.telegram_screen_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'screen';

DO $$
BEGIN
  ALTER TABLE public.telegram_screen_messages
    ADD CONSTRAINT telegram_screen_messages_kind_check CHECK (kind IN ('screen', 'welcome'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;