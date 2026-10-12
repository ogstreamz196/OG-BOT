CREATE OR REPLACE FUNCTION public.sync_referral_code_to_vip_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.og_vip_id IS NOT NULL AND NEW.referral_code IS DISTINCT FROM NEW.og_vip_id
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = NEW.og_vip_id AND id <> NEW.id) THEN
    NEW.referral_code := NEW.og_vip_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_referral_code_to_vip_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_sync_referral_code_to_vip_id ON public.profiles;
CREATE TRIGGER zz_sync_referral_code_to_vip_id
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_referral_code_to_vip_id();

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
   WHERE referral_code = clean OR referral_code = 'OG-' || clean
   LIMIT 1;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'referrer_id', rec.id, 'referrer_name', rec.name, 'referrer_code', rec.referral_code);
END $$;
REVOKE EXECUTE ON FUNCTION public.lookup_referrer_by_code(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.lookup_referrer_by_code(text) TO authenticated;

UPDATE public.profiles SET referral_code = og_vip_id
 WHERE og_vip_id IS NOT NULL AND referral_code IS DISTINCT FROM og_vip_id;