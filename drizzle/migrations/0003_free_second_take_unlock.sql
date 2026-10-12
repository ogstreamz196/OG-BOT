CREATE OR REPLACE FUNCTION public.sync_owner_track_bonus(p_song uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.songs%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.songs WHERE id=p_song;
 IF NOT FOUND OR s.suno_task_id IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.user_id::text || ':' || s.suno_task_id, 0));
 IF NOT EXISTS(SELECT 1 FROM public.unlocked_songs WHERE song_id=s.id AND user_id=s.user_id AND source <> 'bundle_bonus') THEN RETURN; END IF;
 UPDATE public.songs SET unlocked=true, revealed=true WHERE user_id=s.user_id AND suno_task_id=s.suno_task_id;
 INSERT INTO public.unlocked_songs(user_id,song_id,source,cost_coins,reference)
 SELECT s.user_id,t.id,'bundle_bonus',0,'bonus:' || s.id::text FROM public.songs t
 WHERE t.user_id=s.user_id AND t.suno_task_id=s.suno_task_id AND t.id<>s.id
 ON CONFLICT(user_id,song_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.sync_owner_track_bonus(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_owner_track_bonus(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.on_paid_track_bonus() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.source <> 'bundle_bonus' THEN PERFORM public.sync_owner_track_bonus(NEW.song_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paid_track_bonus AFTER INSERT ON public.unlocked_songs FOR EACH ROW EXECUTE FUNCTION public.on_paid_track_bonus();
CREATE OR REPLACE FUNCTION public.on_late_track_bonus() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE paid_id uuid;
BEGIN
 IF NEW.suno_task_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.suno_task_id, 0));
 SELECT t.id INTO paid_id FROM public.songs t JOIN public.unlocked_songs u ON u.song_id=t.id AND u.user_id=t.user_id
 WHERE t.user_id=NEW.user_id AND t.suno_task_id=NEW.suno_task_id AND u.source<>'bundle_bonus' LIMIT 1;
 IF paid_id IS NOT NULL THEN PERFORM public.sync_owner_track_bonus(paid_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER late_track_bonus AFTER INSERT ON public.songs FOR EACH ROW EXECUTE FUNCTION public.on_late_track_bonus();
CREATE OR REPLACE FUNCTION public.purchase_owner_track(p_user uuid,p_song uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.songs%ROWTYPE; price integer; balance integer; prior boolean; sibling uuid;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user FOR UPDATE;
 SELECT * INTO s FROM public.songs WHERE id=p_song FOR UPDATE;
 IF NOT FOUND OR s.user_id<>p_user THEN RAISE EXCEPTION 'Track not found'; END IF;
 IF s.status<>'completed' OR s.audio_path IS NULL THEN RAISE EXCEPTION 'Song not ready'; END IF;
 prior := COALESCE(s.unlocked,false) OR EXISTS(SELECT 1 FROM public.unlocked_songs WHERE user_id=p_user AND song_id=p_song);
 SELECT CASE WHEN value::text ~ '^[0-9]+$' THEN value::text::integer ELSE 5 END INTO price FROM public.app_settings WHERE key='coins_per_full_unlock';
 price:=COALESCE(price,5);
 IF NOT prior THEN balance:=public.deduct_coins(p_user,price,'unlock:' || p_song::text); ELSE SELECT coin_balance INTO balance FROM public.profiles WHERE id=p_user; END IF;
 UPDATE public.songs SET unlocked=true WHERE id=p_song;
 INSERT INTO public.unlocked_songs(user_id,song_id,source,cost_coins,reference) VALUES(p_user,p_song,'coins',CASE WHEN prior THEN 0 ELSE price END,'unlock:' || p_song::text) ON CONFLICT(user_id,song_id) DO NOTHING;
 PERFORM public.sync_owner_track_bonus(p_song);
 SELECT id INTO sibling FROM public.songs WHERE user_id=p_user AND suno_task_id=s.suno_task_id AND id<>p_song LIMIT 1;
 RETURN jsonb_build_object('ok',true,'already',prior,'coin_balance',balance,'cost',CASE WHEN prior THEN 0 ELSE price END,'second_take',sibling);
END $$;
REVOKE ALL ON FUNCTION public.purchase_owner_track(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_owner_track(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.on_paid_track_bonus() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.on_late_track_bonus() FROM PUBLIC,anon,authenticated;