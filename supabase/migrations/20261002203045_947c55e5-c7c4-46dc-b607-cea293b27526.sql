CREATE OR REPLACE FUNCTION public.protect_og_vip_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.og_vip_id IS DISTINCT FROM OLD.og_vip_id
     AND coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    NEW.og_vip_id := OLD.og_vip_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_og_vip_id ON public.profiles;
CREATE TRIGGER protect_og_vip_id BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_og_vip_id();