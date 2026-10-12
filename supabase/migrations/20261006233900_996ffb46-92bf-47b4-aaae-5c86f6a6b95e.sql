CREATE TABLE public.telegram_ephemeral_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  delete_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, message_id)
);
GRANT ALL ON public.telegram_ephemeral_messages TO service_role;
ALTER TABLE public.telegram_ephemeral_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX telegram_ephemeral_messages_due_idx ON public.telegram_ephemeral_messages (delete_at);