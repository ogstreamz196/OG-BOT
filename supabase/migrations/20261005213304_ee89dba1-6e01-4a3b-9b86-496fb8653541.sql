-- lovable-cron-fallback-reviewed: Sports Guide kick-off reminders must fire at a time chosen by users; five-minute polling of due reminders is the simplest reliable trigger.
DO $$
BEGIN
  PERFORM cron.unschedule('sports-guide-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sports-guide-reminders',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://project--07659a42-5b68-4c8b-83b5-ee9a625dbb92.lovable.app/api/public/sports-guide-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ogbot-retry-token', (SELECT token FROM private.song_retry_scheduler WHERE singleton = true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);