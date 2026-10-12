-- Referral cashback that actually pays "6% of every coin (13% as an OG VIP)".
--
-- Before: each spend's cashback was rounded down on its own:
--   (amount * rate) / 100   in integer maths.
-- Almost every spend in the app is small (1-coin chat message, 2-coin edit
-- or reveal, 3-coin community download, 5-coin unlock), so 1*6/100, 5*6/100
-- and even 5*13/100 all came out as 0 and leaders were paid nothing.
--
-- Now: each leader has a running remainder in hundredths of a coin. Every
-- spend adds amount * rate (exact, using the leader's rate at that moment);
-- whole coins are paid out as soon as they are earned and the remainder
-- (always below one coin) carries over to the next spend. 100 one-coin
-- messages from a friend pay a 6% leader exactly 6 coins, a VIP leader 13.

CREATE TABLE IF NOT EXISTS public.referral_cashback_accrual (
  referrer_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pending_hundredths integer NOT NULL DEFAULT 0
    CHECK (pending_hundredths >= 0 AND pending_hundredths < 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only reached through the SECURITY DEFINER functions below.
ALTER TABLE public.referral_cashback_accrual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_cashback_accrual FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_cashback_accrual TO service_role;


CREATE OR REPLACE FUNCTION public.pay_referral_cashback(
  p_referee uuid,
  p_burn integer,
  p_reference text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_id uuid;
  rate integer;
  total integer;
  payout integer;
BEGIN
  IF p_referee IS NULL OR p_burn IS NULL OR p_burn <= 0 THEN
    RETURN 0;
  END IF;

  SELECT referrer_id INTO ref_id FROM public.referrals WHERE referee_id = p_referee;
  IF ref_id IS NULL OR ref_id = p_referee THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = ref_id) THEN
    RETURN 0;
  END IF;

  rate := public.referral_rate_pct(ref_id);

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.referral_cashback_accrual(referrer_id) VALUES (ref_id)
  ON CONFLICT (referrer_id) DO NOTHING;

  -- Row lock serialises concurrent spends by any of this leader's friends.
  SELECT pending_hundredths + p_burn * rate INTO total
    FROM public.referral_cashback_accrual
   WHERE referrer_id = ref_id
     FOR UPDATE;

  payout := total / 100;

  UPDATE public.referral_cashback_accrual
     SET pending_hundredths = total % 100,
         updated_at = now()
   WHERE referrer_id = ref_id;

  IF payout >= 1 THEN
    UPDATE public.profiles SET coin_balance = coin_balance + payout WHERE id = ref_id;
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
      VALUES (ref_id, payout, 'referral_cashback',
              'referee:' || p_referee::text || '|burn:' || p_burn::text || '|ref:' || COALESCE(p_reference, ''));
  END IF;

  RETURN payout;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_referral_cashback(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_referral_cashback(uuid, integer, text) TO service_role;


-- Identical to the 2026-10-03 version except the cashback block, which now
-- goes through pay_referral_cashback.
CREATE OR REPLACE FUNCTION public.deduct_coins(p_user uuid, p_amount integer, p_reference text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  new_balance integer; existing_count integer;
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
  -- A cashback problem must never block the member's own spend.
  BEGIN
    PERFORM public.pay_referral_cashback(p_user, p_amount, p_reference);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral cashback failed for % (%): %', p_user, p_reference, SQLERRM;
  END;
  RETURN new_balance;
END;
$function$;


-- Coin purchases that bypass deduct_coins (VIP, VIP pass, bot tokens, Sports
-- Guide) pay cashback from this trigger. Same purchase types as before.
CREATE OR REPLACE FUNCTION public.pay_referral_cashback_on_burn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.amount >= 0 THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('vip_purchase','bot_token_purchase','sports_guide_access','vip_pass') THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.pay_referral_cashback(NEW.user_id, -NEW.amount, COALESCE(NEW.reference, NEW.type));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral cashback failed for % (%): %', NEW.user_id, NEW.type, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pay_referral_cashback_on_burn() FROM PUBLIC, anon, authenticated;

-- The trigger itself was created outside these migrations. Attach it only if
-- no trigger on coin_transactions already calls this function, so an
-- existing one is never doubled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.coin_transactions'::regclass
       AND p.proname = 'pay_referral_cashback_on_burn'
       AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER coin_tx_referral_cashback_on_burn
      AFTER INSERT ON public.coin_transactions
      FOR EACH ROW EXECUTE FUNCTION public.pay_referral_cashback_on_burn();
  END IF;
END $$;


-- Boss referral audit: expected cashback now covers every burn that pays
-- cashback (not just 'generation'), is rounded once per leader instead of
-- per spend, and shows the carried-over fraction. Expected uses each
-- leader's current rate, so a leader whose VIP status changed will show a
-- small difference that is not an error.
CREATE OR REPLACE FUNCTION public.admin_referral_reconciliation(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  rows_json jsonb;
  totals jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.has_role(caller, 'admin') OR public.has_role(caller, 'boss')) THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH burns AS (
    SELECT r.referrer_id,
           SUM(GREATEST(0, -t.amount)) AS total_burned,
           FLOOR(SUM(GREATEST(0, -t.amount)) * public.referral_rate_pct(r.referrer_id) / 100.0)::bigint AS expected_payout,
           COUNT(*) AS burn_count
      FROM public.coin_transactions t
      JOIN public.referrals r ON r.referee_id = t.user_id
     WHERE t.amount < 0
       AND t.type IN ('generation', 'vip_purchase', 'bot_token_purchase', 'sports_guide_access', 'vip_pass')
       AND r.referrer_id <> t.user_id
     GROUP BY r.referrer_id
  ),
  paid AS (
    SELECT user_id AS referrer_id,
           SUM(amount)::bigint AS actual_payout,
           COUNT(*) AS payout_count
      FROM public.coin_transactions
     WHERE type = 'referral_cashback'
     GROUP BY user_id
  ),
  merged AS (
    SELECT p.id AS referrer_id,
           COALESCE(p.display_name, split_part(p.email,'@',1)) AS referrer_name,
           p.email AS referrer_email,
           p.referral_code,
           public.referral_rate_pct(p.id) AS rate_pct,
           COALESCE(b.total_burned, 0)::bigint     AS total_burned,
           COALESCE(b.burn_count, 0)::bigint       AS burn_count,
           COALESCE(b.expected_payout, 0)::bigint  AS expected_payout,
           COALESCE(pd.actual_payout, 0)::bigint   AS actual_payout,
           COALESCE(pd.payout_count, 0)::bigint    AS payout_count,
           COALESCE(a.pending_hundredths, 0)       AS pending_hundredths,
           (COALESCE(pd.actual_payout, 0) - COALESCE(b.expected_payout, 0))::bigint AS delta
      FROM public.profiles p
      LEFT JOIN burns b  ON b.referrer_id  = p.id
      LEFT JOIN paid  pd ON pd.referrer_id = p.id
      LEFT JOIN public.referral_cashback_accrual a ON a.referrer_id = p.id
     WHERE COALESCE(b.total_burned,0) > 0 OR COALESCE(pd.actual_payout,0) > 0
     ORDER BY ABS(COALESCE(pd.actual_payout,0) - COALESCE(b.expected_payout,0)) DESC,
              COALESCE(b.total_burned,0) DESC
     LIMIT GREATEST(1, LEAST(p_limit, 1000))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(merged)), '[]'::jsonb) INTO rows_json FROM merged;

  SELECT jsonb_build_object(
    'total_burned',     COALESCE(SUM((r->>'total_burned')::bigint), 0),
    'expected_payout',  COALESCE(SUM((r->>'expected_payout')::bigint), 0),
    'actual_payout',    COALESCE(SUM((r->>'actual_payout')::bigint), 0),
    'delta',            COALESCE(SUM((r->>'delta')::bigint), 0),
    'mismatches',       COALESCE(SUM(CASE WHEN (r->>'delta')::bigint <> 0 THEN 1 ELSE 0 END), 0)
  ) INTO totals
  FROM jsonb_array_elements(rows_json) r;

  RETURN jsonb_build_object('rows', rows_json, 'totals', totals);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_reconciliation(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_referral_reconciliation(integer) TO authenticated;
