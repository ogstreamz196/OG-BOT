CREATE OR REPLACE FUNCTION public.lookup_referrer_by_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller uuid := auth.uid();
  rec RECORD;
  clean text := upper(btrim(p_code));
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF clean IS NULL OR length(clean) < 3 THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT id, COALESCE(display_name, split_part(email,'@',1), 'Unknown') AS name, referral_code
    INTO rec FROM public.profiles
   WHERE referral_code = clean OR referral_code = 'OG-' || clean OR referral_code = 'OG' || clean
      OR og_vip_id = clean OR og_vip_id = 'OG' || clean
   ORDER BY (referral_code = clean OR og_vip_id = clean) DESC
   LIMIT 1;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'referrer_id', rec.id, 'referrer_name', rec.name, 'referrer_code', rec.referral_code);
END $$;
REVOKE EXECUTE ON FUNCTION public.lookup_referrer_by_code(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.lookup_referrer_by_code(text) TO authenticated;