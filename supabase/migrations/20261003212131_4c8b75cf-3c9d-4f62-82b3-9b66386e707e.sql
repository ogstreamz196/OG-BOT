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
  IF NOT public.has_role(caller, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH burns AS (
    SELECT r.referrer_id,
           SUM(GREATEST(0, -t.amount)) AS total_burned,
           SUM(FLOOR(GREATEST(0, -t.amount) * public.referral_rate_pct(r.referrer_id) / 100.0))::bigint AS expected_payout,
           COUNT(*) AS burn_count
      FROM public.coin_transactions t
      JOIN public.referrals r ON r.referee_id = t.user_id
     WHERE t.type = 'generation' AND t.amount < 0
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
           COALESCE(b.total_burned, 0)::bigint     AS total_burned,
           COALESCE(b.burn_count, 0)::bigint       AS burn_count,
           COALESCE(b.expected_payout, 0)::bigint  AS expected_payout,
           COALESCE(pd.actual_payout, 0)::bigint   AS actual_payout,
           COALESCE(pd.payout_count, 0)::bigint    AS payout_count,
           (COALESCE(pd.actual_payout, 0) - COALESCE(b.expected_payout, 0))::bigint AS delta
      FROM public.profiles p
      LEFT JOIN burns b  ON b.referrer_id  = p.id
      LEFT JOIN paid  pd ON pd.referrer_id = p.id
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