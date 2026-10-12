CREATE OR REPLACE FUNCTION public.referral_rate_pct(p_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role IN ('vip','admin','boss'))
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND status IN ('active','trialing'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND vip_trial_ends_at > now())
  THEN 13 ELSE 6 END
$$;
REVOKE EXECUTE ON FUNCTION public.referral_rate_pct(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_rate_pct(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deduct_coins(p_user uuid, p_amount integer, p_reference text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  new_balance integer; ref_id uuid; cashback integer; existing_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN RAISE EXCEPTION 'forbidden_self_only'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF p_reference IS NOT NULL AND p_reference ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    PERFORM 1 FROM public.profiles WHERE id = p_user FOR UPDATE;
    SELECT COUNT(*) INTO existing_count FROM public.coin_transactions
      WHERE user_id = p_user AND reference = p_reference AND type = 'generation';
    IF existing_count > 0 THEN
      SELECT coin_balance INTO new_balance FROM public.profiles WHERE id = p_user;
      RETURN new_balance;
    END IF;
  END IF;
  UPDATE public.profiles SET coin_balance = coin_balance - p_amount
    WHERE id = p_user AND coin_balance >= p_amount RETURNING coin_balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'insufficient_coins'; END IF;
  BEGIN
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
      VALUES (p_user, -p_amount, 'generation', p_reference);
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.profiles SET coin_balance = coin_balance + p_amount WHERE id = p_user
      RETURNING coin_balance INTO new_balance;
    RETURN new_balance;
  END;
  SELECT referrer_id INTO ref_id FROM public.referrals WHERE referee_id = p_user;
  IF ref_id IS NOT NULL AND ref_id <> p_user THEN
    cashback := (p_amount * public.referral_rate_pct(ref_id)) / 100;
    IF cashback >= 1 THEN
      UPDATE public.profiles SET coin_balance = coin_balance + cashback WHERE id = ref_id;
      INSERT INTO public.coin_transactions(user_id, amount, type, reference)
        VALUES (ref_id, cashback, 'referral_cashback',
                'referee:' || p_user::text || '|burn:' || p_amount::text || '|ref:' || COALESCE(p_reference, ''));
    END IF;
  END IF;
  RETURN new_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_referral_cashback_on_burn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ref_id uuid; burn integer; cashback integer;
BEGIN
  IF NEW.amount >= 0 THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('vip_purchase','bot_token_purchase','sports_guide_access','vip_pass') THEN RETURN NEW; END IF;
  SELECT referrer_id INTO ref_id FROM public.referrals WHERE referee_id = NEW.user_id;
  IF ref_id IS NULL OR ref_id = NEW.user_id THEN RETURN NEW; END IF;
  burn := -NEW.amount;
  cashback := (burn * public.referral_rate_pct(ref_id)) / 100;
  IF cashback < 1 THEN RETURN NEW; END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles SET coin_balance = coin_balance + cashback WHERE id = ref_id;
  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (ref_id, cashback, 'referral_cashback',
            'referee:' || NEW.user_id::text || '|burn:' || burn::text || '|ref:' || COALESCE(NEW.reference, NEW.type));
  RETURN NEW;
END;
$function$;