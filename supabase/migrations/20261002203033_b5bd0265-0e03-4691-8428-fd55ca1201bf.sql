ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS og_vip_id text UNIQUE;

CREATE OR REPLACE FUNCTION public.assign_og_vip_id(p_user uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing text;
  candidate text;
  tries int := 0;
BEGIN
  SELECT og_vip_id INTO existing FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  LOOP
    tries := tries + 1;
    candidate := 'OG' || lpad((floor(random() * 1000))::int::text, 3, '0');
    BEGIN
      UPDATE public.profiles SET og_vip_id = candidate WHERE id = p_user AND og_vip_id IS NULL;
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      IF tries > 2000 THEN RAISE EXCEPTION 'No OG VIP IDs left'; END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_og_vip_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_og_vip_id(uuid) TO service_role;