-- Saloni — telling people what happened
--
-- Two silences, both named in CLAUDE.md as the next thing to build on the
-- outbox 0010 made:
--
--   * A customer who booked heard nothing — no confirmation, and no reminder
--     the day before or on the day — so the only record of an appointment was
--     a screen they had to remember to open.
--   * A salon owner whose registration was approved, published, turned down
--     or closed by Saloni learned it only by opening the app.
--
-- Both now queue messages in the same outbox, delivered by the same worker:
-- a push to every device the person registered, and an e-mail to the address
-- they sign in with. Nothing here sends anything by itself.
--
-- SWITCHED OFF UNTIL THE WORKER KNOWS THESE KINDS. The deployed worker words
-- every row as a waitlist offer, so these ship behind
-- notification_settings.notices_enabled (default false), exactly as 0025's
-- message alerts did. E-mail is a second switch: 'email' must be added to
-- notification_settings.channels, and the worker needs an e-mail provider's key
-- and a verified sending domain. supabase/README.md has the order.
--
-- What is NOT notified, deliberately: a walk-in (the person has no account
-- and the salon has their number); a customer cancelling their own booking
-- (they know); and an owner closing their own salon (they did it).

alter type notify_channel add value if not exists 'email';

alter table notifications
  add column booking_id uuid references bookings (id) on delete cascade;

-- One pending message of each kind per booking per channel. A booking moved
-- twice in a minute is one "moved" notice, and the reminders a move replaces
-- are deleted before new ones are queued.
create unique index notifications_booking_template_idx
  on notifications (booking_id, template, channel)
  where booking_id is not null and sent_at is null;

alter table notification_settings
  add column notices_enabled boolean not null default false,
  -- Hours before an appointment that a reminder goes out. Both, by request.
  add column reminder_hours integer[] not null default '{24,2}';

comment on column notification_settings.notices_enabled is
  'Booking confirmations, reminders, salon-cancelled notices and salon decisions (0028). '
  'Switch on only after deploying a send-notifications worker that understands them.';

-- ---------------------------------------------------------------------------
-- 1. Queueing one notice on every channel that could deliver it
-- ---------------------------------------------------------------------------

create function public.enqueue_notice(
  p_profile_id uuid,
  p_template   text,
  p_payload    jsonb,
  p_send_after timestamptz default now(),
  p_booking_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p profiles%rowtype;
  s notification_settings%rowtype;
  v_email text;
begin
  select * into s from notification_settings where id;
  if s.id is null or not s.notices_enabled or p_profile_id is null then
    return;
  end if;
  select * into p from profiles where id = p_profile_id;
  if p.id is null then
    return;
  end if;

  -- Push: switched on, allowed by the person, and a device to send it to.
  if 'push' = any (s.channels) and p.allow_push
     and exists (select 1 from push_subscriptions where profile_id = p.id) then
    insert into notifications (profile_id, channel, template, payload, locale, send_after, booking_id)
    values (p.id, 'push', p_template, p_payload, p.locale, p_send_after, p_booking_id)
    on conflict do nothing;
  end if;

  -- E-mail: switched on, and an address to send it to. These are about the
  -- person's own appointment or salon, so they need no marketing consent.
  select u.email into v_email from auth.users u where u.id = p.id;
  if 'email'::text = any (s.channels::text[]) and coalesce(v_email, '') <> '' then
    insert into notifications (profile_id, channel, template, payload, locale, send_after, booking_id)
    values (p.id, 'email'::text::notify_channel, p_template, p_payload, p.locale, p_send_after, p_booking_id)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.enqueue_notice(uuid, text, jsonb, timestamptz, uuid) from public;
revoke execute on function public.enqueue_notice(uuid, text, jsonb, timestamptz, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bookings: confirmed, moved, cancelled by the salon, and reminders
-- ---------------------------------------------------------------------------

-- Everything a message needs, copied in at the time — the salon's names and
-- what was booked, from the price snapshot so a renamed service does not
-- rewrite a message about an appointment already made.
create function public.booking_notice_payload(p_booking_id uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'kind',       p_kind,
    'booking_id', b.id,
    'reference',  b.reference,
    'salon',      jsonb_build_object('en', s.name_en, 'ar', s.name_ar),
    'services',   jsonb_build_object(
                    'en', coalesce((select string_agg(i.name_en, ' + ' order by i.name_en)
                                      from booking_items i where i.booking_id = b.id), ''),
                    'ar', coalesce((select string_agg(i.name_ar, ' + ' order by i.name_en)
                                      from booking_items i where i.booking_id = b.id), '')),
    'starts_at',  b.starts_at,
    'expires_at', b.starts_at,
    'url',        (select app_base_url from notification_settings where id)
  )
  from bookings b
  join salons s on s.id = b.salon_id
  where b.id = p_booking_id;
$$;

revoke all on function public.booking_notice_payload(uuid, text) from public;
revoke execute on function public.booking_notice_payload(uuid, text) from anon, authenticated;

create function public.queue_booking_reminders(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  b bookings%rowtype;
  h integer;
  v_at timestamptz;
begin
  select * into b from bookings where id = p_booking_id;
  if b.customer_id is null or b.status not in ('pending', 'confirmed') then
    return;
  end if;
  foreach h in array (select reminder_hours from notification_settings where id) loop
    v_at := b.starts_at - make_interval(hours => h);
    -- A reminder whose moment has passed is not sent late: a "tomorrow"
    -- reminder an hour before is wrong, and the shorter one covers it.
    if v_at > now() then
      perform enqueue_notice(b.customer_id, 'booking_reminder_' || h,
                             booking_notice_payload(b.id, 'booking_reminder')
                               || jsonb_build_object('hours', h),
                             v_at, b.id);
    end if;
  end loop;
end;
$$;

revoke all on function public.queue_booking_reminders(uuid) from public;
revoke execute on function public.queue_booking_reminders(uuid) from anon, authenticated;

-- At commit, not at insert: create_booking() writes the booking and then its
-- items, and the confirmation names the services.
create function public.bookings_notify_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null and new.status in ('pending', 'confirmed') then
    perform enqueue_notice(new.customer_id, 'booking_confirmed',
                           booking_notice_payload(new.id, 'booking_confirmed'), now(), new.id);
    perform queue_booking_reminders(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.bookings_notify_created() from public;
revoke execute on function public.bookings_notify_created() from anon, authenticated;

create constraint trigger bookings_notify_created
  after insert on bookings
  deferrable initially deferred
  for each row execute function public.bookings_notify_created();

create function public.bookings_notify_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is null then
    return null;
  end if;

  -- Moved: the old reminders are wrong now. Replace them, and say so.
  if new.starts_at is distinct from old.starts_at and new.status in ('pending', 'confirmed') then
    delete from notifications
     where booking_id = new.id and sent_at is null and template like 'booking_reminder_%';
    delete from notifications
     where booking_id = new.id and sent_at is null and template = 'booking_moved';
    perform enqueue_notice(new.customer_id, 'booking_moved',
                           booking_notice_payload(new.id, 'booking_moved'), now(), new.id);
    perform queue_booking_reminders(new.id);
  end if;

  -- No longer happening, or already happened: nothing left to remind about.
  if new.status not in ('pending', 'confirmed') and old.status in ('pending', 'confirmed') then
    delete from notifications
     where booking_id = new.id and sent_at is null
       and template in ('booking_confirmed', 'booking_moved')
        or (booking_id = new.id and sent_at is null and template like 'booking_reminder_%');
    -- Cancelled by the salon, not by the customer: they need to know.
    if new.status = 'cancelled' and auth.uid() is distinct from new.customer_id then
      perform enqueue_notice(new.customer_id, 'booking_cancelled',
                             booking_notice_payload(new.id, 'booking_cancelled'), now(), new.id);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.bookings_notify_changed() from public;
revoke execute on function public.bookings_notify_changed() from anon, authenticated;

create trigger bookings_notify_changed
  after update of starts_at, status on bookings
  for each row execute function public.bookings_notify_changed();

-- A push can only be queued for a device that exists, and reminders are queued
-- when the booking is made — so somebody who allows notifications after
-- booking (the confirmation screen offers it) would get none for that booking.
-- Registering a device catches their upcoming appointments up. The unique
-- index makes this safe to repeat: anything already queued is left alone.
create function public.push_device_catch_up()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b record;
begin
  for b in
    select id from bookings
     where customer_id = new.profile_id
       and status in ('pending', 'confirmed')
       and starts_at > now()
  loop
    perform queue_booking_reminders(b.id);
  end loop;
  return null;
end;
$$;

revoke all on function public.push_device_catch_up() from public;
revoke execute on function public.push_device_catch_up() from anon, authenticated;

create trigger push_device_catch_up
  after insert or update of profile_id on push_subscriptions
  for each row execute function public.push_device_catch_up();

-- ---------------------------------------------------------------------------
-- 3. Salons: what Saloni decided
-- ---------------------------------------------------------------------------

create function public.salons_notify_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind  text;
  v_owner uuid := coalesce(new.owner_id, old.owner_id);
begin
  if new.rejected_at is not null and old.rejected_at is null then
    v_kind := 'salon_rejected';
  elsif new.closed_at is not null and old.closed_at is null then
    -- An owner closing their own salon did it themselves.
    if new.closed_by is not distinct from old.owner_id then
      return null;
    end if;
    v_kind := 'salon_closed';
    v_owner := coalesce(new.closed_owner_id, old.owner_id);
  elsif new.is_published and not old.is_published then
    v_kind := 'salon_live';
  elsif new.is_verified and not old.is_verified then
    v_kind := 'salon_approved';
  else
    return null;
  end if;

  perform enqueue_notice(
    v_owner, v_kind,
    jsonb_build_object(
      'kind',   v_kind,
      'salon',  jsonb_build_object('en', new.name_en, 'ar', new.name_ar),
      'reason', coalesce(new.rejection_reason, new.closed_reason),
      'url',    (select app_base_url from notification_settings where id)
    ));
  return null;
end;
$$;

revoke all on function public.salons_notify_decision() from public;
revoke execute on function public.salons_notify_decision() from anon, authenticated;

create trigger salons_notify_decision
  after update of is_verified, is_published, rejected_at, closed_at on salons
  for each row execute function public.salons_notify_decision();

-- Whether reminders are actually being sent, so the confirmation screen only
-- offers them when that is true. A flag and nothing else.
create function public.reminders_on()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select notices_enabled and 'push' = any (channels)
                     from notification_settings where id), false);
$$;

revoke all on function public.reminders_on() from public;
revoke execute on function public.reminders_on() from anon, authenticated;
grant execute on function public.reminders_on() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the worker is handed: the address for e-mail, and nothing stale
-- ---------------------------------------------------------------------------

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
       set attempts = n.attempts + 1
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
