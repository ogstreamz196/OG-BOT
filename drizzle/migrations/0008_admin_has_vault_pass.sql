CREATE OR REPLACE FUNCTION public.admin_has_vault_pass(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
  SELECT (public.has_role(auth.uid(), 'boss') OR public.has_role(auth.uid(), 'admin'))
    AND EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = p_user);
$func$;

REVOKE ALL ON FUNCTION public.admin_has_vault_pass(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_has_vault_pass(uuid) TO authenticated;