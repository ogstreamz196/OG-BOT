CREATE TABLE public.community_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_blocks TO authenticated;
GRANT ALL ON public.community_blocks TO service_role;
ALTER TABLE public.community_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own blocks readable" ON public.community_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
CREATE POLICY "Own blocks insert" ON public.community_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "Own blocks update" ON public.community_blocks FOR UPDATE TO authenticated USING (blocker_id = auth.uid()) WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "Own blocks delete" ON public.community_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

CREATE TABLE public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  reported_user_id uuid,
  reason text NOT NULL DEFAULT 'abusive',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, message_id)
);
GRANT ALL ON public.community_reports TO service_role;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;