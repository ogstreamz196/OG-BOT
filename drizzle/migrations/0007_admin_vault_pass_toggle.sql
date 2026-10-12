CREATE OR REPLACE FUNCTION public.set_vault_pass_admin(target_user_id uuid, grant_access boolean, admin_notes text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_actor uuid := auth.uid();
  v_cred uuid;
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'boss') OR public.has_role(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF grant_access THEN
    IF NOT EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = target_user_id) THEN
      SELECT id INTO v_cred FROM public.vip_pass_credentials WHERE active ORDER BY random() LIMIT 1;
      IF v_cred IS NULL THEN
        RAISE EXCEPTION 'no active vault credentials available';
      END IF;
      INSERT INTO public.vip_pass_purchases (user_id, credential_id) VALUES (target_user_id, v_cred)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.vip_pass_purchases WHERE user_id = target_user_id;
  END IF;

  INSERT INTO public.boss_audit_log (actor_id, action, category, target_key, old_value, new_value, metadata)
  VALUES (
    v_actor,
    CASE WHEN grant_access THEN 'vault_pass_grant' ELSE 'vault_pass_revoke' END,
    'vault_pass',
    target_user_id::text,
    NULL,
    admin_notes,
    jsonb_build_object('granted', grant_access)
  );

  RETURN grant_access;
END;
$func$;

REVOKE ALL ON FUNCTION public.set_vault_pass_admin(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vault_pass_admin(uuid, boolean, text) TO authenticated;