-- Coin and refund integrity:
--   1. daily_coin_floor: one set-based UPDATE instead of read-then-write per
--      row, so a purchase credited while the cron runs is never overwritten
--      back down to the floor.
--   2. clawback_stripe_purchase: one atomic, per-purchase idempotent clawback
--      shared by the Stripe refund webhooks and the VIP instant refund.
--      refund.created, refund.updated and charge.refunded all arrive for one
--      refund, and the instant refund also reverses coins itself, so the old
--      per-refund-id check could deduct the same purchase two or three times.
--   3. restore_instant_refund_clawback: puts coins back if the Stripe refund
--      call fails after the instant-refund clawback took them.

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
    SELECT id, coin_balance FROM public.profiles WHERE coin_balance < 10 FOR UPDATE
  ),
  bumped AS (
    UPDATE public.profiles p
       SET coin_balance = 10
      FROM old
     WHERE p.id = old.id
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


-- _mode:
--   'webhook' : deduct the full purchase, balance may go negative (product
--               decision), ledger type 'stripe_refund'.
--   'instant' : VIP self-serve refund. Only allowed while every purchased coin
--               is still unspent; ledger type 'refund' keyed by the purchase.
CREATE OR REPLACE FUNCTION public.clawback_stripe_purchase(
  _user_id uuid,
  _purchase_reference text,
  _refund_id text,
  _mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  coins integer;
  bal integer;
  clawback_ref text := 'stripe:clawback:' || _purchase_reference;
BEGIN
  IF _user_id IS NULL OR _purchase_reference IS NULL OR length(trim(_purchase_reference)) = 0 THEN
    RAISE EXCEPTION 'user_and_reference_required';
  END IF;
  IF _mode NOT IN ('webhook', 'instant') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Serialise every clawback for this user so the checks below are race-free.
  SELECT coin_balance INTO bal FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT amount INTO coins
    FROM public.coin_transactions
   WHERE reference = _purchase_reference AND type = 'stripe_purchase'
   LIMIT 1;
  IF COALESCE(coins, 0) <= 0 THEN
    RETURN jsonb_build_object('clawed_back', false, 'reason', 'no_purchase', 'balance', bal);
  END IF;

  -- Already reversed by either path (or by a legacy per-refund webhook row).
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
     WHERE user_id = _user_id
       AND (
         (type = 'stripe_refund' AND reference = clawback_ref)
         OR (type = 'refund' AND reference = _purchase_reference)
         OR (_refund_id IS NOT NULL AND type = 'stripe_refund' AND reference = 'stripe:refund:' || _refund_id)
       )
  ) THEN
    RETURN jsonb_build_object('clawed_back', false, 'reason', 'already_applied', 'balance', bal);
  END IF;

  IF _mode = 'instant' AND COALESCE(bal, 0) < coins THEN
    RETURN jsonb_build_object('clawed_back', false, 'reason', 'coins_spent', 'balance', bal);
  END IF;

  UPDATE public.profiles
     SET coin_balance = coin_balance - coins
   WHERE id = _user_id
  RETURNING coin_balance INTO bal;

  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
  VALUES (
    _user_id,
    -coins,
    CASE WHEN _mode = 'instant' THEN 'refund' ELSE 'stripe_refund' END,
    CASE WHEN _mode = 'instant' THEN _purchase_reference ELSE clawback_ref END
  );

  RETURN jsonb_build_object('clawed_back', true, 'coins', coins, 'balance', bal);
END;
$$;

REVOKE ALL ON FUNCTION public.clawback_stripe_purchase(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clawback_stripe_purchase(uuid, text, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.restore_instant_refund_clawback(
  _user_id uuid,
  _purchase_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
  bal integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;

  DELETE FROM public.coin_transactions
   WHERE id = (
     SELECT id FROM public.coin_transactions
      WHERE user_id = _user_id AND type = 'refund' AND reference = _purchase_reference
      ORDER BY created_at DESC
      LIMIT 1
   )
  RETURNING -amount INTO removed;

  IF removed IS NULL THEN
    SELECT coin_balance INTO bal FROM public.profiles WHERE id = _user_id;
    RETURN jsonb_build_object('restored', false, 'balance', bal);
  END IF;

  UPDATE public.profiles SET coin_balance = coin_balance + removed
   WHERE id = _user_id
  RETURNING coin_balance INTO bal;

  RETURN jsonb_build_object('restored', true, 'coins', removed, 'balance', bal);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_instant_refund_clawback(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_instant_refund_clawback(uuid, text) TO service_role;
