-- lovable-cron-fallback-reviewed: External music recovery needs delayed retries after provider callbacks; five-minute polling is the lowest-cost reliable fallback without a delay queue.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.song_retry_scheduler (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token text NOT NULL
);

REVOKE ALL ON TABLE private.song_retry_scheduler FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.song_retry_scheduler TO service_role;

INSERT INTO private.song_retry_scheduler(singleton, token)
VALUES (true, encode(gen_random_bytes(48), 'hex'))
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_song_retry_token(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.song_retry_scheduler
    WHERE singleton = true
      AND encode(extensions.digest(token, 'sha256'), 'hex') = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;

REVOKE ALL ON FUNCTION public.verify_song_retry_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_song_retry_token(text) TO service_role;

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
      url := 'https://project--07659a42-5b68-4c8b-83b5-ee9a625dbb92-dev.lovable.app/api/public/suno-retry',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ogbot-retry-token', (SELECT token FROM private.song_retry_scheduler WHERE singleton = true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);