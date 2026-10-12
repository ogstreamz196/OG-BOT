-- Song creation rules (owner decision, 2026-10-12):
--   * Creating a song is free, but the member must hold at least 5 coins.
--   * After 3 unpaid tracks (made but not unlocked) since the member last
--     unlocked a full track of their own, each new sample costs 2 coins.
--     Unlocking any of their own tracks resets the count.
--   * The member is warned when they make the 3rd unpaid track.
-- Retries of failed songs and edits of finished songs are not new samples
-- and keep their existing pricing (free / 2-coin edit fee).

-- When did each song get unlocked? Set by trigger whichever path unlocks it
-- (coins, card, Boss), so the count resets reliably.
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS unlocked_at timestamptz;

CREATE OR REPLACE FUNCTION public.songs_stamp_unlocked_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.unlocked IS TRUE AND (TG_OP = 'INSERT' OR OLD.unlocked IS DISTINCT FROM TRUE) THEN
    NEW.unlocked_at := COALESCE(NEW.unlocked_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS songs_stamp_unlocked_at ON public.songs;
CREATE TRIGGER songs_stamp_unlocked_at
  BEFORE INSERT OR UPDATE OF unlocked ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.songs_stamp_unlocked_at();

-- Best guess for tracks unlocked before this column existed.
UPDATE public.songs
   SET unlocked_at = COALESCE(completed_at, created_at)
 WHERE unlocked IS TRUE AND unlocked_at IS NULL;

CREATE INDEX IF NOT EXISTS songs_user_unpaid_idx
  ON public.songs (user_id, created_at)
  WHERE unlocked IS NOT TRUE AND is_variation IS NOT TRUE;


-- Shared count: the member's own tracks that were made (or are being made)
-- and not unlocked, since their most recent unlock. Bonus takes don't count.
CREATE OR REPLACE FUNCTION public.unpaid_track_count(p_user uuid, p_exclude uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
    FROM public.songs s
   WHERE s.user_id = p_user
     AND s.is_variation IS NOT TRUE
     AND s.unlocked IS NOT TRUE
     AND s.status IN ('pending', 'processing', 'completed')
     AND (p_exclude IS NULL OR s.id <> p_exclude)
     AND s.created_at > COALESCE(
       (SELECT MAX(u.unlocked_at) FROM public.songs u WHERE u.user_id = p_user AND u.unlocked IS TRUE),
       '-infinity'::timestamptz
     )
$$;

REVOKE ALL ON FUNCTION public.unpaid_track_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpaid_track_count(uuid, uuid) TO service_role;


-- Read-only, for the signed-in member's own create screen.
CREATE OR REPLACE FUNCTION public.my_generation_terms()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  bal integer;
  unpaid integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT coin_balance INTO bal FROM public.profiles WHERE id = me;
  unpaid := public.unpaid_track_count(me);
  RETURN jsonb_build_object(
    'balance', COALESCE(bal, 0),
    'min_balance', 5,
    'free_limit', 3,
    'unpaid_count', unpaid,
    'sample_cost', CASE WHEN unpaid >= 3 THEN 2 ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_generation_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_generation_terms() TO authenticated;


-- Called by suno-generate for a brand-new sample, after the song row is
-- claimed and before the music engine is called. The profile row lock makes
-- the check-and-charge atomic per member, so two quick submissions cannot
-- both slip through free.
CREATE OR REPLACE FUNCTION public.start_generation_charge(
  p_user uuid,
  p_song uuid,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bal integer;
  prior integer;
  new_balance integer;
BEGIN
  IF p_user IS NULL OR p_song IS NULL OR p_reference IS NULL THEN
    RAISE EXCEPTION 'user_song_reference_required';
  END IF;

  SELECT coin_balance INTO bal FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(bal, 0) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'min_balance', 'balance', COALESCE(bal, 0), 'min_balance', 5);
  END IF;

  prior := public.unpaid_track_count(p_user, p_song);

  IF prior >= 3 THEN
    new_balance := public.deduct_coins(p_user, 2, p_reference);
    RETURN jsonb_build_object(
      'ok', true, 'charged', 2, 'balance', new_balance,
      'unpaid_count', prior + 1, 'warning', false
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'charged', 0, 'balance', bal,
    'unpaid_count', prior + 1,
    -- This free sample is the 3rd unpaid track: the next one will cost 2.
    'warning', prior + 1 >= 3
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_generation_charge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_generation_charge(uuid, uuid, text) TO service_role;
