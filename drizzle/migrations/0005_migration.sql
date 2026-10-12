ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS orchestration jsonb,
  ADD COLUMN IF NOT EXISTS orchestration_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS orchestration_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS songs_orchestration_due_idx
  ON public.songs (orchestration_due_at) WHERE orchestration IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_due_orchestrations(p_limit integer DEFAULT 2)
RETURNS SETOF public.songs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.songs s
    WHERE s.orchestration IS NOT NULL
      AND s.status = 'draft'
      AND s.orchestration_due_at <= now()
      AND s.orchestration_attempts < 3
      AND s.created_at > now() - interval '6 hours'
    ORDER BY s.orchestration_due_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 2), 3))
  )
  UPDATE public.songs s
  SET orchestration_attempts = s.orchestration_attempts + 1,
      orchestration_due_at = now() + interval '10 minutes'
  FROM due WHERE s.id = due.id
  RETURNING s.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_orchestrations(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_orchestrations(integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_key_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_name text NOT NULL,
  status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  alerted_at timestamptz
);
ALTER TABLE public.ai_key_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_key_failures FROM anon, authenticated;
GRANT ALL ON public.ai_key_failures TO service_role;
CREATE INDEX IF NOT EXISTS ai_key_failures_pending_idx ON public.ai_key_failures (created_at) WHERE alerted_at IS NULL;