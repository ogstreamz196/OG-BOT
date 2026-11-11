-- Telegram group battles: who each line is from (or, for OG B0T's lines, who
-- it was answering) and the Telegram message id, so a burst of messages from
-- one person gets one reply to the latest, and spammers go on slow mode.
-- "slow" rows record that a slow-mode notice was sent. Still kept 24 hours.
ALTER TABLE public.telegram_group_lines
  ADD COLUMN IF NOT EXISTS telegram_user_id bigint,
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint;

ALTER TABLE public.telegram_group_lines
  DROP CONSTRAINT IF EXISTS telegram_group_lines_role_check;
ALTER TABLE public.telegram_group_lines
  ADD CONSTRAINT telegram_group_lines_role_check CHECK (role IN ('user', 'bot', 'slow'));

CREATE INDEX IF NOT EXISTS telegram_group_lines_user_idx
  ON public.telegram_group_lines (chat_id, telegram_user_id, created_at DESC);
