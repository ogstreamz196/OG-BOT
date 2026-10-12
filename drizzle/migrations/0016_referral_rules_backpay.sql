-- Referral rules (owner decision, 2026-10-12):
--   * Leaders earn 6%. Only leaders who are actually VIP earn 13%: a VIP role
--     (or admin/boss), or a paid, active VIP subscription. The 15-day
--     introductory offer (profiles.vip_trial_ends_at) and Stripe trials do
--     NOT count.
--   * Cashback is on coins friends spend only. Upgrading to VIP (vip_purchase,
--     vip_pass) earns the leader nothing; card payments earn nothing (the
--     payments webhook no longer pays card rewards).
--   * Leaders are paid back what they were owed under these rules for past
--     spends, once, recorded as 'referral_backpay'.

-- 1. Rate --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_rate_pct(p_user uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role IN ('vip','admin','boss')
            AND (expires_at IS NULL OR expires_at > now()))
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND status = 'active')
  THEN 13 ELSE 6 END
$$;

-- 2. Which coin spends pay cashback -------------------------------------------
-- deduct_coins ('generation') covers chat, unlocks, edits, reveals, lyric
-- videos and community downloads. Of the purchases that bypass it, only bot
-- tokens and Sports Guide remain; VIP purchases are excluded.
CREATE OR REPLACE FUNCTION public.pay_referral_cashback_on_burn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.amount >= 0 THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('bot_token_purchase','sports_guide_access') THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.pay_referral_cashback(NEW.user_id, -NEW.amount, COALESCE(NEW.reference, NEW.type));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral cashback failed for % (%): %', NEW.user_id, NEW.type, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pay_referral_cashback_on_burn() FROM PUBLIC, anon, authenticated;

-- 3. What each leader is owed ----------------------------------------------------
-- Per current friend: coins spent on cashback-earning types since the friend
-- connected, minus coins refunded for those charges, times the leader's rate.
-- Returned in hundredths of a coin so nothing is lost to rounding.
CREATE OR REPLACE FUNCTION public.referral_owed_hundredths()
RETURNS TABLE (referrer_id uuid, net_burned bigint, rate_pct integer, owed_hundredths bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH charges AS (
    SELECT r.referrer_id, t.user_id, t.reference, -t.amount AS burned
      FROM public.coin_transactions t
      JOIN public.referrals r ON r.referee_id = t.user_id
     WHERE t.amount < 0
       AND t.type IN ('generation', 'bot_token_purchase', 'sports_guide_access')
       AND t.created_at >= r.created_at
       AND r.referrer_id <> t.user_id
  ),
  -- Each refund counted once, if it reverses one of the friend's charges.
  refunds AS (
    SELECT r.referrer_id, SUM(f.amount) AS refunded
      FROM public.coin_transactions f
      JOIN public.referrals r ON r.referee_id = f.user_id
     WHERE f.type = 'refund'
       AND f.amount > 0
       AND f.created_at >= r.created_at
       AND f.reference IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.coin_transactions c
          WHERE c.user_id = f.user_id
            AND c.amount < 0
            AND c.type IN ('generation', 'bot_token_purchase', 'sports_guide_access')
            AND c.reference IS NOT NULL
            AND c.created_at >= r.created_at
            AND (f.reference = c.reference OR f.reference = 'cancel:' || c.reference)
       )
     GROUP BY r.referrer_id
  ),
  per_leader AS (
    SELECT c.referrer_id, SUM(c.burned) AS burned
      FROM charges c
     GROUP BY c.referrer_id
  )
  SELECT p.referrer_id,
         GREATEST(0, p.burned - COALESCE(f.refunded, 0))::bigint AS net_burned,
         public.referral_rate_pct(p.referrer_id) AS rate_pct,
         (GREATEST(0, p.burned - COALESCE(f.refunded, 0)) * public.referral_rate_pct(p.referrer_id))::bigint
           AS owed_hundredths
    FROM per_leader p
    LEFT JOIN refunds f ON f.referrer_id = p.referrer_id
$$;

REVOKE ALL ON FUNCTION public.referral_owed_hundredths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_owed_hundredths() TO service_role;

-- 4. One-off back pay ---------------------------------------------------------------
-- Pays each leader (owed - already paid as cashback/back pay - carried
-- fraction), never negative, and leaves the leftover fraction in the
-- accrual so later spends continue from the exact right point. Idempotent:
-- one 'referral_backpay' row per leader per batch.
CREATE UNIQUE INDEX IF NOT EXISTS coin_tx_referral_backpay_reference_unique
  ON public.coin_transactions (reference)
  WHERE type = 'referral_backpay' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.backpay_referral_cashback(p_batch text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  paid_coins bigint;
  pending integer;
  short_h bigint;
  coins integer;
  leftover integer;
  inserted uuid;
  leaders integer := 0;
  total integer := 0;
BEGIN
  IF p_batch IS NULL OR length(trim(p_batch)) = 0 THEN
    RAISE EXCEPTION 'batch_required';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  FOR o IN SELECT * FROM public.referral_owed_hundredths() WHERE owed_hundredths > 0 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = o.referrer_id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.referral_cashback_accrual(referrer_id) VALUES (o.referrer_id)
    ON CONFLICT (referrer_id) DO NOTHING;
    SELECT pending_hundredths INTO pending
      FROM public.referral_cashback_accrual WHERE referrer_id = o.referrer_id FOR UPDATE;

    SELECT COALESCE(SUM(amount), 0) INTO paid_coins
      FROM public.coin_transactions
     WHERE user_id = o.referrer_id AND type IN ('referral_cashback', 'referral_backpay');

    short_h := o.owed_hundredths - (paid_coins * 100 + pending);
    IF short_h <= 0 THEN
      CONTINUE;
    END IF;

    coins := (short_h / 100)::integer;
    leftover := pending + (short_h % 100)::integer;
    IF leftover >= 100 THEN
      coins := coins + 1;
      leftover := leftover - 100;
    END IF;

    IF coins >= 1 THEN
      INSERT INTO public.coin_transactions(user_id, amount, type, reference)
      VALUES (o.referrer_id, coins, 'referral_backpay', 'backpay:' || p_batch || ':' || o.referrer_id::text)
      ON CONFLICT (reference) WHERE type = 'referral_backpay' AND reference IS NOT NULL DO NOTHING
      RETURNING id INTO inserted;
      IF inserted IS NULL THEN
        CONTINUE;  -- this batch already paid this leader
      END IF;
      UPDATE public.profiles SET coin_balance = coin_balance + coins WHERE id = o.referrer_id;
      INSERT INTO public.user_notifications(user_id, kind, title, body, metadata)
      VALUES (
        o.referrer_id,
        'referral_backpay',
        'Referral cashback paid',
        'We recalculated your referral cashback and paid you ' || coins ||
          ' OG coin' || CASE WHEN coins = 1 THEN '' ELSE 's' END ||
          ' you were owed at ' || o.rate_pct || '%.',
        jsonb_build_object('coins', coins, 'rate_pct', o.rate_pct, 'batch', p_batch)
      );
      leaders := leaders + 1;
      total := total + coins;
    END IF;

    UPDATE public.referral_cashback_accrual
       SET pending_hundredths = leftover, updated_at = now()
     WHERE referrer_id = o.referrer_id;
  END LOOP;

  RETURN jsonb_build_object('leaders_paid', leaders, 'coins_paid', total);
END;
$$;

REVOKE ALL ON FUNCTION public.backpay_referral_cashback(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backpay_referral_cashback(text) TO service_role;

SELECT public.backpay_referral_cashback('2026-10-12');

-- 5. Boss referral audit uses the same "owed" maths ------------------------------------
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

  WITH owed AS (
    SELECT * FROM public.referral_owed_hundredths()
  ),
  burns AS (
    SELECT r.referrer_id, COUNT(*) AS burn_count
      FROM public.coin_transactions t
      JOIN public.referrals r ON r.referee_id = t.user_id
     WHERE t.amount < 0
       AND t.type IN ('generation', 'bot_token_purchase', 'sports_guide_access')
       AND t.created_at >= r.created_at
     GROUP BY r.referrer_id
  ),
  paid AS (
    SELECT user_id AS referrer_id,
           SUM(amount)::bigint AS actual_payout,
           COUNT(*) AS payout_count
      FROM public.coin_transactions
     WHERE type IN ('referral_cashback', 'referral_backpay')
     GROUP BY user_id
  ),
  merged AS (
    SELECT p.id AS referrer_id,
           COALESCE(p.display_name, split_part(p.email,'@',1)) AS referrer_name,
           p.email AS referrer_email,
           p.referral_code,
           public.referral_rate_pct(p.id) AS rate_pct,
           COALESCE(o.net_burned, 0)::bigint                AS total_burned,
           COALESCE(b.burn_count, 0)::bigint                AS burn_count,
           (COALESCE(o.owed_hundredths, 0) / 100)::bigint    AS expected_payout,
           COALESCE(pd.actual_payout, 0)::bigint             AS actual_payout,
           COALESCE(pd.payout_count, 0)::bigint              AS payout_count,
           COALESCE(a.pending_hundredths, 0)                 AS pending_hundredths,
           (COALESCE(pd.actual_payout, 0) - COALESCE(o.owed_hundredths, 0) / 100)::bigint AS delta
      FROM public.profiles p
      LEFT JOIN owed o   ON o.referrer_id  = p.id
      LEFT JOIN burns b  ON b.referrer_id  = p.id
      LEFT JOIN paid  pd ON pd.referrer_id = p.id
      LEFT JOIN public.referral_cashback_accrual a ON a.referrer_id = p.id
     WHERE COALESCE(o.net_burned,0) > 0 OR COALESCE(pd.actual_payout,0) > 0
     ORDER BY ABS(COALESCE(pd.actual_payout,0) - COALESCE(o.owed_hundredths,0) / 100) DESC,
              COALESCE(o.net_burned,0) DESC
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

-- 6. Members' own referral summary counts back pay as earnings ----------------------
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
      AND type IN ('referral_cashback', 'referral_payment', 'referral_payment_reversal', 'referral_backpay');

  WITH rows AS (
    SELECT t.id, t.amount, t.type, t.reference, t.created_at,
           substring(t.reference FROM 'referee:([0-9a-fA-F-]{36})')::uuid AS referee_id
    FROM public.coin_transactions t
    WHERE t.user_id = caller
      AND t.type IN ('referral_cashback', 'referral_payment', 'referral_payment_reversal', 'referral_backpay')
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
