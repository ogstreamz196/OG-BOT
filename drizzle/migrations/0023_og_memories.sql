-- OG Bot memory: short facts a member tells OG Bot in private chat (their
-- team, rap name, the mate they roast), so it remembers them across devices.
-- Only the server writes them; members can read and delete their own, and
-- switch memory off. Rows go when the account is deleted.

CREATE TABLE IF NOT EXISTS public.og_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS og_memories_user_fact_idx
  ON public.og_memories (user_id, lower(fact));
CREATE INDEX IF NOT EXISTS og_memories_user_recent_idx
  ON public.og_memories (user_id, updated_at DESC);

GRANT SELECT, DELETE ON public.og_memories TO authenticated;
GRANT ALL ON public.og_memories TO service_role;

ALTER TABLE public.og_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view own memories" ON public.og_memories;
CREATE POLICY "Members view own memories"
  ON public.og_memories FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members delete own memories" ON public.og_memories;
CREATE POLICY "Members delete own memories"
  ON public.og_memories FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- On by default; members can switch it off in Settings.
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS og_memory boolean NOT NULL DEFAULT true;