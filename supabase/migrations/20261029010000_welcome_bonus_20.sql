-- New members now get 20 welcome coins (was 25): enough for 4 tracks at
-- 5 coins each. The amount is the app_settings 'signup_credits' value, so the
-- Boss can change it from the pricing page; 20 if it's missing or invalid.
INSERT INTO public.app_settings (key, value)
VALUES ('signup_credits', '20'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = '20'::jsonb;

CREATE OR REPLACE FUNCTION public.grant_welcome_bonus(_user_id uuid, _eligible boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric(12,2);
  bonus integer;
BEGIN
  IF NOT COALESCE(_eligible, false) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'device_limit');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
    WHERE user_id = _user_id AND type = 'bonus' AND reference = 'welcome'
  ) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_granted');
  END IF;

  BEGIN
    SELECT (value #>> '{}')::integer INTO bonus
    FROM public.app_settings WHERE key = 'signup_credits';
  EXCEPTION WHEN others THEN
    bonus := NULL;
  END;
  IF bonus IS NULL OR bonus < 0 OR bonus > 1000 THEN
    bonus := 20;
  END IF;
  IF bonus = 0 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_bonus');
  END IF;

  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
  VALUES (_user_id, bonus, 'bonus', 'welcome');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles
  SET coin_balance = coin_balance + bonus
  WHERE id = _user_id
  RETURNING coin_balance INTO new_balance;

  RETURN jsonb_build_object('granted', true, 'balance', new_balance, 'amount', bonus);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_welcome_bonus(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_welcome_bonus(uuid, boolean) TO service_role;
