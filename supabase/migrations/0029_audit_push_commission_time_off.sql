-- 0029: four findings from the third audit, each demonstrated before it was fixed.
--
--   M1. The worker posted to whatever address a device registered.
--       register_push_device() checked only that the endpoint was not empty, so
--       an account could register http://169.254.169.254/… or any host and
--       port, then get itself a waitlist offer with a second account, and the
--       service-role worker would POST there. The failure text landed in
--       notifications.error, which the account can read: a scanner of
--       Supabase's own network, with the answers delivered back.
--
--   M2. One account could stall everybody's notifications. Devices were
--       unbounded (2,000 registered from one account) and the worker sends to
--       each in turn with no timeout, so one message for that account could
--       hold a batch of twenty until the function was killed. Claiming bumped
--       `attempts` without moving `send_after`, so the killed batch was
--       re-claimed a minute later and five minutes burned everybody's retries.
--
--   M3. A salon owner could zero what it owes Saloni. 0006's trigger let the
--       owner make any status change, so a visit marked completed (which is
--       what lets the customer review it) could be flipped to no_show at the
--       end of the month: commission_statement() counts completed only, and
--       the review stayed.
--
--   M4. "Only you see this" was not true. time_off is readable by anon for a
--       public salon, table-wide, so every visitor could read every reason an
--       owner typed — "hospital appointment" was the test value.
--
-- The CLAUDE.md lesson applies to each: a rule enforced in one place is a rule
-- until somebody finds the other place. So M1 is a CHECK CONSTRAINT on the
-- table, not only a test in the function, and M3 is in the trigger every path
-- goes through.

-- ---------------------------------------------------------------------------
-- M1. A web push endpoint is an address at a push service, and nothing else
-- ---------------------------------------------------------------------------

-- The push services every browser actually uses. Chrome, Edge-on-Android,
-- Samsung Internet, Opera and Brave all go through FCM; Firefox through
-- Mozilla's; Safari (macOS and installed iPhone apps) through Apple's; Edge on
-- Windows through WNS, whose host varies by region (wns2-par02p.notify…).
-- Native tokens (android/ios) are not URLs and the worker never posts to them.
create function public.is_push_service_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    length(p_endpoint) <= 1000
    and p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/',
    false);
$$;

revoke all on function public.is_push_service_endpoint(text) from public;
revoke execute on function public.is_push_service_endpoint(text) from anon, authenticated;

-- Any row already there that is not a push service was never a real browser,
-- so it can only be an attempt at this. Removed rather than grandfathered.
delete from push_subscriptions
 where platform = 'web' and not public.is_push_service_endpoint(endpoint);

alter table push_subscriptions
  add constraint push_web_endpoint_is_push_service
  check (platform <> 'web' or public.is_push_service_endpoint(endpoint));

-- The keys are base64url of fixed-size values; cap them so a row cannot be a
-- megabyte the worker has to carry around.
alter table push_subscriptions
  add constraint push_keys_are_bounded
  check (length(p256dh) <= 200 and length(auth) <= 100);

-- The failure text is the worker's diagnosis, not the account's business: it
-- is what turned M1 into a scanner. Reading your own notifications stays —
-- every column but `error`. A column revoke does nothing against a table-wide
-- grant (CLAUDE.md §7), so the table grant goes and the columns are named.
revoke select on notifications from anon, authenticated;
grant select (id, profile_id, channel, template, payload, sent_at, delivered_at,
              failed_at, created_at, offer_id, locale, send_after, attempts, booking_id)
  on notifications to authenticated;

-- ---------------------------------------------------------------------------
-- M1 + M2. register_push_device(): the address is checked, and ten is plenty
-- ---------------------------------------------------------------------------

-- Same as 0017 with two additions: the endpoint must be a push service
-- (answered with its own code, so the app can say something sensible rather
-- than surface a constraint violation), and an account keeps its ten most
-- recently seen devices. Ten covers a phone, a tablet, a laptop and several
-- reinstalls; the oldest go first, which is the one most likely to be dead.
create or replace function public.register_push_device(
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
  v_me      uuid := auth.uid();
  v_id      uuid;
  v_owner   uuid;
  v_p256dh  text;
  v_auth    text;
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

  if p_platform = 'web' and not is_push_service_endpoint(p_endpoint) then
    raise exception 'that is not a push service address' using errcode = 'SL022';
  end if;

  select profile_id, p256dh, auth
    into v_owner, v_p256dh, v_auth
  from push_subscriptions
  where endpoint = p_endpoint;

  -- Somebody else's row. The keys are the proof, and they are checked before
  -- anything is written (0017).
  if v_owner is not null and v_owner <> v_me then
    if coalesce(p_p256dh, '') <> coalesce(v_p256dh, '')
       or coalesce(p_auth, '') <> coalesce(v_auth, '')
    then
      raise exception 'that device belongs to another account' using errcode = '42501';
    end if;
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

  -- Ten per account, newest kept. The row just written is always the newest.
  delete from push_subscriptions
   where profile_id = v_me
     and id in (
       select id from push_subscriptions
        where profile_id = v_me
        order by last_seen_at desc, id
        offset 10
     );

  return v_id;
end;
$$;

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- M2. A claimed message is not due again for five minutes
-- ---------------------------------------------------------------------------

-- Identical to 0028's except one line: claiming moves send_after as well as
-- attempts. The worker marks a row sent or failed within seconds; if it is
-- killed first, the row now waits five minutes instead of being re-claimed on
-- the next tick, so one stuck run cannot spend everybody's five attempts in
-- five minutes. mark_notification_failed() already sets the same delay.
create or replace function public.claim_pending_notifications(p_limit integer default 20)
returns table (
  id         uuid,
  channel    notify_channel,
  template   text,
  locale     text,
  payload    jsonb,
  attempts   integer,
  to_phone   text,
  to_name    text,
  devices    jsonb,
  to_email   text
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
    left join bookings b on b.id = n.booking_id
    where n.sent_at is null
      and n.failed_at is null
      and n.send_after <= now()
      and n.attempts < 5
      -- Never send about a hold that has already lapsed or been taken.
      and (n.offer_id is null
           or (o.claimed_at is null and o.expires_at > now() and o.starts_at > now()))
      -- Never remind about, or confirm, an appointment that is no longer on.
      and (n.booking_id is null
           or n.template = 'booking_cancelled'
           or (b.status in ('pending', 'confirmed') and b.starts_at > now()))
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update of n skip locked
  ),
  claimed as (
    update notifications n
       set attempts   = n.attempts + 1,
           send_after = now() + interval '5 minutes'
      from due
     where n.id = due.id
    returning n.id, n.channel, n.template, n.locale, n.payload, n.attempts, n.profile_id
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
           '[]'::jsonb),
         (select u.email::text from auth.users u where u.id = c.profile_id)
  from claimed c
  join profiles p on p.id = c.profile_id;
end;
$$;

revoke all on function public.claim_pending_notifications(integer) from public;
revoke execute on function public.claim_pending_notifications(integer) from anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;

-- ---------------------------------------------------------------------------
-- M3. A completed visit stays completed
-- ---------------------------------------------------------------------------

-- 0006 trusted the owner with the whole lifecycle, on the reasoning that a
-- review still needs the customer's own account. That was true, and 0018 made
-- it insufficient: once commission is counted from `completed`, the owner
-- holds the one switch that decides what they owe. The owner's screen has
-- never offered a change from completed (AppointmentSheet.nextStatuses), so
-- this refuses nothing an honest owner can reach. A genuine mistake is
-- corrected by Saloni in the Supabase dashboard's SQL editor (no JWT, so the
-- first branch below): a person accountable for it, and no new in-app path.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- No JWT means service_role: the dashboard and the migrations themselves.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if is_salon_owner(old.salon_id) then
    if old.status = 'completed' then
      raise exception 'a completed visit cannot be changed; contact Saloni to correct it'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- The customer may call it off, and that is all (0006, unchanged).
  if old.customer_id = auth.uid() then
    if new.status = 'cancelled' and old.status in ('pending', 'confirmed') then
      return new;
    end if;
    raise exception 'a customer may only cancel a pending or confirmed booking'
      using errcode = '42501';
  end if;

  raise exception 'not entitled to change this booking''s status'
    using errcode = '42501';
end;
$$;

revoke all on function public.enforce_booking_status_transition() from public;
revoke execute on function public.enforce_booking_status_transition() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- M4. The reason for time off is the salon's alone
-- ---------------------------------------------------------------------------

-- Visitors still need to see that a period is blocked — not for the picker,
-- which asks available_slots(), but because the row is harmless without its
-- reason. So every column but `reason`, named, after the table grant goes
-- (a column revoke against a table grant does nothing — CLAUDE.md §7).
revoke select on time_off from anon, authenticated;
grant select (id, salon_id, staff_id, starts_at, ends_at) on time_off to anon, authenticated;

-- The owner's calendar reads the reasons through this, guarded the way every
-- vendor read is (0005).
create function public.salon_time_off(p_salon_id uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, staff_id uuid, starts_at timestamptz, ends_at timestamptz, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  return query
  select t.id, t.staff_id, t.starts_at, t.ends_at, t.reason
  from time_off t
  where t.salon_id = p_salon_id
    and t.starts_at < p_to
    and t.ends_at > p_from
  order by t.starts_at
  limit 500;
end;
$$;

comment on function public.salon_time_off(uuid, timestamptz, timestamptz) is
  'An owner''s own blocked periods, reasons included. The reason is in no SELECT grant.';

revoke all on function public.salon_time_off(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.salon_time_off(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.salon_time_off(uuid, timestamptz, timestamptz) to authenticated;
