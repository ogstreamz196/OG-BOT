ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS boss_notified_at timestamptz;
UPDATE public.profiles SET boss_notified_at = now() WHERE boss_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_boss_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE tok text;
BEGIN
  SELECT token INTO tok FROM private.song_retry_scheduler WHERE singleton = true;
  IF tok IS NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://og-196.lovable.app/api/public/new-user-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-ogbot-retry-token', tok),
      body := jsonb_build_object('user_id', NEW.id),
      timeout_milliseconds := 15000);
  EXCEPTION WHEN OTHERS THEN NULL; -- never block signup
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_boss_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_boss_new_user ON public.profiles;
CREATE TRIGGER trg_notify_boss_new_user AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_boss_new_user();