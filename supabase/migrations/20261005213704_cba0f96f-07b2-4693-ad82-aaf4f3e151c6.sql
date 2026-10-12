CREATE OR REPLACE FUNCTION public.has_sports_guide_access(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sports_guide_access WHERE user_id = _user AND status <> 'revoked')
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user
                 AND role IN ('vip','admin','boss') AND (expires_at IS NULL OR expires_at > now()))
      OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = _user AND status IN ('active','trialing'))
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND vip_trial_ends_at > now())
$$;
REVOKE EXECUTE ON FUNCTION public.has_sports_guide_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_sports_guide_access(uuid) TO authenticated, service_role;