-- Refund follow-ups (owner decision):
--   1. daily_coin_floor no longer tops up negative balances. A refund
--      clawback can leave a balance negative on purpose; topping it back to
--      10 every midnight let people keep coins they spent and then refunded.
--      Only balances from 0 to 9 are lifted to 10.
--   2. reverse_referral_rewards_for_refund takes back the referral reward a
--      refunded payment earned (coin pack, VIP, track or store). Each reward
--      is reversed at most once. The referrer did nothing wrong, so their
--      balance is never pushed below zero.

CREATE OR REPLACE FUNCTION public.daily_coin_floor()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  WITH old AS (
    SELECT id, coin_balance FROM public.profiles
     WHERE coin_balance >= 0 AND coin_balance < 10
       FOR UPDATE
  ),
  bumped AS (
    UPDATE public.profiles p
       SET coin_balance = 10
      FROM old
     WHERE p.id = old.id
       AND p.coin_balance >= 0
       AND p.coin_balance < 10
    RETURNING p.id, old.coin_balance AS prev
  ),
  logged AS (
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    SELECT id, 10 - prev, 'daily_floor', 'daily_floor:from_' || prev::text || '_to_10'
      FROM bumped
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM logged;

  RETURN affected;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.daily_coin_floor() FROM PUBLIC, anon, authenticated;


-- New ledger type, so no existing rows can conflict with this index.
CREATE UNIQUE INDEX IF NOT EXISTS coin_tx_referral_reversal_reference_unique
  ON public.coin_transactions (reference)
  WHERE type = 'referral_payment_reversal' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reverse_referral_rewards_for_refund(
  _referee_id uuid,
  _env text,
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  bal integer;
  take integer;
  inserted uuid;
  reversed integer := 0;
  coins_taken integer := 0;
  base text;
BEGIN
  IF _referee_id IS NULL OR _env IS NULL OR _session_id IS NULL OR length(trim(_session_id)) = 0 THEN
    RAISE EXCEPTION 'referee_env_session_required';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  base := 'payment:referee:' || _referee_id::text || '|ref:stripe:' || _env || ':';

  -- Matches the references written by credit_payment_referral for each
  -- purchase kind the payments webhook rewards.
  FOR r IN
    SELECT user_id, amount, reference
      FROM public.coin_transactions
     WHERE type = 'referral_payment'
       AND amount > 0
       AND reference IN (
         base || _session_id,
         base || 'vip:' || _session_id,
         base || 'track:' || _session_id,
         base || 'store:' || _session_id
       )
  LOOP
    SELECT coin_balance INTO bal FROM public.profiles WHERE id = r.user_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    take := LEAST(r.amount, GREATEST(COALESCE(bal, 0), 0));

    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (r.user_id, -take, 'referral_payment_reversal', 'reversal:' || r.reference)
    ON CONFLICT (reference) WHERE type = 'referral_payment_reversal' AND reference IS NOT NULL
    DO NOTHING
    RETURNING id INTO inserted;

    IF inserted IS NOT NULL THEN
      IF take > 0 THEN
        UPDATE public.profiles SET coin_balance = coin_balance - take WHERE id = r.user_id;
      END IF;
      reversed := reversed + 1;
      coins_taken := coins_taken + take;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reversed', reversed, 'coins', coins_taken);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_referral_rewards_for_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_referral_rewards_for_refund(uuid, text, text) TO service_role;


-- Referral summary:
--   * referee_id is read with a regex. The old split_part read "referee" out
--     of payment rewards ("payment:referee:<uuid>|ref:...") and the ::uuid cast
--     raised, so any referrer with a payment reward got an error instead of
--     their summary.
--   * Reversed rewards count against total_earned and show in the recent list.
CREATE OR REPLACE FUNCTION public.get_referral_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  total_refs integer;
  total_earned integer;
  recent jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT COUNT(*) INTO total_refs FROM public.referrals WHERE referrer_id = caller;
  SELECT COALESCE(SUM(amount), 0) INTO total_earned
    FROM public.coin_transactions
    WHERE user_id = caller
      AND type IN ('referral_cashback', 'referral_payment', 'referral_payment_reversal');

  WITH rows AS (
    SELECT t.id, t.amount, t.type, t.reference, t.created_at,
           substring(t.reference FROM 'referee:([0-9a-fA-F-]{36})')::uuid AS referee_id
    FROM public.coin_transactions t
    WHERE t.user_id = caller
      AND t.type IN ('referral_cashback', 'referral_payment', 'referral_payment_reversal')
      -- A reversal that took nothing (leader already at 0) is not worth a row.
      AND NOT (t.type = 'referral_payment_reversal' AND t.amount = 0)
    ORDER BY t.created_at DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'amount', r.amount,
    'type', r.type,
    'reference', r.reference,
    'created_at', r.created_at,
    'referee_id', r.referee_id,
    'referee_name', COALESCE(p.display_name, split_part(p.email, '@', 1), 'Referred user')
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO recent
  FROM rows r
  LEFT JOIN public.profiles p ON p.id = r.referee_id;

  RETURN jsonb_build_object(
    'total_referred', total_refs,
    'total_earned', total_earned,
    'recent', recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_referral_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_referral_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_referral_summary() TO authenticated;
