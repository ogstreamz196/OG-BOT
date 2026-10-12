CREATE TABLE public.sports_guide_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_message_id bigint NOT NULL,
  chat_id bigint NOT NULL,
  raw_text text NOT NULL,
  sport_category text NOT NULL DEFAULT 'general',
  event_time text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, telegram_message_id)
);
GRANT SELECT ON public.sports_guide_posts TO authenticated;
GRANT ALL ON public.sports_guide_posts TO service_role;
ALTER TABLE public.sports_guide_posts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_sports_guide_access(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sports_guide_access WHERE user_id = _user AND status <> 'revoked')
      OR public.has_role(_user, 'admin') OR public.has_role(_user, 'boss')
$$;

CREATE POLICY "Owners of Sports Guide can read posts" ON public.sports_guide_posts
FOR SELECT TO authenticated USING (public.has_sports_guide_access(auth.uid()));

CREATE INDEX sports_guide_posts_posted_idx ON public.sports_guide_posts (posted_at DESC);
CREATE TRIGGER sports_guide_posts_updated BEFORE UPDATE ON public.sports_guide_posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.sports_guide_posts;