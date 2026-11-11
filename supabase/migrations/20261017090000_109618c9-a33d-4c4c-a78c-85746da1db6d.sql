-- Nasheed mode: pure-vocal tracks. A Nasheed costs double (10 coins or
-- £1.98), keeps only the first take, and has its vocals separated from the
-- mix so the finished track is the acapella alone.

ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS is_nasheed boolean NOT NULL DEFAULT false;
-- Vocal-separation job for a Nasheed, and the take it was run on.
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS stem_task_id text;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS stem_source_clip_id text;

-- The flag is set from the style when the track is created ("Nasheed" as one
-- of the comma-separated styles, or the app asking for it) and can never be
-- changed afterwards, so the price paid always matches what gets made.
CREATE OR REPLACE FUNCTION public.songs_lock_nasheed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_nasheed := COALESCE(NEW.is_nasheed, false)
      OR COALESCE(NEW.style, '') ~* '(^|,)\s*nasheed\s*(,|$)';
  ELSE
    NEW.is_nasheed := OLD.is_nasheed;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.songs_lock_nasheed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS songs_lock_nasheed ON public.songs;
CREATE TRIGGER songs_lock_nasheed BEFORE INSERT OR UPDATE ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.songs_lock_nasheed();

-- Upfront payment before cooking: the full-track price, doubled for a Nasheed.
CREATE OR REPLACE FUNCTION public.prepay_track(p_user uuid, p_song uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.songs%ROWTYPE; price integer; balance integer; prior boolean;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = p_user FOR UPDATE;
  SELECT * INTO s FROM public.songs WHERE id = p_song FOR UPDATE;
  IF NOT FOUND OR s.user_id <> p_user THEN RAISE EXCEPTION 'Track not found'; END IF;
  prior := COALESCE(s.unlocked, false)
    OR EXISTS (SELECT 1 FROM public.unlocked_songs WHERE user_id = p_user AND song_id = p_song);
  SELECT CASE WHEN value::text ~ '^[0-9]+$' THEN value::text::integer ELSE 5 END INTO price
    FROM public.app_settings WHERE key = 'coins_per_full_unlock';
  price := COALESCE(price, 5);
  IF s.is_nasheed THEN price := price * 2; END IF;
  IF NOT prior THEN
    balance := public.deduct_coins(p_user, price, 'unlock:' || p_song::text);
  ELSE
    SELECT coin_balance INTO balance FROM public.profiles WHERE id = p_user;
  END IF;
  UPDATE public.songs SET unlocked = true WHERE id = p_song;
  INSERT INTO public.unlocked_songs(user_id, song_id, source, cost_coins, reference)
    VALUES (p_user, p_song, 'coins', CASE WHEN prior THEN 0 ELSE price END, 'unlock:' || p_song::text)
    ON CONFLICT (user_id, song_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'already', prior, 'coin_balance', balance,
    'cost', CASE WHEN prior THEN 0 ELSE price END);
END $$;
REVOKE ALL ON FUNCTION public.prepay_track(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepay_track(uuid, uuid) TO service_role;
