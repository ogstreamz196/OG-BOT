CREATE OR REPLACE FUNCTION public.prepay_track(p_user uuid, p_song uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.songs%ROWTYPE; price integer; balance integer; prior boolean;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user FOR UPDATE;
 SELECT * INTO s FROM public.songs WHERE id=p_song FOR UPDATE;
 IF NOT FOUND OR s.user_id<>p_user THEN RAISE EXCEPTION 'Track not found'; END IF;
 prior := COALESCE(s.unlocked,false) OR EXISTS(SELECT 1 FROM public.unlocked_songs WHERE user_id=p_user AND song_id=p_song);
 SELECT CASE WHEN value::text ~ '^[0-9]+$' THEN value::text::integer ELSE 5 END INTO price FROM public.app_settings WHERE key='coins_per_full_unlock';
 price:=COALESCE(price,5);
 IF NOT prior THEN balance:=public.deduct_coins(p_user,price,'unlock:' || p_song::text); ELSE SELECT coin_balance INTO balance FROM public.profiles WHERE id=p_user; END IF;
 UPDATE public.songs SET unlocked=true WHERE id=p_song;
 INSERT INTO public.unlocked_songs(user_id,song_id,source,cost_coins,reference) VALUES(p_user,p_song,'coins',CASE WHEN prior THEN 0 ELSE price END,'unlock:' || p_song::text) ON CONFLICT(user_id,song_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'already',prior,'coin_balance',balance,'cost',CASE WHEN prior THEN 0 ELSE price END);
END $$;
REVOKE ALL ON FUNCTION public.prepay_track(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepay_track(uuid,uuid) TO service_role;

-- When a prepaid track gets its studio task id, hand Take 2 over free.
CREATE OR REPLACE FUNCTION public.on_prepaid_task_bonus() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.suno_task_id IS NOT NULL AND NEW.suno_task_id IS DISTINCT FROM OLD.suno_task_id THEN
   PERFORM public.sync_owner_track_bonus(NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.on_prepaid_task_bonus() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prepaid_task_bonus ON public.songs;
CREATE TRIGGER prepaid_task_bonus AFTER UPDATE OF suno_task_id ON public.songs FOR EACH ROW EXECUTE FUNCTION public.on_prepaid_task_bonus();

CREATE OR REPLACE FUNCTION public.start_generation_charge(p_user uuid, p_song uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bal integer; prior integer; new_balance integer;
BEGIN
  IF p_user IS NULL OR p_song IS NULL OR p_reference IS NULL THEN RAISE EXCEPTION 'user_song_reference_required'; END IF;
  SELECT coin_balance INTO bal FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  -- Paid upfront: no minimum and no sample charge.
  IF EXISTS (SELECT 1 FROM public.unlocked_songs WHERE user_id=p_user AND song_id=p_song) THEN
    RETURN jsonb_build_object('ok', true, 'charged', 0, 'balance', COALESCE(bal,0), 'unpaid_count', 0, 'warning', false);
  END IF;
  IF COALESCE(bal, 0) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'min_balance', 'balance', COALESCE(bal, 0), 'min_balance', 5);
  END IF;
  prior := public.unpaid_track_count(p_user, p_song);
  IF prior >= 3 THEN
    new_balance := public.deduct_coins(p_user, 2, p_reference);
    RETURN jsonb_build_object('ok', true, 'charged', 2, 'balance', new_balance, 'unpaid_count', prior + 1, 'warning', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'charged', 0, 'balance', bal, 'unpaid_count', prior + 1, 'warning', prior + 1 >= 3);
END; $$;
REVOKE ALL ON FUNCTION public.start_generation_charge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_generation_charge(uuid, uuid, text) TO service_role;