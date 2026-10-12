ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vip_trial_ends_at timestamptz;
ALTER TABLE public.profiles ALTER COLUMN vip_trial_ends_at SET DEFAULT (now() + interval '15 days');

CREATE OR REPLACE FUNCTION public.protect_vip_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vip_trial_ends_at IS DISTINCT FROM OLD.vip_trial_ends_at
     AND coalesce(auth.role(), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    NEW.vip_trial_ends_at := OLD.vip_trial_ends_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_vip_trial ON public.profiles;
CREATE TRIGGER protect_vip_trial BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_vip_trial();