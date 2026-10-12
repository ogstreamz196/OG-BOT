ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.referral_rate_pct(p_user uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role IN ('vip','admin','boss')
            AND (expires_at IS NULL OR expires_at > now()))
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND status IN ('active','trialing'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND vip_trial_ends_at > now())
  THEN 13 ELSE 6 END
$$;

-- Boss/admin: grant VIP (if needed) and set its expiry. NULL = lifetime.
CREATE OR REPLACE FUNCTION public.set_vip_expiry_admin(target_user_id uuid, new_expires_at timestamptz, admin_notes text DEFAULT NULL)
 RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE had boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'boss')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'target_not_found';
  END IF;
  IF new_expires_at IS NOT NULL AND new_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry_in_past';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user_id AND role = 'vip') INTO had;
  INSERT INTO public.user_roles(user_id, role, expires_at) VALUES (target_user_id, 'vip', new_expires_at)
    ON CONFLICT (user_id, role) DO UPDATE SET expires_at = EXCLUDED.expires_at;
  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (target_user_id, 0, CASE WHEN had THEN 'vip_expiry_set' ELSE 'vip_grant' END,
      'admin_vip_expiry ' || COALESCE(to_char(new_expires_at, 'YYYY-MM-DD'), 'lifetime')
      || COALESCE(' | ' || NULLIF(btrim(admin_notes), ''), ''));
  RETURN new_expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.set_vip_expiry_admin(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vip_expiry_admin(uuid, timestamptz, text) TO authenticated;

-- Remove expired VIP roles so every check (including direct role reads) stops seeing them.
CREATE OR REPLACE FUNCTION public.purge_expired_vip_roles()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  WITH d AS (
    DELETE FROM public.user_roles WHERE role = 'vip' AND expires_at IS NOT NULL AND expires_at <= now()
    RETURNING user_id
  )
  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    SELECT user_id, 0, 'vip_revoke', 'vip_expired' FROM d;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_vip_roles() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('purge-expired-vip-roles', '7 * * * *', 'SELECT public.purge_expired_vip_roles()');