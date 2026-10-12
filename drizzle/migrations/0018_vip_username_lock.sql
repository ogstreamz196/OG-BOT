ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vip_name_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION public.og_vip_id_for(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g')) LIKE 'OG%'
    THEN upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g'))
    ELSE 'OG' || upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g')) END
$$;

CREATE OR REPLACE FUNCTION public.assign_og_vip_id(p_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  username text;
  candidate text;
BEGIN
  SELECT regexp_replace(display_name, '[^A-Za-z0-9]', '', 'g') INTO username
  FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF username IS NULL OR length(username) < 3 OR length(username) > 30 OR username !~ '[A-Za-z]' THEN
    RAISE EXCEPTION 'A valid username is required before assigning an OG VIP ID';
  END IF;
  candidate := public.og_vip_id_for(username);
  UPDATE public.profiles SET og_vip_id = candidate
  WHERE id = p_user AND og_vip_id IS DISTINCT FROM candidate;
  RETURN candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_og_vip_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  cleaned text;
  is_client boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
  active_vip boolean;
BEGIN
  IF is_client THEN
    -- Members may confirm once but never clear or move the confirmation.
    IF OLD.vip_name_confirmed_at IS NOT NULL THEN
      NEW.vip_name_confirmed_at := OLD.vip_name_confirmed_at;
    ELSIF NEW.vip_name_confirmed_at IS NOT NULL THEN
      NEW.vip_name_confirmed_at := now();
    END IF;
    IF OLD.vip_name_confirmed_at IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = OLD.id AND role = 'vip'
        AND (expires_at IS NULL OR expires_at > now())) INTO active_vip;
      IF active_vip THEN
        RAISE EXCEPTION 'Your username is locked to your VIP ID while VIP is active';
      END IF;
    END IF;
  END IF;

  IF OLD.og_vip_id IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    cleaned := regexp_replace(coalesce(NEW.display_name, ''), '[^A-Za-z0-9]', '', 'g');
    IF length(cleaned) < 3 OR length(cleaned) > 30 OR cleaned !~ '[A-Za-z]' THEN
      RAISE EXCEPTION 'A valid username is required for an OG VIP ID';
    END IF;
    NEW.og_vip_id := public.og_vip_id_for(cleaned);
  ELSIF NEW.og_vip_id IS DISTINCT FROM OLD.og_vip_id AND is_client THEN
    NEW.og_vip_id := OLD.og_vip_id;
  END IF;
  RETURN NEW;
END;
$function$;