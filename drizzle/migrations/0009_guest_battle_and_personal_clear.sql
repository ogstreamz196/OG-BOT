ALTER TABLE public.community_messages ADD COLUMN IF NOT EXISTS guest_id text;
CREATE INDEX IF NOT EXISTS community_messages_guest_idx ON public.community_messages (guest_id, created_at) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_messages_user_created_idx ON public.community_messages (user_id, created_at);

CREATE TABLE public.community_history_clears (
  user_id uuid PRIMARY KEY,
  cleared_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.community_history_clears TO service_role;
ALTER TABLE public.community_history_clears ENABLE ROW LEVEL SECURITY;