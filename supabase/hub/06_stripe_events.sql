-- Applied to the OGSTREAMZ hub as migration ogstreamz_billing_events (2026-11-07).
-- One Stripe webhook for every OGSTREAMZ app (the owner, 2026-11-07). The
-- hub Edge Function ogstreamz-stripe-webhook verifies each event and keeps
-- it here once, labelled with the app from the object's metadata.app
-- (og_booking, padel, og_bot, ...). Apps read their own rows with the
-- service role. Never exposed to browsers. Never deleted (billing history).
create schema if not exists ogstreamz_billing;
revoke all on schema ogstreamz_billing from public, anon, authenticated;
grant usage on schema ogstreamz_billing to service_role;

create table if not exists ogstreamz_billing.stripe_events (
  id text primary key,                 -- Stripe's event id (evt_...): one row per event
  type text not null,                  -- e.g. checkout.session.completed
  app text not null default 'unknown', -- metadata.app of the event's object
  livemode boolean not null default false,
  object_id text,                      -- the subscription / session / invoice id
  customer text,
  created_at timestamptz not null,     -- when Stripe made the event
  received_at timestamptz not null default now(),
  handled_at timestamptz,              -- set by the app once it has acted on it
  handled_note text,
  payload jsonb not null
);
create index if not exists stripe_events_app_idx on ogstreamz_billing.stripe_events (app, received_at desc);
create index if not exists stripe_events_unhandled_idx on ogstreamz_billing.stripe_events (app, received_at) where handled_at is null;
alter table ogstreamz_billing.stripe_events enable row level security;
revoke all on ogstreamz_billing.stripe_events from public, anon, authenticated;
grant all on ogstreamz_billing.stripe_events to service_role;

-- Each app's door, in its own schema (already exposed), service role only:
-- its unhandled events, and marking one handled.
do $$
declare a record;
begin
  for a in select * from (values ('og_bot','og_bot'), ('og_booking','og_booking'), ('padel','padel')) v(sch, app)
  loop
    if exists (select 1 from pg_namespace where nspname = a.sch) then
      execute format($f$
        create or replace function %1$I.stripe_events_pending(p_limit int default 50)
        returns setof ogstreamz_billing.stripe_events
        language sql stable security definer set search_path = ''
        as $b$ select * from ogstreamz_billing.stripe_events
               where app = %2$L and handled_at is null
               order by received_at limit greatest(1, least(p_limit, 200)) $b$;
        create or replace function %1$I.stripe_event_handled(p_id text, p_note text default null)
        returns void language sql security definer set search_path = ''
        as $b$ update ogstreamz_billing.stripe_events set handled_at = now(), handled_note = p_note
               where id = p_id and app = %2$L $b$;
        revoke all on function %1$I.stripe_events_pending(int), %1$I.stripe_event_handled(text, text) from public, anon, authenticated;
        grant execute on function %1$I.stripe_events_pending(int), %1$I.stripe_event_handled(text, text) to service_role;
      $f$, a.sch, a.app);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
