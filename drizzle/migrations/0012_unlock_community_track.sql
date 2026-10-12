-- Community track download (a non-owner buying another user's revealed track)
-- as one atomic, service-only purchase.
--
-- The edge function used to check unlocked_songs, then charge, then credit the
-- creator's royalty by reading and rewriting their balance, then record the
-- unlock. A double tap passed the check twice and charged twice, and two
-- buyers at once could overwrite each other's royalty. Here the unique
-- (user_id, song_id) row is claimed first, so only one request charges; the
-- charge failing rolls the claim back; and the royalty is a relative update.

CREATE OR REPLACE FUNCTION public.unlock_community_track(
  _buyer uuid,
  _song_id uuid,
  _cost integer,
  _royalty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  claim_id uuid;
  new_balance integer;
  ref text := 'community_unlock:' || _song_id::text;
BEGIN
  IF _buyer IS NULL OR _song_id IS NULL THEN
    RAISE EXCEPTION 'buyer_and_song_required';
  END IF;
  IF _cost IS NULL OR _cost <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive';
  END IF;
  IF COALESCE(_royalty, 0) < 0 OR COALESCE(_royalty, 0) > _cost THEN
    RAISE EXCEPTION 'invalid_royalty';
  END IF;

  SELECT id, user_id, status, revealed INTO s FROM public.songs WHERE id = _song_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'song_not_found';
  END IF;
  IF s.user_id = _buyer THEN
    RAISE EXCEPTION 'owner_must_use_owner_purchase';
  END IF;
  IF s.status <> 'completed' THEN
    RAISE EXCEPTION 'song_not_ready';
  END IF;
  IF s.revealed IS FALSE THEN
    RAISE EXCEPTION 'not_revealed';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.unlocked_songs(user_id, song_id, source, cost_coins, reference)
  VALUES (_buyer, _song_id, 'community_purchase', _cost, ref)
  ON CONFLICT (user_id, song_id) DO NOTHING
  RETURNING id INTO claim_id;

  IF claim_id IS NULL THEN
    SELECT coin_balance INTO new_balance FROM public.profiles WHERE id = _buyer;
    RETURN jsonb_build_object('ok', true, 'already', true, 'coin_balance', new_balance);
  END IF;

  -- Raises insufficient_coins, which also rolls back the claim above.
  new_balance := public.deduct_coins(_buyer, _cost, ref);

  IF COALESCE(_royalty, 0) > 0 THEN
    UPDATE public.profiles SET coin_balance = coin_balance + _royalty WHERE id = s.user_id;
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (s.user_id, _royalty, 'royalty', ref || ':from:' || _buyer::text);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already', false,
    'coin_balance', new_balance,
    'owner_id', s.user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_community_track(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_community_track(uuid, uuid, integer, integer) TO service_role;
