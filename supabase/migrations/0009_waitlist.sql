-- Saloni — the waitlist stops being theatre
--
-- waitlist_entries and waitlist_offers have existed since 0001, with policies, a
-- first-come queue index and a one-entry-per-day constraint, and nothing has
-- ever written a row to either. Joining dispatched a reducer action, a 3.2
-- second timer pretended a seat had opened, and the salon's "Notify" button
-- showed a toast on the owner's own screen.
--
-- How it works now:
--
--   A booking is cancelled -> the freed slot is offered to the person who has
--   been waiting longest -> they hold it for 15 minutes -> if they do not claim
--   it, it passes to the next -> once everybody has had a turn it opens to all
--   of them, first to claim wins.
--
-- Two things about that are worth being straight about.
--
-- There is no push, no SMS and no WhatsApp yet, so an offer reaches a customer
-- only when they next open the app. The queue, the holds and the claim are all
-- genuine; the tap on the shoulder is what is missing, and until it exists most
-- 15-minute holds will lapse unseen. Nothing here changes when notifications
-- land except that people find out in time.
--
-- And nothing can advance on a timer, for the same reason — there is no job
-- runner. Expiry is therefore swept lazily: both read functions sweep before
-- they return, so the queue moves whenever anybody looks at it.

-- ---------------------------------------------------------------------------
-- A waitlist entry is for a basket, not a single service
-- ---------------------------------------------------------------------------

-- service_id has been singular since 0001, but a customer waits with the whole
-- cart they were about to book — and claiming has to reproduce it, priced. The
-- array is what claiming books; service_id keeps the first of them so the
-- foreign key and anything reporting on it still mean something.
alter table waitlist_entries
  add column service_ids uuid[] not null default '{}';

comment on column waitlist_entries.service_ids is
  'Everything the customer was about to book. claim_waitlist_offer() passes these to '
  'create_booking(), so the claimed appointment is the one they actually wanted.';

-- ---------------------------------------------------------------------------
-- Joining is not something a browser gets to do directly
-- ---------------------------------------------------------------------------

-- The same hole 0006 and 0008 closed, and here it is not cosmetic: created_at
-- decides queue position, so an account that can insert its own row can insert
-- itself at the front of the queue. status is writable too, so it could mark
-- itself 'offered' and hold a seat nobody gave it.
revoke insert, update on waitlist_entries from authenticated;

-- waitlist_insert_own and waitlist_update stay as the record of who a row
-- belongs to. The grant means they are no longer reached.

-- How long one person holds a freed seat before it passes on.
create function public.waitlist_hold_minutes()
returns integer
language sql
immutable
as $$ select 15 $$;

-- ---------------------------------------------------------------------------
-- Joining and leaving
-- ---------------------------------------------------------------------------

--   SL010  this salon does not take a waitlist
--   SL011  already waiting for that salon on that day
create function public.join_waitlist(
  p_salon_id       uuid,
  p_service_ids    uuid[],
  p_requested_date date,
  p_earliest_time  time default null,
  p_latest_time    time default null
)
returns table (entry_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer uuid := auth.uid();
  v_wanted   uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_entry    uuid;
begin
  if v_customer is null then
    raise exception 'sign in to join the waitlist' using errcode = '42501';
  end if;

  if not exists (
    select 1 from salons s
    where s.id = p_salon_id and s.is_published and s.waitlist_enabled
  ) then
    raise exception 'this salon is not taking a waitlist' using errcode = 'SL010';
  end if;

  -- Same check create_booking() makes, for the same reason: the services have
  -- to be this salon's and still on its menu, or the claim could not be priced.
  if (select count(*) from services s
      where s.id = any (v_wanted) and s.salon_id = p_salon_id
        and s.is_active and not s.is_archived)
     <> (select count(distinct u.id) from unnest(v_wanted) as u(id))
     or coalesce(array_length(v_wanted, 1), 0) = 0
  then
    raise exception 'one of those services cannot be booked at this salon'
      using errcode = 'SL001';
  end if;

  begin
    insert into waitlist_entries (
      customer_id, salon_id, service_id, service_ids,
      requested_date, earliest_time, latest_time
    ) values (
      v_customer, p_salon_id, v_wanted[1], v_wanted,
      p_requested_date, p_earliest_time, p_latest_time
    )
    returning id into v_entry;
  exception
    -- waitlist_one_active_per_day_idx: one live request per salon per day.
    when unique_violation then
      raise exception 'already on the waitlist for that day' using errcode = 'SL011';
  end;

  return query select v_entry;
end;
$$;

revoke all on function public.join_waitlist(uuid, uuid[], date, time, time) from public;
grant execute on function public.join_waitlist(uuid, uuid[], date, time, time) to authenticated;

create function public.leave_waitlist(p_entry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- Somebody else's entry and one that does not exist are refused identically.
  if not exists (
    select 1 from waitlist_entries
    where id = p_entry_id and customer_id = auth.uid()
  ) then
    raise exception 'not your waitlist entry' using errcode = '42501';
  end if;

  update waitlist_entries set status = 'cancelled' where id = p_entry_id;
end;
$$;

revoke all on function public.leave_waitlist(uuid) from public;
grant execute on function public.leave_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is waiting for a particular freed slot
-- ---------------------------------------------------------------------------

-- Matching is on **time**, not on service. A freed slot is an hour of somebody's
-- day; a customer waiting for a haircut can perfectly well take an hour freed by
-- a colour, and refusing that would leave seats empty for no reason. What the
-- entry's own services decide is the length and the price of what gets booked,
-- and create_booking() settles both at claim time.
--
-- Order is created_at — first come, first served, which is exactly the
-- waitlist_queue_idx that has been sitting in 0001 unused.
create function public.waitlist_matches(
  p_salon_id  uuid,
  p_starts_at timestamptz
)
returns table (entry_id uuid, customer_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.customer_id, e.created_at
  from waitlist_entries e
  cross join lateral (
    select (p_starts_at at time zone 'Asia/Riyadh')::date as day,
           (p_starts_at at time zone 'Asia/Riyadh')::time as at
  ) w
  where e.salon_id = p_salon_id
    and e.requested_date = w.day
    and e.status in ('waiting', 'offered')
    and (e.earliest_time is null or w.at >= e.earliest_time)
    and (e.latest_time  is null or w.at <= e.latest_time)
  order by e.created_at, e.id;
$$;

revoke all on function public.waitlist_matches(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- Offering a freed slot, and passing it on when a hold lapses
-- ---------------------------------------------------------------------------

-- Offers the slot to the longest-waiting person who has not already had a turn
-- at it. Silent when there is nobody left to ask, or when the time has since
-- been taken by an ordinary booking — a waitlist that offers seats that are
-- gone is worse than one that says nothing.
create function public.offer_next_for_slot(
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
  v_entry uuid;
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

  select m.entry_id into v_entry
  from waitlist_matches(p_salon_id, p_starts_at) m
  join waitlist_entries e on e.id = m.entry_id
  where e.status = 'waiting'
    -- Never the same slot twice to the same person.
    and not exists (
      select 1 from waitlist_offers o
      where o.entry_id = m.entry_id and o.starts_at = p_starts_at
    )
  limit 1;

  if v_entry is null then
    return null;
  end if;

  insert into waitlist_offers (entry_id, released_booking_id, starts_at, ends_at, expires_at)
  values (v_entry, p_released_booking_id, p_starts_at, p_ends_at,
          now() + make_interval(mins => waitlist_hold_minutes()));

  update waitlist_entries set status = 'offered' where id = v_entry;
  return v_entry;
end;
$$;

revoke all on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid) from public;

-- Nothing runs on a schedule here, so lapsed holds are cleared whenever anybody
-- reads the waitlist. Both read functions call this first, which is why they are
-- volatile rather than stable.
create function public.sweep_waitlist(p_salon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  slot record;
begin
  -- A hold that ran out puts its owner back in the queue. The entry keeps its
  -- created_at, so it keeps its place; it simply will not be offered this
  -- particular slot again.
  update waitlist_entries e
     set status = 'waiting'
   where e.salon_id = p_salon_id
     and e.status = 'offered'
     and not exists (
       select 1 from waitlist_offers o
       where o.entry_id = e.id and o.claimed_at is null and o.expires_at > now()
     );

  -- Then pass each lapsed slot to whoever is next.
  for slot in
    select distinct o.starts_at, o.ends_at, o.released_booking_id
    from waitlist_offers o
    join waitlist_entries e on e.id = o.entry_id
    where e.salon_id = p_salon_id
      and o.claimed_at is null
      and o.expires_at <= now()
      and o.starts_at > now()
  loop
    perform offer_next_for_slot(p_salon_id, slot.starts_at, slot.ends_at,
                                slot.released_booking_id);
  end loop;
end;
$$;

revoke all on function public.sweep_waitlist(uuid) from public;

-- ---------------------------------------------------------------------------
-- The trigger: a cancellation is what frees a seat
-- ---------------------------------------------------------------------------

-- Both sides already cancel — the customer from "My bookings", the salon from
-- the appointment sheet — and neither needs to know the waitlist exists.
create function public.offer_cancelled_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.starts_at > now() then
    perform offer_next_for_slot(new.salon_id, new.starts_at, new.ends_at, new.id);
  end if;
  return null;
end;
$$;

create trigger bookings_offer_cancelled_slot
  after update on bookings
  for each row
  execute function public.offer_cancelled_slot();

-- ---------------------------------------------------------------------------
-- Reading the waitlist
-- ---------------------------------------------------------------------------

-- The caller's own entries, with whatever is being held for them. `claimable`
-- is the whole rule in one boolean, computed rather than stored:
--
--   * they hold an unexpired offer, or
--   * everybody matching has had a turn and nobody claimed it, so the slot is
--     open to all of them and the fastest wins.
--
-- Deriving the second case beats recording it — there is no second copy of the
-- truth to fall out of step with the offers themselves.
create function public.my_waitlist()
returns table (
  entry_id      uuid,
  salon_id      uuid,
  salon_name_en text,
  salon_name_ar text,
  requested_date date,
  earliest_time time,
  latest_time   time,
  status        waitlist_status,
  offer_id      uuid,
  offer_starts_at timestamptz,
  offer_expires_at timestamptz,
  claimable     boolean,
  service_names_en text[],
  service_names_ar text[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer uuid := auth.uid();
  s uuid;
begin
  if v_customer is null then
    raise exception 'sign in to see your waitlist' using errcode = '42501';
  end if;

  for s in select distinct e.salon_id from waitlist_entries e
           where e.customer_id = v_customer and e.status in ('waiting', 'offered')
  loop
    perform sweep_waitlist(s);
  end loop;

  return query
  select
    e.id, e.salon_id, sa.name_en, sa.name_ar,
    e.requested_date, e.earliest_time, e.latest_time, e.status,
    o.id, o.starts_at, o.expires_at,
    (
      o.id is not null
      and o.claimed_at is null
      and o.starts_at > now()
      and (
        o.expires_at > now()
        -- Everybody has had their turn: the slot is open to all of them.
        or not exists (
          select 1 from waitlist_matches(e.salon_id, o.starts_at) m
          where not exists (
            select 1 from waitlist_offers x
            where x.entry_id = m.entry_id and x.starts_at = o.starts_at
          )
        )
      )
    ),
    coalesce(names.en, '{}'), coalesce(names.ar, '{}')
  from waitlist_entries e
  join salons sa on sa.id = e.salon_id
  left join lateral (
    select * from waitlist_offers w
    where w.entry_id = e.id and w.claimed_at is null
    order by w.offered_at desc limit 1
  ) o on true
  cross join lateral (
    select array_agg(sv.name_en order by sv.sort_order) as en,
           array_agg(sv.name_ar order by sv.sort_order) as ar
    from services sv where sv.id = any (e.service_ids)
  ) names
  where e.customer_id = v_customer
    and e.status in ('waiting', 'offered')
  order by e.requested_date, e.created_at;
end;
$$;

revoke all on function public.my_waitlist() from public;
grant execute on function public.my_waitlist() to authenticated;

-- The salon's own queue. Same narrowness as salon_day(): the customer's display
-- name and nothing else about them.
create function public.salon_waitlist(p_salon_id uuid)
returns table (
  entry_id      uuid,
  customer_name text,
  requested_date date,
  earliest_time time,
  latest_time   time,
  status        waitlist_status,
  waiting_since timestamptz,
  offer_id      uuid,
  offer_starts_at timestamptz,
  offer_expires_at timestamptz,
  can_extend    boolean,
  service_names_en text[],
  service_names_ar text[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  perform sweep_waitlist(p_salon_id);

  return query
  select
    e.id, nullif(p.full_name, ''),
    e.requested_date, e.earliest_time, e.latest_time, e.status, e.created_at,
    o.id, o.starts_at, o.expires_at,
    (
      o.id is not null
      and o.claimed_at is null
      and o.expires_at > now()
      -- Extending is offered only when nobody is queued behind them. With a
      -- queue, holding the seat longer just makes everyone else wait for
      -- nothing, so it passes on instead.
      and not exists (
        select 1 from waitlist_matches(p_salon_id, o.starts_at) m
        where m.entry_id <> e.id
          and not exists (
            select 1 from waitlist_offers x
            where x.entry_id = m.entry_id and x.starts_at = o.starts_at
          )
      )
    ),
    coalesce(names.en, '{}'), coalesce(names.ar, '{}')
  from waitlist_entries e
  join profiles p on p.id = e.customer_id
  left join lateral (
    select * from waitlist_offers w
    where w.entry_id = e.id and w.claimed_at is null
    order by w.offered_at desc limit 1
  ) o on true
  cross join lateral (
    select array_agg(sv.name_en order by sv.sort_order) as en,
           array_agg(sv.name_ar order by sv.sort_order) as ar
    from services sv where sv.id = any (e.service_ids)
  ) names
  where e.salon_id = p_salon_id
    and e.status in ('waiting', 'offered')
  order by e.requested_date, e.created_at;
end;
$$;

revoke all on function public.salon_waitlist(uuid) from public;
grant execute on function public.salon_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Acting on an offer
-- ---------------------------------------------------------------------------

--   SL012  that offer is no longer yours to take
create function public.claim_waitlist_offer(p_offer_id uuid)
returns table (booking_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
  made record;
  open_to_all boolean;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is not null then
    select * into e from waitlist_entries where id = o.entry_id;
  end if;

  -- An offer that is not yours and one that does not exist are refused
  -- identically, so this cannot be used to discover other people's offers.
  if o.id is null or e.customer_id is distinct from auth.uid() then
    raise exception 'that offer is not yours' using errcode = '42501';
  end if;
  if o.claimed_at is not null or o.starts_at <= now() then
    raise exception 'that offer is no longer open' using errcode = 'SL012';
  end if;

  select not exists (
    select 1 from waitlist_matches(e.salon_id, o.starts_at) m
    where not exists (
      select 1 from waitlist_offers x
      where x.entry_id = m.entry_id and x.starts_at = o.starts_at
    )
  ) into open_to_all;

  -- Either the hold is still theirs, or everybody has had a turn and the slot
  -- is open to all of them.
  if o.expires_at <= now() and not open_to_all then
    raise exception 'someone else is holding that slot' using errcode = 'SL012';
  end if;

  -- The booking is made the ordinary way: priced from the salon's own services,
  -- given a chair, written with its items in one transaction. A slot claimed
  -- off the waitlist is not a lesser kind of appointment.
  select * into made from create_booking(
    e.salon_id, null, e.service_ids, o.starts_at, null);

  update waitlist_offers
     set claimed_at = now(), claimed_booking_id = made.booking_id
   where id = o.id;
  update waitlist_entries set status = 'claimed' where id = e.id;

  return query select made.booking_id, made.reference;
end;
$$;

revoke all on function public.claim_waitlist_offer(uuid) from public;
grant execute on function public.claim_waitlist_offer(uuid) to authenticated;

--   SL013  somebody is queued behind them, so it passes on instead
create function public.extend_waitlist_offer(
  p_offer_id uuid,
  p_minutes  integer default 15
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
  v_until timestamptz;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is not null then
    select * into e from waitlist_entries where id = o.entry_id;
  end if;
  if o.id is null or not is_salon_owner(e.salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;
  if o.claimed_at is not null then
    raise exception 'that offer has already been taken' using errcode = 'SL012';
  end if;

  -- Only when nobody is queued behind. Holding a seat longer for one person
  -- while others wait costs them their turn for nothing.
  if exists (
    select 1 from waitlist_matches(e.salon_id, o.starts_at) m
    where m.entry_id <> e.id
      and not exists (
        select 1 from waitlist_offers x
        where x.entry_id = m.entry_id and x.starts_at = o.starts_at
      )
  ) then
    raise exception 'somebody else is waiting for that slot' using errcode = 'SL013';
  end if;

  v_until := greatest(now(), o.expires_at)
             + make_interval(mins => greatest(coalesce(p_minutes, 15), 1));

  update waitlist_offers set expires_at = v_until where id = o.id;
  -- The hold is live again, so the entry goes back to holding it.
  update waitlist_entries set status = 'offered' where id = e.id;

  return v_until;
end;
$$;

revoke all on function public.extend_waitlist_offer(uuid, integer) from public;
grant execute on function public.extend_waitlist_offer(uuid, integer) to authenticated;

-- The salon's "Notify" button: offer the freed slot again, to whoever is next.
-- Useful when a hold lapsed and nobody has looked since, which without push
-- notifications is most of the time.
create function public.reoffer_waitlist_slot(p_entry_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
begin
  select * into e from waitlist_entries where id = p_entry_id;
  if e.id is null or not is_salon_owner(e.salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  select * into o from waitlist_offers
   where entry_id = e.id order by offered_at desc limit 1;
  if o.id is null then
    raise exception 'nothing has been offered to this customer yet' using errcode = 'SL012';
  end if;

  perform sweep_waitlist(e.salon_id);
  return offer_next_for_slot(e.salon_id, o.starts_at, o.ends_at, o.released_booking_id);
end;
$$;

revoke all on function public.reoffer_waitlist_slot(uuid) from public;
grant execute on function public.reoffer_waitlist_slot(uuid) to authenticated;
