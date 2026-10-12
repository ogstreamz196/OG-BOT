CREATE TABLE public.generation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  song_id uuid,
  title text,
  stage text NOT NULL DEFAULT 'lyrics',
  status text NOT NULL DEFAULT 'started',
  error_message text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.generation_attempts TO authenticated;
GRANT ALL ON public.generation_attempts TO service_role;
ALTER TABLE public.generation_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts select" ON public.generation_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own attempts insert" ON public.generation_attempts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own attempts update" ON public.generation_attempts FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX generation_attempts_created_idx ON public.generation_attempts (created_at DESC);
CREATE INDEX generation_attempts_user_idx ON public.generation_attempts (user_id, created_at DESC);
CREATE TRIGGER generation_attempts_updated BEFORE UPDATE ON public.generation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();