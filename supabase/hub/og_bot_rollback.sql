-- Undoes og_bot_init.sql in the OGSTREAMZ hub: removes OG B0T's two triggers
-- on auth.users and the whole og_bot schema (all OG B0T data in the hub with
-- it). Touches nothing that belongs to another app. Lovable Cloud keeps
-- running untouched, so this is only for before the final switch.
DROP TRIGGER IF EXISTS og_bot_on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS og_bot_dev_access ON auth.users;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'og_bot' LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE og_bot.%I', t.tablename);
  END LOOP;
END $$;
DROP SCHEMA IF EXISTS og_bot CASCADE;
