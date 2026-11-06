-- dev.b055 PIN sign-in, shared by every OGSTREAMZ app (the Boss, 2026-11-06:
-- "all apps: dev.b055 sign in with the same key in a Supabase secret").
--
-- The PIN lives only in the hub's Vault (Supabase secret store) as
-- `dev_b055_pin` (4 digits). Apps never read it: their servers call their own
-- schema's dev_pin_check(pin), which asks ogstreamz_dev.check_pin. One lockout
-- for all apps: 5 wrong PINs lock it for 15 minutes, 20 in a UK day lock it
-- until the Boss unlocks it (dev_pin_unlock). Only the service role can call
-- any of it (never a browser). Every try is logged in ogstreamz_dev.pin_log
-- (no PINs stored). Idempotent.

create schema if not exists ogstreamz_dev;
revoke all on schema ogstreamz_dev from public, anon, authenticated;
grant usage on schema ogstreamz_dev to service_role;

create table if not exists ogstreamz_dev.pin_state (
  id int primary key default 1 check (id = 1),
  failures int not null default 0,
  window_started_at timestamptz,
  locked_until timestamptz,
  day date,
  day_failures int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists ogstreamz_dev.pin_log (
  id bigint generated always as identity primary key,
  app text not null,
  ok boolean not null,
  note text,
  at timestamptz not null default now()
);
alter table ogstreamz_dev.pin_state enable row level security;
alter table ogstreamz_dev.pin_log enable row level security;
revoke all on ogstreamz_dev.pin_state, ogstreamz_dev.pin_log from public, anon, authenticated;

create or replace function ogstreamz_dev.check_pin(p_pin text, p_app text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s ogstreamz_dev.pin_state;
  want text;
  got text := regexp_replace(coalesce(p_pin, ''), '\s', '', 'g');
  today date := (now() at time zone 'Europe/London')::date;
  fresh boolean;
  f int;
  df int;
  mins int;
begin
  insert into ogstreamz_dev.pin_state (id) values (1) on conflict (id) do nothing;
  select * into s from ogstreamz_dev.pin_state where id = 1 for update;

  if s.day = today and s.day_failures >= 20 then
    insert into ogstreamz_dev.pin_log (app, ok, note) values (p_app, false, 'locked for the day');
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', 'Too many wrong PINs today. Unlock it on the Boss page.');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    mins := greatest(1, ceil(extract(epoch from (s.locked_until - now())) / 60)::int);
    insert into ogstreamz_dev.pin_log (app, ok, note) values (p_app, false, 'locked');
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', format('Too many wrong PINs. Try again in %s minute%s.', mins, case when mins = 1 then '' else 's' end));
  end if;

  select regexp_replace(decrypted_secret, '[\s"'']', '', 'g') into want
    from vault.decrypted_secrets where name = 'dev_b055_pin' limit 1;
  if want is null or want !~ '^\d{4}$' then
    insert into ogstreamz_dev.pin_log (app, ok, note) values (p_app, false, 'not set');
    return jsonb_build_object('ok', false, 'code', 'not_set',
      'message', 'The dev PIN isn''t set up yet.');
  end if;

  if got = want then
    update ogstreamz_dev.pin_state
      set failures = 0, window_started_at = null, locked_until = null, updated_at = now()
      where id = 1;
    insert into ogstreamz_dev.pin_log (app, ok) values (p_app, true);
    return jsonb_build_object('ok', true);
  end if;

  fresh := s.window_started_at is null or now() - s.window_started_at > interval '15 minutes';
  f := (case when fresh then 0 else s.failures end) + 1;
  df := (case when s.day = today then s.day_failures else 0 end) + 1;
  update ogstreamz_dev.pin_state set
    failures = case when f >= 5 then 0 else f end,
    window_started_at = case when fresh then now() else s.window_started_at end,
    locked_until = case when f >= 5 then now() + interval '15 minutes' else s.locked_until end,
    day = today,
    day_failures = df,
    updated_at = now()
  where id = 1;
  insert into ogstreamz_dev.pin_log (app, ok, note) values (p_app, false, 'wrong PIN');
  if df >= 20 then
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', 'Too many wrong PINs today. Unlock it on the Boss page.');
  elsif f >= 5 then
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', 'Too many wrong PINs. Try again in 15 minutes.');
  end if;
  return jsonb_build_object('ok', false, 'code', 'wrong',
    'message', format('Wrong PIN. %s %s left.', 5 - f, case when 5 - f = 1 then 'try' else 'tries' end));
end;
$$;

create or replace function ogstreamz_dev.unlock_pin()
returns void
language sql
security definer
set search_path = ''
as $$
  update ogstreamz_dev.pin_state
    set failures = 0, window_started_at = null, locked_until = null, day_failures = 0, updated_at = now()
    where id = 1;
$$;

revoke all on function ogstreamz_dev.check_pin(text, text), ogstreamz_dev.unlock_pin()
  from public, anon, authenticated;
grant execute on function ogstreamz_dev.check_pin(text, text), ogstreamz_dev.unlock_pin()
  to service_role;

-- Each app's own door, in its own schema (already exposed), service role only.
do $$
declare
  a record;
begin
  for a in select * from (values ('og_bot'), ('og_booking'), ('padel'), ('public')) v(schema_name)
  loop
    if exists (select 1 from pg_namespace where nspname = a.schema_name) then
      execute format($f$
        create or replace function %1$I.dev_pin_check(p_pin text) returns jsonb
        language sql security definer set search_path = ''
        as $b$ select ogstreamz_dev.check_pin(p_pin, %2$L) $b$;
        create or replace function %1$I.dev_pin_unlock() returns void
        language sql security definer set search_path = ''
        as $b$ select ogstreamz_dev.unlock_pin() $b$;
        revoke all on function %1$I.dev_pin_check(text), %1$I.dev_pin_unlock() from public, anon, authenticated;
        grant execute on function %1$I.dev_pin_check(text), %1$I.dev_pin_unlock() to service_role;
      $f$, a.schema_name, case when a.schema_name = 'public' then 'og_vault' else a.schema_name end);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
