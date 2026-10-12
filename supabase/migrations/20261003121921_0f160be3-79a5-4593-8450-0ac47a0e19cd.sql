CREATE TABLE public.ai_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_log_created_at_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX ai_usage_log_provider_created_idx ON public.ai_usage_log (provider, created_at DESC);

GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Boss and admin can read ai usage"
ON public.ai_usage_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'boss') OR public.has_role(auth.uid(), 'admin'));