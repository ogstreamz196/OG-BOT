-- lovable-cron-fallback-reviewed: External music jobs need bounded delayed retries when provider callbacks or CDN delivery fail; five-minute polling is the lowest-cost reliable fallback without a delay queue.
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_auto_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_class text,
  ADD COLUMN IF NOT EXISTS retry_payload jsonb;

ALTER TABLE public.songs
  ADD CONSTRAINT songs_retry_count_nonnegative CHECK (retry_count >= 0),
  ADD CONSTRAINT songs_failure_class_valid CHECK (
    failure_class IS NULL OR failure_class IN ('recoverable_cdn', 'retryable', 'terminal')
  );

CREATE INDEX IF NOT EXISTS songs_retry_due_idx
  ON public.songs (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND failure_class <> 'terminal';

CREATE OR REPLACE FUNCTION public.claim_due_song_retries(p_limit integer DEFAULT 3)
RETURNS SETOF public.songs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT s.id
    FROM public.songs s
    WHERE s.next_retry_at <= now()
      AND s.retry_count < 5
      AND coalesce(s.failure_class, 'retryable') <> 'terminal'
      AND s.status IN ('failed', 'processing')
    ORDER BY s.next_retry_at, s.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 3), 3))
  )
  UPDATE public.songs s
  SET status = 'pending',
      retry_count = s.retry_count + 1,
      last_auto_retry_at = now(),
      next_retry_at = NULL,
      error_message = NULL
  FROM due
  WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_song_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_song_retries(integer) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('retry-failed-songs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'retry-failed-songs',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://og-196.lovable.app/api/public/suno-retry',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);