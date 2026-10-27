-- What the signal flow has posted in the signals chat (SIGNALS_CHANNEL_ID):
-- alert cards and the updates under them (by market), and the scoreboard.
-- A new alert for a pair deletes that pair's older card and updates; the
-- scoreboard is replaced so today's score always sits at the bottom.
-- Server-only.
CREATE TABLE IF NOT EXISTS public.signal_chat_messages (
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  market text,
  kind text NOT NULL CHECK (kind IN ('card', 'update', 'score')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS signal_chat_messages_market_idx
  ON public.signal_chat_messages (chat_id, market, kind);

ALTER TABLE public.signal_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_chat_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signal_chat_messages TO service_role;
