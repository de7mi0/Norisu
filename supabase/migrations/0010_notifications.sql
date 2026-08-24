-- Saloni — somebody is finally told
--
-- 0009 made the waitlist real: a queue, 15-minute holds, a lapsed hold passing
-- to the next person, and claiming that books a real priced appointment. It
-- said plainly what was still missing, and this is that:
--
--   "There is no push, no SMS and no WhatsApp yet, so an offer reaches a
--    customer only when they next open the app. The queue, the holds and the
--    claim are all genuine; the tap on the shoulder is what is missing."
--
-- The notifications table has existed since 0001 — profile, channel, template,
-- payload, sent_at / delivered_at / failed_at — with a policy letting an account
-- read its own. Nothing has ever written a row to it. It is an outbox that has
-- never had anything put in it.
--
-- What changes here: every waitlist offer now queues a message. What does NOT
-- change: nothing sends one. Draining the outbox needs a worker holding a
-- WhatsApp provider's credentials, and an approved Meta template, neither of
-- which exists yet — docs/whatsapp-waitlist-template.md is the submission that
-- starts that clock. So after this migration the queue fills and stays full,
-- which is the honest half-step: when the sender arrives there is a backlog of
-- real messages for it to send, and the app's behaviour is unchanged until then.
--
-- Two decisions worth reading before changing anything here.
--
-- Only channels that could actually arrive are queued. WhatsApp needs
-- profiles.phone and profiles.allow_whatsapp; push needs a registered device,
-- and there is no device-token table because there is no native app yet. So
-- push is not queued at all rather than queued undeliverably. An outbox full of
-- rows nothing can ever send is worse than an empty one — it looks like
-- progress and hides the real gap.
--
-- And quiet hours ship switched off. The mechanism is built and tested both
-- ways, but a quiet window with no sender behind it would only stretch holds
-- overnight while nobody's phone buzzed, which costs the queue its turn-taking
-- and buys nothing. §6 below is the one line to change when sending starts.

-- ---------------------------------------------------------------------------
-- 1. What a queued message needs to carry
-- ---------------------------------------------------------------------------

alter table notifications
  -- Which offer this is about, so a re-offer cannot queue a second message for
  -- the same seat, and so the sender can check the hold has not already lapsed.
  add column offer_id uuid references waitlist_offers (id) on delete cascade,
  -- Which language to send in. profiles.locale at the moment of the offer, not
  -- at the moment of sending: the message is about a decision the customer made
  -- in a particular language, and a later change should not retranslate a
  -- message already queued.
  add column locale text not null default 'en' check (locale in ('en', 'ar')),
  -- The earliest this may go out. now() unless quiet hours push it later.
  add column send_after timestamptz not null default now(),
  -- Send attempts, so a permanently bad number stops being retried forever.
  add column attempts integer not null default 0;

comment on column notifications.offer_id is
  'The waitlist offer this message is about. Null for any future notification '
  'that is not about an offer.';

-- One message per offer per channel. This is the guard that makes the whole
-- thing safe to call from more than one place: offer_next_for_slot() is reached
-- from a cancellation trigger, from a lazy sweep and from the salon''s "Notify"
-- button, and none of them should be able to double-message anybody.
create unique index notifications_offer_channel_idx
  on notifications (offer_id, channel)
  where offer_id is not null;

-- What the sender scans: unsent, unfailed, due.
create index notifications_pending_idx
  on notifications (send_after)
  where sent_at is null and failed_at is null;

-- ---------------------------------------------------------------------------
-- 2. The outbox is not something a browser gets to write
-- ---------------------------------------------------------------------------

-- The same column-blind grant 0006, 0008 and 0009 each had to close. Here an
-- account that can write this table could queue a message to somebody else, or
-- mark its own as sent, or — worse — rewrite the payload of a queued message so
-- the salon's name is right and the link points somewhere else. Nothing about
-- this table should ever be reachable from the browser except reading your own.
revoke insert, update, delete on notifications from authenticated;
revoke insert, update, delete on notifications from anon;

-- notifications_select_own (0002) stays: an account reads its own messages,
-- which is what would let the app show a notification centre later.

-- ---------------------------------------------------------------------------
-- 3. Settings, in one row, so none of this is hardcoded in a function body
-- ---------------------------------------------------------------------------

create table notification_settings (
  -- One row, forever: the primary key can only hold true.
  id             boolean primary key default true check (id),
  -- Null disables quiet hours. Stored as local Asia/Riyadh clock time, the
  -- same timezone waitlist_matches() already reasons in.
  quiet_from     time,
  quiet_to       time,
  -- How many separate offers one person may be pinged about in a rolling hour.
  -- Counted per offer, not per message, so adding push later does not halve it.
  rate_per_hour  integer not null default 4 check (rate_per_hour > 0),
  -- Where the claim link points. Here rather than in a function body so moving
  -- the app to its own domain is one update, not a migration.
  app_base_url   text not null default 'https://de7mi0.github.io/Norisu/',
  updated_at     timestamptz not null default now()
);

-- Quiet hours off by default — see the header. To turn them on once messages
-- are really being sent:
--
--   update notification_settings set quiet_from = '22:00', quiet_to = '08:00';
--
insert into notification_settings (id) values (true);

alter table notification_settings enable row level security;

-- No policy, deliberately. Every reader below is security definer, and
-- service_role bypasses RLS, so nobody else reaches it at all.
revoke all on notification_settings from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Quiet hours
-- ---------------------------------------------------------------------------

-- Null when p_at is not inside the quiet window; otherwise the instant the
-- window ends. Handles a window that wraps midnight, which the useful ones do.
create function public.notification_quiet_until(p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s        notification_settings%rowtype;
  local_ts timestamp;
  local_t  time;
  local_d  date;
  is_quiet boolean;
  ends     timestamp;
begin
  select * into s from notification_settings where id;

  if s.quiet_from is null or s.quiet_to is null or s.quiet_from = s.quiet_to then
    return null;
  end if;

  local_ts := p_at at time zone 'Asia/Riyadh';
  local_t  := local_ts::time;
  local_d  := local_ts::date;

  if s.quiet_from < s.quiet_to then
    -- An ordinary window inside one day, e.g. 01:00 -> 06:00.
    is_quiet := local_t >= s.quiet_from and local_t < s.quiet_to;
    ends     := local_d + s.quiet_to;
  else
    -- Wraps midnight, e.g. 22:00 -> 08:00.
    is_quiet := local_t >= s.quiet_from or local_t < s.quiet_to;
    if local_t >= s.quiet_from then
      ends := (local_d + 1) + s.quiet_to;
    else
      ends := local_d + s.quiet_to;
    end if;
  end if;

  if not is_quiet then
    return null;
  end if;

  return ends at time zone 'Asia/Riyadh';
end;
$$;

revoke all on function public.notification_quiet_until(timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 5. Queueing the message for one offer
-- ---------------------------------------------------------------------------

-- Called by offer_next_for_slot() and by nothing else. Silent rather than
-- raising when there is nothing to send: an offer that cannot be messaged is
-- still a perfectly good offer, and the customer will see it in the app.
create function public.enqueue_offer_notification(p_offer_id uuid)
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
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is null then
    return 0;
  end if;

  -- Never message about a seat that has already come and gone. A notification
  -- about a slot in the past is worse than none: it is the thing that teaches
  -- people to stop opening them.
  if o.starts_at <= now() then
    return 0;
  end if;

  select * into e from waitlist_entries where id = o.entry_id;
  select * into p from profiles where id = e.customer_id;
  select * into s from notification_settings where id;

  select sa.name_en, sa.name_ar into v_salon_en, v_salon_ar
  from salons sa where sa.id = e.salon_id;

  -- The basket they were waiting with, in both languages, so the sender does
  -- not have to join anything to fill the template in.
  select string_agg(sv.name_en, ' + ' order by sv.name_en),
         string_agg(sv.name_ar, ' + ' order by sv.name_en)
    into v_svc_en, v_svc_ar
  from services sv
  where sv.id = any (e.service_ids);

  -- The payload carries no phone number and no e-mail. The sender is
  -- service_role and can read the profile itself; copying contact details into
  -- a row the account can read back would put them somewhere they need not be.
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

  -- WhatsApp: needs somewhere to send it and permission to send it.
  if p.allow_whatsapp and coalesce(p.phone, '') <> '' then
    insert into notifications (profile_id, channel, template, payload, locale,
                               offer_id, send_after)
    values (p.id, 'whatsapp', 'waitlist_seat_offer', v_payload, p.locale,
            o.id, coalesce(notification_quiet_until(now()), now()))
    on conflict (offer_id, channel) where offer_id is not null do nothing;
    get diagnostics v_n = row_count;
    v_queued := v_queued + v_n;
  end if;

  -- Push is deliberately not queued. There is no device-token table because
  -- there is no native app yet; a push row today could never be delivered, and
  -- an outbox that fills with undeliverable rows hides exactly the gap it
  -- should be showing. It arrives with the Capacitor wrap.

  return v_queued;
end;
$$;

revoke all on function public.enqueue_offer_notification(uuid) from public;

-- ---------------------------------------------------------------------------
-- 6. The offer itself, now that making one also tells somebody
-- ---------------------------------------------------------------------------

-- Unchanged from 0009 except at the end, plus two considerations that only make
-- sense once a message is actually going out:
--
--   * Somebody already pinged about several other seats this hour is skipped
--     and keeps their place in the queue. No offer row is written for them, so
--     they have not "had their turn" — they are simply not pestered. This is
--     the cap the backlog asks for, and it is counted per offer rather than per
--     message so that adding push later does not silently halve it.
--
--   * If quiet hours are on and it is the middle of the night, the hold is
--     stretched to cover the silence instead of the offer being suppressed.
--     Suppressing it would be unfair in a way that is easy to miss: the offer
--     row would still exist, the hold would lapse unseen, and "never the same
--     slot twice to the same person" would mean they could never be offered
--     that seat again. Stretching the hold costs nothing — an offer does not
--     lock the slot against an ordinary booking — and the customer wakes up
--     with the seat still theirs and a full hold to decide in.
create or replace function public.offer_next_for_slot(
  p_salon_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_released_booking_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry   uuid;
  v_offer   uuid;
  v_quiet   timestamptz;
  v_expires timestamptz;
  v_cap     integer;
begin
  -- Somebody already holds it.
  if exists (
    select 1 from waitlist_offers o
    join waitlist_entries e on e.id = o.entry_id
    where e.salon_id = p_salon_id and o.starts_at = p_starts_at
      and o.claimed_at is null and o.expires_at > now()
  ) then
    return null;
  end if;

  -- Or somebody already took it, through the waitlist or the ordinary route.
  if not exists (
    select 1 from free_staff_for(p_salon_id, '{}'::uuid[], p_starts_at, p_ends_at)
  ) then
    return null;
  end if;

  select rate_per_hour into v_cap from notification_settings where id;

  select m.entry_id into v_entry
  from waitlist_matches(p_salon_id, p_starts_at) m
  join waitlist_entries e on e.id = m.entry_id
  where e.status = 'waiting'
    -- Never the same slot twice to the same person.
    and not exists (
      select 1 from waitlist_offers o
      where o.entry_id = m.entry_id and o.starts_at = p_starts_at
    )
    -- Not somebody who has already been pinged enough this hour.
    and (
      select count(distinct n.offer_id)
      from notifications n
      where n.profile_id = e.customer_id
        and n.offer_id is not null
        and n.created_at > now() - interval '1 hour'
    ) < v_cap
  limit 1;

  if v_entry is null then
    return null;
  end if;

  v_quiet   := notification_quiet_until(now());
  v_expires := now() + make_interval(mins => waitlist_hold_minutes());

  if v_quiet is not null then
    -- Hold it until the quiet window ends, then the ordinary hold on top.
    v_expires := greatest(v_expires,
                          v_quiet + make_interval(mins => waitlist_hold_minutes()));
    -- But never past the appointment it is an offer for.
    if p_starts_at > now() then
      v_expires := least(v_expires, p_starts_at);
    end if;
  end if;

  insert into waitlist_offers (entry_id, released_booking_id, starts_at, ends_at, expires_at)
  values (v_entry, p_released_booking_id, p_starts_at, p_ends_at, v_expires)
  returning id into v_offer;

  update waitlist_entries set status = 'offered' where id = v_entry;

  perform enqueue_offer_notification(v_offer);

  return v_entry;
end;
$$;

revoke all on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. Draining the outbox — for the sender, and nobody else
-- ---------------------------------------------------------------------------

-- The three functions a worker needs. All granted to service_role only: this is
-- the one part of Saloni that legitimately runs with the secret key, because it
-- reads other people's phone numbers to message them. Granting any of it to
-- authenticated would hand every account a list of who is waiting for what and
-- how to reach them.

-- Claims up to p_limit due messages, counting an attempt against each so a
-- crashed worker cannot spin on the same row forever.
create function public.claim_pending_notifications(p_limit integer default 20)
returns table (
  id         uuid,
  channel    notify_channel,
  template   text,
  locale     text,
  payload    jsonb,
  attempts   integer,
  to_phone   text,
  to_name    text
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
      -- Never send about a hold that has already lapsed or been taken. Between
      -- queueing and sending, the seat may well have gone.
      and (n.offer_id is null
           or (o.claimed_at is null and o.expires_at > now() and o.starts_at > now()))
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update of n skip locked
  )
  update notifications n
     set attempts = n.attempts + 1
    from due, profiles p
   where n.id = due.id and p.id = n.profile_id
  returning n.id, n.channel, n.template, n.locale, n.payload, n.attempts,
            p.phone, nullif(p.full_name, '');
end;
$$;

revoke all on function public.claim_pending_notifications(integer) from public;
grant execute on function public.claim_pending_notifications(integer) to service_role;

create function public.mark_notification_sent(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update notifications set sent_at = now() where id = p_id and sent_at is null;
$$;

revoke all on function public.mark_notification_sent(uuid) from public;
grant execute on function public.mark_notification_sent(uuid) to service_role;

-- A failure is recorded rather than thrown away, and after five attempts
-- claim_pending_notifications() stops picking the row up at all.
create function public.mark_notification_failed(p_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update notifications
     set failed_at = case when attempts >= 5 then now() else null end,
         error     = left(coalesce(p_error, ''), 500),
         send_after = now() + interval '5 minutes'
   where id = p_id and sent_at is null;
$$;

revoke all on function public.mark_notification_failed(uuid, text) from public;
grant execute on function public.mark_notification_failed(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. "revoke from public" has never actually revoked anything
-- ---------------------------------------------------------------------------

-- Found while locking down the three functions above, and it is not confined to
-- them. Supabase ships this, and tests/00_local_shim.sql mirrors it:
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- So every function is granted to the API roles the moment it is created, by
-- name. "revoke all on function f from public" removes PUBLIC's grant and
-- leaves the named ones untouched — which means every `revoke ... from public`
-- written since 0003 has been decorative. Verified rather than assumed: before
-- this section, has_function_privilege('anon', ..., 'EXECUTE') was true for all
-- thirty security definer functions, including ones no browser should reach.
--
-- Most were harmless because the guard is inside the body — salon_day() checks
-- is_salon_owner() and does not care who may call it. Two were not:
--
--   waitlist_matches()   — no guard at all. Any visitor, signed in or not,
--                          could list the customer ids waiting at any salon.
--   offer_next_for_slot() — no guard at all. Any account could force offers,
--                          spending other people's one turn at a slot.
--
-- And claim_pending_notifications(), added above, would have been the worst of
-- them: it returns the phone number and name of everybody with a message
-- queued. That is what turned this from a tidy-up into part of the migration.
--
-- The rule this establishes, for anything added later: a function is reachable
-- from the browser unless you say otherwise, and saying otherwise means naming
-- anon and authenticated. Assertion 84 fails if a new one forgets.

revoke execute on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid)
  from anon, authenticated;
revoke execute on function public.salon_is_open_for(uuid, uuid, timestamptz, timestamptz)
  from anon, authenticated;
revoke execute on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid)
  from anon, authenticated;
revoke execute on function public.sweep_waitlist(uuid)
  from anon, authenticated;
revoke execute on function public.waitlist_matches(uuid, timestamptz)
  from anon, authenticated;

revoke execute on function public.notification_quiet_until(timestamptz)
  from anon, authenticated;
revoke execute on function public.enqueue_offer_notification(uuid)
  from anon, authenticated;
revoke execute on function public.claim_pending_notifications(integer)
  from anon, authenticated;
revoke execute on function public.mark_notification_sent(uuid)
  from anon, authenticated;
revoke execute on function public.mark_notification_failed(uuid, text)
  from anon, authenticated;

-- Every one of these is still called from inside a security definer function,
-- which executes as its owner rather than as the caller — so the app's own
-- paths are untouched. available_slots(), create_booking(), my_waitlist() and
-- the rest reach them exactly as before.
--
-- Deliberately NOT revoked:
--   is_admin(), is_salon_owner(), salon_is_public() — row policies call these,
--     and a policy is evaluated as the querying role. Revoking them would make
--     every ordinary select fail.
--   the trigger functions — a trigger fires without an execute check, and
--     calling one directly does nothing useful anyway.
