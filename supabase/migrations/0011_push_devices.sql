-- Saloni — the message goes to the phone, not to WhatsApp
--
-- 0010 filled the outbox and queued WhatsApp, because WhatsApp was the only
-- channel reachable without a native app. That is no longer the plan: the
-- waitlist should tap the customer on the shoulder through Saloni itself.
--
-- Push is the better channel for this and always was. It is free, it is
-- instant, it needs no Meta approval and no template whose wording cannot
-- change without resubmitting, and the notification opens the app it came
-- from. 0010 did not queue it for one reason, stated there plainly: there was
-- nowhere to send it, because a push message goes to a *device* and nothing
-- recorded any. That is what this migration adds.
--
-- The device is a browser to begin with — Saloni becomes installable, and an
-- installed page can be pushed to even while it is closed. When the Capacitor
-- wrap lands, an iOS or Android device registers in the same table and only
-- the sender's last hop changes. Hence `platform` rather than an assumption,
-- and `endpoint` holding either a Web Push URL or, later, a native token.
--
-- WhatsApp is not deleted. It is switched off — notification_settings.channels
-- decides, and it now defaults to push alone. The code and its assertions stay
-- because a customer who never installs the app is still reachable that way,
-- and turning it back on should be one update rather than a rewrite.

-- ---------------------------------------------------------------------------
-- 1. A device to send to
-- ---------------------------------------------------------------------------

create type push_platform as enum ('web', 'ios', 'android');

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  platform    push_platform not null default 'web',

  -- Web Push: the URL the browser's push service gave us, and the two keys it
  -- issued with it. Native later: endpoint holds the FCM or APNs token and the
  -- key columns stay empty. One table, because the queueing and the retiring of
  -- dead devices are identical either way.
  endpoint    text not null unique,
  p256dh      text not null default '',
  auth        text not null default '',

  -- Only to tell one of your own devices from another when revoking.
  label       text not null default '',

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint web_push_needs_its_keys
    check (platform <> 'web' or (p256dh <> '' and auth <> ''))
);

create index push_subscriptions_profile_idx
  on push_subscriptions (profile_id);

comment on table push_subscriptions is
  'One row per browser or device that has agreed to be notified. Registered '
  'through register_push_device(); never written directly.';

alter table push_subscriptions enable row level security;

-- You can see and revoke your own devices, and nobody else's.
create policy push_subscriptions_select_own on push_subscriptions
  for select to authenticated
  using (profile_id = auth.uid());

create policy push_subscriptions_delete_own on push_subscriptions
  for delete to authenticated
  using (profile_id = auth.uid());

-- Writing goes through the function below, for the same reason joining the
-- waitlist does: an account that can insert its own row can insert somebody
-- else's endpoint against its own profile, or claim another person's device by
-- re-pointing an existing row. The unique constraint on endpoint is what makes
-- that a real risk rather than a theoretical one.
revoke insert, update on push_subscriptions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Registering and revoking
-- ---------------------------------------------------------------------------

-- Idempotent: a browser re-subscribes on its own schedule, and the push service
-- may hand back the same endpoint or a new one. Re-registering an endpoint that
-- already belongs to somebody else moves it, because it is the same physical
-- browser — two accounts on one phone is ordinary, and the person signed in now
-- is the one who should receive that phone's notifications.
create function public.register_push_device(
  p_endpoint text,
  p_p256dh   text default '',
  p_auth     text default '',
  p_platform push_platform default 'web',
  p_label    text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'sign in before registering a device' using errcode = '42501';
  end if;

  if coalesce(p_endpoint, '') = '' then
    raise exception 'a device needs an endpoint' using errcode = 'SL020';
  end if;

  if p_platform = 'web' and (coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '') then
    raise exception 'a web device needs both of its keys' using errcode = 'SL021';
  end if;

  insert into push_subscriptions (profile_id, platform, endpoint, p256dh, auth, label)
  values (v_me, p_platform, p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''),
          left(coalesce(p_label, ''), 80))
  on conflict (endpoint) do update
    set profile_id   = v_me,
        platform     = excluded.platform,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        label        = excluded.label,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;

-- Turning notifications off in the browser does not tell us, so the app calls
-- this when it notices. Deleting somebody else's device is a no-op rather than
-- an error, so it cannot be used to find out whether an endpoint exists.
create function public.forget_push_device(p_endpoint text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from push_subscriptions
   where endpoint = p_endpoint and profile_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.forget_push_device(text) from public;
revoke execute on function public.forget_push_device(text) from anon;
grant execute on function public.forget_push_device(text) to authenticated;

-- The sender's version, for when a push service answers "this endpoint is
-- gone". It deletes by endpoint alone, because at that point nobody is signed
-- in — auth.uid() is null inside the worker, so the function above would match
-- nothing. Kept separate rather than folded in with a null check: an ordinary
-- account must never reach a delete that ignores who owns the row.
create function public.retire_push_device(p_endpoint text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.retire_push_device(text) from public;
revoke execute on function public.retire_push_device(text) from anon, authenticated;
grant execute on function public.retire_push_device(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Which channels are switched on
-- ---------------------------------------------------------------------------

-- Push only. WhatsApp stays built and tested; it is simply not sent.
-- To send both:  update notification_settings set channels = '{push,whatsapp}';
alter table notification_settings
  add column channels notify_channel[] not null default '{push}';

comment on column notification_settings.channels is
  'Which channels an offer is queued on. Push alone by default; adding '
  '''whatsapp'' turns the 0010 path back on without any code change.';

-- ---------------------------------------------------------------------------
-- 4. Queueing, now that there is more than one way to reach somebody
-- ---------------------------------------------------------------------------

-- Same body as 0010 except for the channel loop at the end. Each channel is
-- queued only if it is switched on, the customer allows it, and there is
-- somewhere for it to go — no registered device means no push row, exactly as
-- no phone number means no WhatsApp row. A queued message that could never
-- arrive is worse than none: it makes the outbox lie about what is happening.
create or replace function public.enqueue_offer_notification(p_offer_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o          waitlist_offers%rowtype;
  e          waitlist_entries%rowtype;
  p          profiles%rowtype;
  s          notification_settings%rowtype;
  v_salon_en text;
  v_salon_ar text;
  v_svc_en   text;
  v_svc_ar   text;
  v_payload  jsonb;
  v_queued   integer := 0;
  v_n        integer;
  v_devices  integer;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is null then
    return 0;
  end if;

  -- Never message about a seat that has already come and gone.
  if o.starts_at <= now() then
    return 0;
  end if;

  select * into e from waitlist_entries where id = o.entry_id;
  select * into p from profiles where id = e.customer_id;
  select * into s from notification_settings where id;

  select sa.name_en, sa.name_ar into v_salon_en, v_salon_ar
  from salons sa where sa.id = e.salon_id;

  select string_agg(sv.name_en, ' + ' order by sv.name_en),
         string_agg(sv.name_ar, ' + ' order by sv.name_en)
    into v_svc_en, v_svc_ar
  from services sv
  where sv.id = any (e.service_ids);

  -- No phone number and no e-mail: the sender reads the profile and the
  -- devices itself, and copying contact details into a row the account can
  -- read back would put them somewhere they need not be.
  v_payload := jsonb_build_object(
    'kind',         'waitlist_offer',
    'offer_id',     o.id,
    'salon',        jsonb_build_object('en', v_salon_en, 'ar', v_salon_ar),
    'services',     jsonb_build_object('en', coalesce(v_svc_en, ''),
                                       'ar', coalesce(v_svc_ar, '')),
    'starts_at',    o.starts_at,
    'expires_at',   o.expires_at,
    'hold_minutes', greatest(1, (extract(epoch from (o.expires_at - now())) / 60)::integer),
    'claim_url',    s.app_base_url || '?claim=' || o.claim_token::text
  );

  -- Push: needs a device that agreed to be notified.
  if 'push' = any (s.channels) and p.allow_push then
    select count(*) into v_devices from push_subscriptions where profile_id = p.id;
    if v_devices > 0 then
      insert into notifications (profile_id, channel, template, payload, locale,
                                 offer_id, send_after)
      values (p.id, 'push', 'waitlist_seat_offer', v_payload, p.locale,
              o.id, coalesce(notification_quiet_until(now()), now()))
      on conflict (offer_id, channel) where offer_id is not null do nothing;
      get diagnostics v_n = row_count;
      v_queued := v_queued + v_n;
    end if;
  end if;

  -- WhatsApp: built, tested, and off by default. Needs somewhere to send it
  -- and permission to send it.
  if 'whatsapp' = any (s.channels)
     and p.allow_whatsapp and coalesce(p.phone, '') <> '' then
    insert into notifications (profile_id, channel, template, payload, locale,
                               offer_id, send_after)
    values (p.id, 'whatsapp', 'waitlist_seat_offer', v_payload, p.locale,
            o.id, coalesce(notification_quiet_until(now()), now()))
    on conflict (offer_id, channel) where offer_id is not null do nothing;
    get diagnostics v_n = row_count;
    v_queued := v_queued + v_n;
  end if;

  return v_queued;
end;
$$;

revoke all on function public.enqueue_offer_notification(uuid) from public;
revoke execute on function public.enqueue_offer_notification(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the sender gets handed
-- ---------------------------------------------------------------------------

-- Replaces 0010's version, which returned a phone number and nothing else. A
-- push row needs the devices instead, and there may be several — a phone and a
-- laptop — so they come back as an array to send to in turn.
drop function if exists public.claim_pending_notifications(integer);

create function public.claim_pending_notifications(p_limit integer default 20)
returns table (
  id         uuid,
  channel    notify_channel,
  template   text,
  locale     text,
  payload    jsonb,
  attempts   integer,
  to_phone   text,
  to_name    text,
  devices    jsonb
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select n.id
    from notifications n
    left join waitlist_offers o on o.id = n.offer_id
    where n.sent_at is null
      and n.failed_at is null
      and n.send_after <= now()
      and n.attempts < 5
      -- Never send about a hold that has already lapsed or been taken.
      and (n.offer_id is null
           or (o.claimed_at is null and o.expires_at > now() and o.starts_at > now()))
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update of n skip locked
  ),
  claimed as (
    update notifications n
       set attempts = n.attempts + 1
      from due
     where n.id = due.id
    returning n.id, n.channel, n.template, n.locale, n.payload, n.attempts,
              n.profile_id
  )
  select c.id, c.channel, c.template, c.locale, c.payload, c.attempts,
         p.phone, nullif(p.full_name, ''),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'endpoint', d.endpoint,
                     'p256dh',   d.p256dh,
                     'auth',     d.auth,
                     'platform', d.platform))
              from push_subscriptions d
             where d.profile_id = c.profile_id),
           '[]'::jsonb)
  from claimed c
  join profiles p on p.id = c.profile_id;
end;
$$;

revoke all on function public.claim_pending_notifications(integer) from public;
revoke execute on function public.claim_pending_notifications(integer) from anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;
