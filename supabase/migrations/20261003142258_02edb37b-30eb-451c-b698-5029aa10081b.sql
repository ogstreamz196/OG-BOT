ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vip_trial_started_at timestamptz DEFAULT now();
-- Existing rows: mark as not yet started so they get a fresh 15 days on next sign-in
UPDATE public.profiles SET vip_trial_started_at = NULL WHERE created_at < now() - interval '1 minute';

CREATE OR REPLACE FUNCTION public.protect_vip_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (NEW.vip_trial_ends_at IS DISTINCT FROM OLD.vip_trial_ends_at
      OR NEW.vip_trial_started_at IS DISTINCT FROM OLD.vip_trial_started_at)
     AND coalesce(auth.role(), '') <> 'service_role'
     AND coalesce(current_setting('app.vip_trial_bypass', true), '') <> 'on' THEN
    NEW.vip_trial_ends_at := OLD.vip_trial_ends_at;
    NEW.vip_trial_started_at := OLD.vip_trial_started_at;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.start_vip_trial_once()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); p record;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('started', false); END IF;
  SELECT vip_trial_started_at, vip_trial_ends_at INTO p FROM public.profiles WHERE id = uid;
  IF NOT FOUND OR p.vip_trial_started_at IS NOT NULL OR public.has_role(uid, 'vip') THEN
    RETURN jsonb_build_object('started', false, 'ends_at', p.vip_trial_ends_at);
  END IF;
  PERFORM set_config('app.vip_trial_bypass', 'on', true);
  UPDATE public.profiles SET vip_trial_started_at = now(), vip_trial_ends_at = now() + interval '15 days'
   WHERE id = uid AND vip_trial_started_at IS NULL;
  PERFORM set_config('app.vip_trial_bypass', 'off', true);
  RETURN jsonb_build_object('started', true, 'ends_at', now() + interval '15 days');
END $$;
REVOKE EXECUTE ON FUNCTION public.start_vip_trial_once() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_vip_trial_once() TO authenticated;