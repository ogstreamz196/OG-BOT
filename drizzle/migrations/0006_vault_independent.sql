CREATE OR REPLACE FUNCTION public.grant_vault_pass(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cred uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = p_user) THEN RETURN true; END IF;
  SELECT id INTO v_cred FROM public.vip_pass_credentials WHERE active ORDER BY random() LIMIT 1;
  IF v_cred IS NULL THEN RETURN false; END IF;
  INSERT INTO public.vip_pass_purchases (user_id, credential_id) VALUES (p_user, v_cred)
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.grant_vault_pass(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_vault_pass(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.vault_webhook_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  target_url text,
  secret text,
  last_test_ok boolean,
  last_test_at timestamptz,
  last_error text,
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vault_webhook_settings TO service_role;
ALTER TABLE public.vault_webhook_settings ENABLE ROW LEVEL SECURITY;