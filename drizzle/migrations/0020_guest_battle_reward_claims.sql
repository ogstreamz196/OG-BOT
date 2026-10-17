-- Guest Battle Zone rewards: move guest lines into a member account and
-- credit their existing scored winnings once per account and guest id.
-- User IDs remain plain UUIDs; application tables do not reference auth.users.
CREATE TABLE IF NOT EXISTS public.guest_battle_claims (
  user_id uuid PRIMARY KEY,
  guest_id text NOT NULL UNIQUE,
  credited_tenths integer NOT NULL DEFAULT 0,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guest_battle_claims TO service_role;
REVOKE ALL ON public.guest_battle_claims FROM PUBLIC, anon, authenticated;
ALTER TABLE public.guest_battle_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_guest_battle(_user_id uuid, _guest_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved integer := 0;
  earned integer := 0;
BEGIN
  IF _user_id IS NULL OR _guest_id IS NULL OR _guest_id !~ '^[A-Za-z0-9-]{16,64}$' THEN
    RAISE EXCEPTION 'user_and_guest_required';
  END IF;

  WITH m AS (
    UPDATE public.community_messages
       SET user_id = _user_id
     WHERE guest_id = _guest_id
       AND user_id IS NULL
       AND role = 'user'
    RETURNING COALESCE(score_tenths, 0) AS s
  )
  SELECT COUNT(*)::integer, COALESCE(SUM(s), 0)::integer INTO moved, earned FROM m;

  -- Preserve scored winnings; scoring already applies the daily reward limit.
  earned := LEAST(GREATEST(earned, 0), 50);
  IF moved = 0 OR earned = 0 THEN
    RETURN jsonb_build_object('claimed', moved, 'credited_tenths', 0);
  END IF;

  INSERT INTO public.guest_battle_claims (user_id, guest_id, credited_tenths)
  VALUES (_user_id, _guest_id, earned)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', moved, 'credited_tenths', 0);
  END IF;

  INSERT INTO public.battle_tallies (user_id, pending_tenths, rounds, total_awarded_coins, updated_at)
  VALUES (_user_id, 0, 0, 0, to_timestamp(0))
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.battle_tallies
     SET pending_tenths = pending_tenths + earned,
         rounds = rounds + moved
   WHERE user_id = _user_id;

  RETURN jsonb_build_object('claimed', moved, 'credited_tenths', earned);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_guest_battle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_battle(uuid, text) TO service_role;