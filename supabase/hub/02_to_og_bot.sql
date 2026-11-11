-- Run on a local copy (replay of supabase/migrations + 01_drift_from_live.sql)
-- to turn OG B0T's public schema into the hub's og_bot schema. The result is
-- dumped to og_bot_init.sql, which is what goes into the OGSTREAMZ hub.
-- Never run this on a live database.

ALTER SCHEMA public RENAME TO og_bot;
CREATE SCHEMA public;
COMMENT ON SCHEMA og_bot IS 'OG B0T (ogbot.co.uk). Hub rules: see the comment on schema public.';

-- One schema per app: OG B0T's private.song_retry_scheduler moves into og_bot
-- (RLS on, no grants to members, so it stays server-only).
ALTER TABLE private.song_retry_scheduler SET SCHEMA og_bot;
ALTER TABLE og_bot.song_retry_scheduler ENABLE ROW LEVEL SECURITY;
DROP SCHEMA private;

-- Function bodies and search paths are text, so they still say public
-- (or private).
DO $$
DECLARE f record; def text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'og_bot'::regnamespace LOOP
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, 'SET search_path TO ''public''', 'SET search_path TO ''og_bot''', 'g');
    def := regexp_replace(def, 'SET search_path TO public\M', 'SET search_path TO og_bot', 'g');
    def := regexp_replace(def, '\mpublic\.', 'og_bot.', 'g');
    def := regexp_replace(def, '\mprivate\.', 'og_bot.', 'g');
    def := regexp_replace(def, 'SET search_path TO ''og_bot'', ''private''', 'SET search_path TO ''og_bot''', 'g');
    EXECUTE def;
  END LOOP;
END $$;

-- Sign-up: only OG B0T's own users, and never block another app's sign-up.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE FUNCTION og_bot.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'og_bot'
AS $function$
BEGIN
  INSERT INTO og_bot.profiles (id, email, display_name, coin_balance)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'og_bot.handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER og_bot_on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW WHEN ((NEW.raw_app_meta_data ->> 'app') = 'og_bot')
  EXECUTE FUNCTION og_bot.handle_new_user();

-- Google sign-in and self sign-up can't carry the app tag, so the app calls
-- this once after sign-in: it creates the member's OG B0T profile the same
-- way the trigger would, and does nothing if it exists.
CREATE OR REPLACE FUNCTION og_bot.ensure_member()
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'og_bot'
AS $function$
DECLARE u auth.users%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM og_bot.profiles WHERE id = auth.uid()) THEN RETURN true; END IF;
  SELECT * INTO u FROM auth.users WHERE id = auth.uid();
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO og_bot.profiles (id, email, display_name, coin_balance)
  VALUES (u.id, u.email, COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)), 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN true;
END;
$function$;

-- Access exactly as on Lovable Cloud (2026-10-31), for anon, authenticated
-- and service_role.
GRANT USAGE ON SCHEMA og_bot TO anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA og_bot FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA og_bot FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA og_bot FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA og_bot TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA og_bot TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA og_bot TO service_role;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_usage_log','battle_lexicon','battle_tallies','boss_audit_log','boss_notification_prefs','boss_presence_alerts','bot_catchphrase_seen','bot_catchphrases','bot_tokens','chat_image_allowance','coin_transactions','community_blocks','community_history_clears','community_messages','community_reports','daily_drops','device_accounts','generation_attempts','ledgerly_settings','og_bot_remote_tokens','og_bot_token_invites','og_bot_tokens','og_learned_insults','og_lexicon','og_memories','payment_refunds','portals','profiles','referrals','security_audit_log','sign_in_events','song_brief_drafts','songs','sports_guide_access','sports_guide_posts','sports_guide_reminders','store_categories','store_items','stripe_webhook_events','subscriptions','telegram_dm_queue','telegram_ephemeral_messages','telegram_processed_updates','telegram_sign_in_events','tiktok_renders','unlocked_songs','user_activity_log','user_devices','user_notifications','user_onboarding_checks','user_roles','vault_webhook_settings','vip_acknowledgements','vip_expiry_reminders','vip_pass_credentials','vip_pass_purchases','vip_promo_codes'] LOOP
    EXECUTE format('GRANT ALL ON og_bot.%I TO anon, authenticated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['og_messages','user_preferences'] LOOP
    EXECUTE format('GRANT ALL ON og_bot.%I TO authenticated', t);
  END LOOP;
END $$;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON og_bot.app_settings TO anon;
GRANT ALL ON og_bot.app_settings TO authenticated;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER ON og_bot.site_content TO anon, authenticated;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p WHERE p.pronamespace = 'og_bot'::regnamespace LOOP
    IF f.proname = ANY (ARRAY['gen_bot_token_string','gen_og_bot_invite_code','gen_og_bot_token','gen_og_referral_code','og_vip_id_for','set_updated_at','set_updated_at_timestamp','songs_stamp_unlocked_at','tg_store_updated_at']) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', f.sig);
    ELSIF f.proname = ANY (ARRAY['admin_delete_lexicon_phrase','admin_has_vault_pass','admin_list_lexicon','admin_referral_audit','admin_referral_reconciliation','admin_update_profile_label','admin_upsert_lexicon_phrase','boss_burn_coins','boss_reclaim_coins','claim_daily_drop','claim_referral','claim_referrer_permanent','create_og_bot_invite','deduct_coins','dev_override_balance','dev_send_og_message_as_bot','get_my_referrer','get_referral_summary','has_role','has_sports_guide_access','increment_bot_interactions','list_community_songs','list_og_bot_remote_tokens_safe','log_user_activity','lookup_referrer','lookup_referrer_by_code','mint_coins','mint_coins_admin','my_generation_terms','purchase_bot_token','purchase_vip','redeem_og_bot_invite','regenerate_og_bot_token','revoke_og_bot_invite','revoke_og_bot_token','set_balance_admin','set_boss_admin','set_dev_admin','set_og_bot_admin','set_og_bot_token_expiry','set_site_content','set_vault_pass_admin','set_vip_admin','set_vip_expiry_admin','start_vip_trial_once','unrevoke_og_bot_token','validate_bot_token','ensure_member']) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $$;

-- Realtime, for the same tables as on Lovable Cloud.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_settings','coin_transactions','community_messages','og_messages','profiles','site_content','songs','sports_guide_posts','user_notifications','user_preferences'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE og_bot.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Hub rule 4: the D.EV accounts are admin, boss and dev in every app.
CREATE OR REPLACE FUNCTION og_bot.grant_dev_access()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'og_bot'
AS $function$
BEGIN
  INSERT INTO og_bot.profiles (id, email, display_name, coin_balance)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1), 0)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO og_bot.user_roles (user_id, role)
  SELECT NEW.id, r FROM unnest(ARRAY['admin', 'boss', 'dev']::og_bot.app_role[]) r
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'og_bot.grant_dev_access failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION og_bot.grant_dev_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER og_bot_dev_access AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (lower(NEW.email::text) = ANY (ARRAY['ogstreamz196@gmail.com', 'ogbot196@gmail.com'])
    AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION og_bot.grant_dev_access();
