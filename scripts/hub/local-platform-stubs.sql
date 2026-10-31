-- Minimal stand-ins for the hosted platform (auth, storage, cron, net, vault),
-- so supabase/migrations can be replayed on a plain local Postgres. Local only.
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator login noinherit; create role supabase_admin superuser; create role supabase_auth_admin; create role supabase_storage_admin; create role dashboard_user;
exception when duplicate_object then null; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;

set search_path = "$user", public, extensions;
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token text, confirmation_sent_at timestamptz,
  recovery_token text, recovery_sent_at timestamptz, email_change_token_new text, email_change text, email_change_sent_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', is_super_admin boolean,
  created_at timestamptz default now(), updated_at timestamptz default now(), phone text, phone_confirmed_at timestamptz,
  phone_change text, phone_change_token text, phone_change_sent_at timestamptz, confirmed_at timestamptz,
  email_change_token_current text, email_change_confirm_status smallint, banned_until timestamptz, reauthentication_token text,
  reauthentication_sent_at timestamptz, is_sso_user boolean default false, deleted_at timestamptz, is_anonymous boolean default false);
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text, provider_id text, identity_data jsonb, email text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table if not exists auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz, updated_at timestamptz, not_after timestamptz, user_agent text, ip inet, refreshed_at timestamptz);
create table if not exists auth.refresh_tokens (id bigserial primary key, token text, user_id text, revoked boolean, created_at timestamptz, updated_at timestamptz, session_id uuid);
create table if not exists auth.mfa_factors (id uuid primary key, user_id uuid);
create table if not exists auth.audit_log_entries (instance_id uuid, id uuid primary key, payload json, created_at timestamptz, ip_address varchar(64));
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
create or replace function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true), '')::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text unique, owner uuid, public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text, type text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[], version text, user_metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text default 'postgres', username text default 'postgres', active boolean default true, jobname text unique);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$ declare i bigint; begin insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into i; return i; end $$;
create or replace function cron.schedule(schedule text, command text) returns bigint language sql as $$ insert into cron.job(schedule, command) values (schedule, command) returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;
create or replace function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text, created_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, secret, description, created_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
create schema if not exists realtime;
create schema if not exists graphql_public;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
