-- Changes made on Lovable Cloud's live database that never reached
-- supabase/migrations (found by comparing a replay of every migration with
-- the live schema, 2026-10-31). Applied after the replay, before the move
-- to the og_bot schema. Written against public; 02 renames it.

-- Tables only live had.
CREATE TABLE IF NOT EXISTS public.ai_key_failures (id bigint NOT NULL, key_name text NOT NULL, status integer NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now(), alerted_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.community_history_clears (user_id uuid NOT NULL, cleared_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.generation_attempts (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, song_id uuid, title text, stage text NOT NULL DEFAULT 'lyrics'::text, status text NOT NULL DEFAULT 'started'::text, error_message text, context jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ledgerly_settings (id integer NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT false, api_key text, last_test_ok boolean, last_test_at timestamp with time zone, last_error text, updated_at timestamp with time zone NOT NULL DEFAULT now(), last_sync_at timestamp with time zone, key_name text);
CREATE TABLE IF NOT EXISTS public.telegram_worker_bots (id uuid NOT NULL DEFAULT gen_random_uuid(), bot_id bigint NOT NULL, name text NOT NULL, username text NOT NULL, role text NOT NULL DEFAULT 'assistant'::text, instructions text NOT NULL DEFAULT ''::text, token_ciphertext text NOT NULL, enabled boolean NOT NULL DEFAULT true, webhook_connected boolean NOT NULL DEFAULT false, created_by uuid NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.telegram_worker_updates (worker_id uuid NOT NULL, update_id bigint NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.vault_webhook_settings (id integer NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT false, target_url text, secret text, last_test_ok boolean, last_test_at timestamp with time zone, last_error text, last_sent_at timestamp with time zone, updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.vip_expiry_reminders (user_id uuid NOT NULL, expires_at timestamp with time zone NOT NULL, kind text NOT NULL, sent_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE public.ai_key_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_history_clears ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledgerly_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_worker_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_worker_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_webhook_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_expiry_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_key_failures ADD CONSTRAINT ai_key_failures_pkey PRIMARY KEY (id);
ALTER TABLE public.community_history_clears ADD CONSTRAINT community_history_clears_pkey PRIMARY KEY (user_id);
ALTER TABLE public.generation_attempts ADD CONSTRAINT generation_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.ledgerly_settings ADD CONSTRAINT ledgerly_settings_id_check CHECK ((id = 1));
ALTER TABLE public.ledgerly_settings ADD CONSTRAINT ledgerly_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.telegram_worker_bots ADD CONSTRAINT telegram_worker_bots_bot_id_key UNIQUE (bot_id);
ALTER TABLE public.telegram_worker_bots ADD CONSTRAINT telegram_worker_bots_pkey PRIMARY KEY (id);
ALTER TABLE public.telegram_worker_bots ADD CONSTRAINT telegram_worker_bots_role_check CHECK ((role = ANY (ARRAY['trade'::text, 'assistant'::text, 'copy'::text])));
ALTER TABLE public.telegram_worker_updates ADD CONSTRAINT telegram_worker_updates_pkey PRIMARY KEY (worker_id, update_id);
ALTER TABLE public.telegram_worker_updates ADD CONSTRAINT telegram_worker_updates_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.telegram_worker_bots(id) ON DELETE CASCADE;
ALTER TABLE public.vault_webhook_settings ADD CONSTRAINT vault_webhook_settings_id_check CHECK ((id = 1));
ALTER TABLE public.vault_webhook_settings ADD CONSTRAINT vault_webhook_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.vip_expiry_reminders ADD CONSTRAINT vip_expiry_reminders_pkey PRIMARY KEY (user_id, expires_at, kind);

-- Columns only live had.
ALTER TABLE public.community_messages ADD COLUMN IF NOT EXISTS guest_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vip_name_confirmed_at timestamp with time zone;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS orchestration jsonb;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS orchestration_due_at timestamp with time zone;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS orchestration_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.trade_signals ADD COLUMN IF NOT EXISTS sender_worker text;

-- Indexes.
CREATE INDEX IF NOT EXISTS ai_key_failures_pending_idx ON public.ai_key_failures USING btree (created_at) WHERE (alerted_at IS NULL);
CREATE INDEX IF NOT EXISTS community_messages_guest_created_idx ON public.community_messages USING btree (guest_id, created_at) WHERE (guest_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS community_messages_guest_idx ON public.community_messages USING btree (guest_id, created_at) WHERE (guest_id IS NOT NULL);
DROP INDEX IF EXISTS public.community_messages_user_created_idx;
CREATE INDEX community_messages_user_created_idx ON public.community_messages USING btree (user_id, created_at);
CREATE INDEX IF NOT EXISTS generation_attempts_created_idx ON public.generation_attempts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS generation_attempts_user_idx ON public.generation_attempts USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS songs_orchestration_due_idx ON public.songs USING btree (orchestration_due_at) WHERE (orchestration IS NOT NULL);

-- Live has no foreign key from guest_battle_claims to users, and names
-- the cashback trigger differently.
ALTER TABLE public.guest_battle_claims DROP CONSTRAINT IF EXISTS guest_battle_claims_user_id_fkey;
DROP TRIGGER IF EXISTS coin_tx_referral_cashback_on_burn ON public.coin_transactions;

-- Functions only live had, or live's newer versions.
CREATE OR REPLACE FUNCTION public.og_vip_id_for(p_name text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g')) LIKE 'OG%'
    THEN upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g'))
    ELSE 'OG' || upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]', '', 'g')) END
$function$;

CREATE OR REPLACE FUNCTION public.admin_has_vault_pass(p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (public.has_role(auth.uid(), 'boss') OR public.has_role(auth.uid(), 'admin'))
    AND EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = p_user);
$function$;

CREATE OR REPLACE FUNCTION public.assign_og_vip_id(p_user uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  username text;
  candidate text;
BEGIN
  SELECT regexp_replace(display_name, '[^A-Za-z0-9]', '', 'g') INTO username
  FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF username IS NULL OR length(username) < 3 OR length(username) > 30 OR username !~ '[A-Za-z]' THEN
    RAISE EXCEPTION 'A valid username is required before assigning an OG VIP ID';
  END IF;
  candidate := public.og_vip_id_for(username);
  UPDATE public.profiles SET og_vip_id = candidate
  WHERE id = p_user AND og_vip_id IS DISTINCT FROM candidate;
  RETURN candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_orchestrations(p_limit integer DEFAULT 2)
 RETURNS SETOF public.songs LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.songs s
    WHERE s.orchestration IS NOT NULL
      AND s.status = 'draft'
      AND s.orchestration_due_at <= now()
      AND s.orchestration_attempts < 3
      AND s.created_at > now() - interval '6 hours'
    ORDER BY s.orchestration_due_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 2), 3))
  )
  UPDATE public.songs s
  SET orchestration_attempts = s.orchestration_attempts + 1,
      orchestration_due_at = now() + interval '10 minutes'
  FROM due WHERE s.id = due.id
  RETURNING s.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_guest_battle(_user_id uuid, _guest_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.grant_vault_pass(p_user uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cred uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = p_user) THEN RETURN true; END IF;
  SELECT id INTO v_cred FROM public.vip_pass_credentials WHERE active ORDER BY random() LIMIT 1;
  IF v_cred IS NULL THEN RETURN false; END IF;
  INSERT INTO public.vip_pass_purchases (user_id, credential_id) VALUES (p_user, v_cred)
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$function$;

DROP FUNCTION IF EXISTS public.list_community_songs(integer, integer);
CREATE OR REPLACE FUNCTION public.list_community_songs(p_offset integer DEFAULT 0, p_limit integer DEFAULT 12)
 RETURNS TABLE(id uuid, user_id uuid, title text, style text, cover_url text, audio_path text, sample_path text, stream_audio_url text, duration_seconds numeric, created_at timestamp with time zone, completed_at timestamp with time zone, status text, unlocked boolean, revealed boolean, is_variation boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.id, s.user_id, s.title, s.style, s.cover_url, s.audio_path, s.sample_path,
         s.stream_audio_url, s.duration_seconds, s.created_at, s.completed_at, s.status,
         s.unlocked, s.revealed, s.is_variation
  FROM public.songs s
  WHERE s.status = 'completed'
    AND s.is_public = true
    AND COALESCE(s.revealed, true) = true
    AND auth.uid() IS NOT NULL
  ORDER BY s.created_at DESC
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
  LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit, 12)));
$function$;

CREATE OR REPLACE FUNCTION public.sync_owner_track_bonus(p_song uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.on_late_track_bonus()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE paid_id uuid;
BEGIN
 IF NEW.suno_task_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.suno_task_id, 0));
 SELECT t.id INTO paid_id FROM public.songs t JOIN public.unlocked_songs u ON u.song_id=t.id AND u.user_id=t.user_id
 WHERE t.user_id=NEW.user_id AND t.suno_task_id=NEW.suno_task_id AND u.source<>'bundle_bonus' LIMIT 1;
 IF paid_id IS NOT NULL THEN PERFORM public.sync_owner_track_bonus(paid_id); END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.on_paid_track_bonus()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.source <> 'bundle_bonus' THEN PERFORM public.sync_owner_track_bonus(NEW.song_id); END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.on_prepaid_task_bonus()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.suno_task_id IS NOT NULL AND NEW.suno_task_id IS DISTINCT FROM OLD.suno_task_id THEN
   PERFORM public.sync_owner_track_bonus(NEW.id);
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.protect_og_vip_id()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  cleaned text;
  is_client boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
  active_vip boolean;
BEGIN
  IF is_client THEN
    -- Members may confirm once but never clear or move the confirmation.
    IF OLD.vip_name_confirmed_at IS NOT NULL THEN
      NEW.vip_name_confirmed_at := OLD.vip_name_confirmed_at;
    ELSIF NEW.vip_name_confirmed_at IS NOT NULL THEN
      NEW.vip_name_confirmed_at := now();
    END IF;
    IF OLD.vip_name_confirmed_at IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = OLD.id AND role = 'vip'
        AND (expires_at IS NULL OR expires_at > now())) INTO active_vip;
      IF active_vip THEN
        RAISE EXCEPTION 'Your username is locked to your VIP ID while VIP is active';
      END IF;
    END IF;
  END IF;

  IF OLD.og_vip_id IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    cleaned := regexp_replace(coalesce(NEW.display_name, ''), '[^A-Za-z0-9]', '', 'g');
    IF length(cleaned) < 3 OR length(cleaned) > 30 OR cleaned !~ '[A-Za-z]' THEN
      RAISE EXCEPTION 'A valid username is required for an OG VIP ID';
    END IF;
    NEW.og_vip_id := public.og_vip_id_for(cleaned);
  ELSIF NEW.og_vip_id IS DISTINCT FROM OLD.og_vip_id AND is_client THEN
    NEW.og_vip_id := OLD.og_vip_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_owner_track(p_user uuid, p_song uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_vip()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  cost   integer := 20;
  new_balance integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = caller AND role = 'vip') THEN
    RAISE EXCEPTION 'already_vip';
  END IF;

  -- Bypass self-balance-protect trigger for this txn
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  UPDATE public.profiles
    SET coin_balance = coin_balance - cost
    WHERE id = caller AND coin_balance >= cost
    RETURNING coin_balance INTO new_balance;
  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  INSERT INTO public.user_roles(user_id, role) VALUES (caller, 'vip')
    ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
    VALUES (caller, -cost, 'vip_purchase', 'self_purchase_vip');

  RETURN new_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_telegram_worker(p_chat bigint, p_worker text, p_on boolean)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 UPDATE public.telegram_managed_groups SET active_workers = CASE WHEN p_on THEN CASE WHEN active_workers ? p_worker THEN active_workers ELSE active_workers || jsonb_build_array(p_worker) END ELSE active_workers - p_worker END, updated_at=now() WHERE chat_id=p_chat RETURNING active_workers INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_vault_pass_admin(target_user_id uuid, grant_access boolean, admin_notes text DEFAULT NULL::text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cred uuid;
BEGIN
  IF v_actor IS NULL OR NOT (public.has_role(v_actor, 'boss') OR public.has_role(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF grant_access THEN
    IF NOT EXISTS (SELECT 1 FROM public.vip_pass_purchases WHERE user_id = target_user_id) THEN
      SELECT id INTO v_cred FROM public.vip_pass_credentials WHERE active ORDER BY random() LIMIT 1;
      IF v_cred IS NULL THEN
        RAISE EXCEPTION 'no active vault credentials available';
      END IF;
      INSERT INTO public.vip_pass_purchases (user_id, credential_id) VALUES (target_user_id, v_cred)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.vip_pass_purchases WHERE user_id = target_user_id;
  END IF;

  INSERT INTO public.boss_audit_log (actor_id, action, category, target_key, old_value, new_value, metadata)
  VALUES (
    v_actor,
    CASE WHEN grant_access THEN 'vault_pass_grant' ELSE 'vault_pass_revoke' END,
    'vault_pass',
    target_user_id::text,
    NULL,
    admin_notes,
    jsonb_build_object('granted', grant_access)
  );

  RETURN grant_access;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_vip_admin(target_user_id uuid, make_vip boolean, admin_notes text DEFAULT NULL::text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  exists_already boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'target_not_found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = target_user_id AND role = 'vip'
  ) INTO exists_already;

  IF make_vip THEN
    IF exists_already THEN RETURN true; END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (target_user_id, 'vip')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
      VALUES (target_user_id, 0, 'vip_grant',
              'admin_grant_vip' || COALESCE(' | ' || NULLIF(btrim(admin_notes), ''), ''));
    RETURN true;
  ELSE
    IF NOT exists_already THEN RETURN false; END IF;
    DELETE FROM public.user_roles WHERE user_id = target_user_id AND role = 'vip';
    INSERT INTO public.coin_transactions(user_id, amount, type, reference)
      VALUES (target_user_id, 0, 'vip_revoke',
              'admin_revoke_vip' || COALESCE(' | ' || NULLIF(btrim(admin_notes), ''), ''));
    RETURN false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_generation_charge(p_user uuid, p_song uuid, p_reference text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
END; $function$;

-- Triggers.
DROP TRIGGER IF EXISTS generation_attempts_updated ON public.generation_attempts;
CREATE TRIGGER generation_attempts_updated BEFORE UPDATE ON public.generation_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS late_track_bonus ON public.songs;
CREATE TRIGGER late_track_bonus AFTER INSERT ON public.songs FOR EACH ROW EXECUTE FUNCTION public.on_late_track_bonus();
DROP TRIGGER IF EXISTS paid_track_bonus ON public.unlocked_songs;
CREATE TRIGGER paid_track_bonus AFTER INSERT ON public.unlocked_songs FOR EACH ROW EXECUTE FUNCTION public.on_paid_track_bonus();
DROP TRIGGER IF EXISTS prepaid_task_bonus ON public.songs;
CREATE TRIGGER prepaid_task_bonus AFTER UPDATE OF suno_task_id ON public.songs FOR EACH ROW EXECUTE FUNCTION public.on_prepaid_task_bonus();
DROP TRIGGER IF EXISTS trg_referral_cashback_on_burn ON public.coin_transactions;
CREATE TRIGGER trg_referral_cashback_on_burn AFTER INSERT ON public.coin_transactions FOR EACH ROW EXECUTE FUNCTION public.pay_referral_cashback_on_burn();

-- Access rules.
DROP POLICY IF EXISTS "own attempts insert" ON public.generation_attempts;
CREATE POLICY "own attempts insert" ON public.generation_attempts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "own attempts select" ON public.generation_attempts;
CREATE POLICY "own attempts select" ON public.generation_attempts AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "own attempts update" ON public.generation_attempts;
CREATE POLICY "own attempts update" ON public.generation_attempts AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

-- ai_key_failures.id is an identity column on live.
DO $$ BEGIN
  ALTER TABLE public.ai_key_failures ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
EXCEPTION WHEN others THEN NULL; END $$;
