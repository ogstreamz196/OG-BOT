-- Coin integrity fixes:
--   1. daily_coin_floor: set-based update so a purchase credited while the
--      cron loop runs can no longer be overwritten back down to the floor.
--   2. clawback_stripe_purchase: one atomic, per-purchase-idempotent refund
--      clawback shared by the Stripe webhook and the VIP instant refund, so a
--      refund is never deducted twice (refund.created + charge.refunded, or
--      instant refund + webhook).
--   3. unlock_song_with_coins: claim the unlock row, charge, and pay the
--      creator royalty in one transaction so double taps cannot double charge
--      and concurrent buyers cannot lose each other's royalty credits.

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


CREATE OR REPLACE FUNCTION public.clawback_stripe_purchase(
  _user_id uuid,
  _purchase_reference text,
  _refund_id text,
  _clamp_at_zero boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  coins integer;
  new_balance integer;
  clawback_ref text := 'stripe:clawback:' || _purchase_reference;
  deducted integer;
BEGIN
  IF _user_id IS NULL OR _purchase_reference IS NULL OR length(trim(_purchase_reference)) = 0 THEN
    RAISE EXCEPTION 'user_and_reference_required';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Serialise every clawback for this user so the existence check below is safe.
  SELECT coin_balance INTO new_balance FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT amount INTO coins
    FROM public.coin_transactions
   WHERE reference = _purchase_reference AND type = 'stripe_purchase'
   LIMIT 1;
  IF COALESCE(coins, 0) <= 0 THEN
    RETURN jsonb_build_object('clawed_back', false, 'reason', 'no_purchase', 'balance', new_balance);
  END IF;

  -- Already reversed by the canonical clawback, the VIP instant refund
  -- (type 'refund' keyed by the purchase reference) or a legacy webhook row.
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
     WHERE user_id = _user_id
       AND (
         (type = 'stripe_refund' AND reference = clawback_ref)
         OR (type = 'refund' AND reference = _purchase_reference)
         OR (_refund_id IS NOT NULL AND type = 'stripe_refund' AND reference = 'stripe:refund:' || _refund_id)
       )
  ) THEN
    RETURN jsonb_build_object('clawed_back', false, 'reason', 'already_applied', 'balance', new_balance);
  END IF;

  deducted := CASE WHEN _clamp_at_zero THEN LEAST(coins, GREATEST(new_balance, 0)) ELSE coins END;

  UPDATE public.profiles
     SET coin_balance = coin_balance - deducted
   WHERE id = _user_id
  RETURNING coin_balance INTO new_balance;

  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
  VALUES (
    _user_id,
    -deducted,
    CASE WHEN _clamp_at_zero THEN 'refund' ELSE 'stripe_refund' END,
    CASE WHEN _clamp_at_zero THEN _purchase_reference ELSE clawback_ref END
  );

  RETURN jsonb_build_object('clawed_back', true, 'coins', deducted, 'balance', new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.clawback_stripe_purchase(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clawback_stripe_purchase(uuid, text, text, boolean) TO service_role;


CREATE OR REPLACE FUNCTION public.unlock_song_with_coins(
  _buyer uuid,
  _song_id uuid,
  _cost integer,
  _royalty integer,
  _source text,
  _reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_id uuid;
  owner_id uuid;
  new_balance integer;
BEGIN
  IF _cost IS NULL OR _cost <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive';
  END IF;
  IF COALESCE(_royalty, 0) < 0 OR COALESCE(_royalty, 0) > _cost THEN
    RAISE EXCEPTION 'invalid_royalty';
  END IF;

  SELECT user_id INTO owner_id FROM public.songs WHERE id = _song_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'song_not_found';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- The unique (user_id, song_id) row is the idempotency claim: only one
  -- concurrent request inserts it, the rest return "already" without charging.
  INSERT INTO public.unlocked_songs(user_id, song_id, source, cost_coins, reference)
  VALUES (_buyer, _song_id, _source, _cost, _reference)
  ON CONFLICT (user_id, song_id) DO NOTHING
  RETURNING id INTO claim_id;

  IF claim_id IS NULL THEN
    IF owner_id = _buyer THEN
      UPDATE public.songs SET unlocked = true WHERE id = _song_id AND unlocked IS DISTINCT FROM true;
    END IF;
    SELECT coin_balance INTO new_balance FROM public.profiles WHERE id = _buyer;
    RETURN jsonb_build_object('unlocked', false, 'already', true, 'balance', new_balance);
  END IF;

  -- Raises insufficient_coins, which rolls back the claim above as well.
  new_balance := public.deduct_coins(_buyer, _cost, _reference);

  IF COALESCE(_royalty, 0) > 0 AND owner_id <> _buyer THEN
    UPDATE public.profiles SET coin_balance = coin_balance + _royalty WHERE id = owner_id;
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (owner_id, _royalty, 'royalty', _reference || ':from:' || _buyer::text);
  END IF;

  IF owner_id = _buyer THEN
    UPDATE public.songs SET unlocked = true WHERE id = _song_id;
  END IF;

  RETURN jsonb_build_object('unlocked', true, 'already', false, 'balance', new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_song_with_coins(uuid, uuid, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_song_with_coins(uuid, uuid, integer, integer, text, text) TO service_role;
