-- Saloni — two the second audit missed, found by attacking the parts it skipped
--
-- The 0015 audit went at the tables and their policies. It did not go at the
-- functions that move things around afterwards, and one of them walks straight
-- around a rule 0015 had just written. Both of these were demonstrated before
-- being fixed, and both have assertions that fail without them.
--
--   1. A cap on INSERT is not a cap.   0015 stopped an account booking more
--      than three of a salon's slots on one day — at the moment of booking.
--      reschedule_booking() then moves a booking to any day it likes, and
--      nothing counted again. Book three on Monday, three on other days, move
--      them all to Monday: six. The rule read as enforced and was not.
--   2. Knowing a push endpoint was enough to take it.  register_push_device()
--      upserts on the endpoint and sets profile_id to the caller. That is
--      deliberate — a browser shared by two people has one endpoint and it has
--      to follow whoever signed in last — but it asked for nothing but the URL,
--      so anybody holding one could point it at themselves. 0011's own comment
--      names this as the risk it was closing, and it did not close it.

-- ---------------------------------------------------------------------------
-- 1. The cap counts on the way in AND on the way across
-- ---------------------------------------------------------------------------

-- The trigger function itself needs no change: it already excludes the row
-- being written and counts the day the row is landing on. It was only ever
-- asked on INSERT.
--
-- The early return covers the cases this must not touch: a cancellation, a
-- completion, a no-show and a walk-in all leave without counting, so an owner
-- running their day never meets this.
drop trigger if exists bookings_cap_per_customer on bookings;

create trigger bookings_cap_per_customer
  before insert or update on bookings
  for each row
  execute function public.enforce_booking_cap();

comment on function public.enforce_booking_cap() is
  'Caps how much of a salon''s day one account can hold: three at a salon on one day, twelve '
  'upcoming in total. Fires on INSERT and UPDATE, because rescheduling moves a booking to '
  'another day and a cap that is only counted at the moment of booking is not a cap.';

-- ---------------------------------------------------------------------------
-- 2. A device is taken over by the device, not by whoever knows its address
-- ---------------------------------------------------------------------------

-- The takeover has to stay possible. One browser has one endpoint, so a phone
-- two people share hands the subscription to whoever signed in last, and
-- refusing that would leave the first person's account receiving the second
-- person's seat offers — which is worse than what this fixes.
--
-- What changes is what it costs. A real browser re-registering presents the
-- same endpoint AND the same keys: they belong to one subscription and are
-- generated together, so a different subscription would have a different
-- endpoint too. An attacker who has only overheard a URL has neither key.
--
-- So: your own row, you may rewrite freely. Somebody else's, only by proving
-- you hold the device the row is about.
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

  select profile_id, p256dh, auth
    into v_owner, v_p256dh, v_auth
  from push_subscriptions
  where endpoint = p_endpoint;

  -- Somebody else's row. The keys are the proof, and they are checked before
  -- anything is written.
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

  return v_id;
end;
$$;

comment on function public.register_push_device(text, text, text, push_platform, text) is
  'Registers the calling account''s device, or moves an existing one to them — a browser two '
  'people share has one endpoint and must follow whoever signed in last. Moving somebody '
  'else''s requires the subscription''s keys, which only that browser holds: an endpoint URL on '
  'its own is an address, not a proof.';

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Noted, not changed
-- ---------------------------------------------------------------------------
--
-- reassign_appointment() will happily give a chair to a *cancelled* booking.
-- Nothing follows from it — the exclusion constraint ignores cancelled rows, so
-- it blocks nobody, and the appointment sheet offers no such button — but it is
-- untidy, and it is written down here rather than fixed so that finding it
-- again does not cost another afternoon.
