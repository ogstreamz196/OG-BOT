CREATE OR REPLACE FUNCTION public.assign_og_vip_id(p_user uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  username text;
  candidate text;
BEGIN
  SELECT display_name
  INTO username
  FROM public.profiles
  WHERE id = p_user
  FOR UPDATE;

  IF username IS NULL OR username !~ '^[A-Za-z0-9]{5,30}$' OR username !~ '[A-Za-z]' OR username !~ '[0-9]' THEN
    RAISE EXCEPTION 'A valid username is required before assigning an OG VIP ID';
  END IF;

  candidate := 'OG' || upper(username);

  UPDATE public.profiles
  SET og_vip_id = candidate
  WHERE id = p_user
    AND og_vip_id IS DISTINCT FROM candidate;

  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_og_vip_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_og_vip_id(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.protect_og_vip_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.og_vip_id IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF NEW.display_name IS NULL
       OR NEW.display_name !~ '^[A-Za-z0-9]{5,30}$'
       OR NEW.display_name !~ '[A-Za-z]'
       OR NEW.display_name !~ '[0-9]' THEN
      RAISE EXCEPTION 'A valid username is required for an OG VIP ID';
    END IF;
    NEW.og_vip_id := 'OG' || upper(NEW.display_name);
  ELSIF NEW.og_vip_id IS DISTINCT FROM OLD.og_vip_id
        AND coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    NEW.og_vip_id := OLD.og_vip_id;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET og_vip_id = 'OG' || upper(display_name)
WHERE og_vip_id IS NOT NULL
  AND display_name ~ '^[A-Za-z0-9]{5,30}$'
  AND display_name ~ '[A-Za-z]'
  AND display_name ~ '[0-9]'
  AND og_vip_id IS DISTINCT FROM 'OG' || upper(display_name);