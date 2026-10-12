CREATE TABLE public.sports_guide_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.sports_guide_posts(id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);
GRANT SELECT, DELETE ON public.sports_guide_reminders TO authenticated;
GRANT ALL ON public.sports_guide_reminders TO service_role;
ALTER TABLE public.sports_guide_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own reminders" ON public.sports_guide_reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own reminders" ON public.sports_guide_reminders FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX sports_guide_reminders_due_idx ON public.sports_guide_reminders (remind_at) WHERE sent_at IS NULL;