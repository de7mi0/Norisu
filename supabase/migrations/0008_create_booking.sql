-- Saloni — making a booking becomes one atomic, server-priced act
--
-- Three gaps have been waiting on the same fix, and they close together because
-- they are all consequences of the browser doing work the database should:
--
--   1. The client stated the price. createBooking sent subtotal, VAT and total
--      itself, so a customer could book at zero from the console. 0006 stopped
--      anyone *editing* a price; nothing stopped them *stating* one.
--
--   2. "Any professional" sat outside the no-double-booking constraint. With
--      staff_id null there is nobody for the exclusion constraint to compare
--      against, so two people racing the last chair could both be written.
--      available_slots() capacity-checks when times are *offered*, which
--      narrows that window without closing it. Open since 0001.
--
--   3. The booking and its items were two round trips with a compensating
--      delete between them, and the compensation could itself fail.
--
-- One function call is one transaction. It prices the booking from the salon's
-- own services, assigns a chair before inserting, and writes both rows or
-- neither.

-- ---------------------------------------------------------------------------
-- Remembering what the customer actually asked for
-- ---------------------------------------------------------------------------

-- Assigning a chair destroys information unless this is recorded: afterwards an
-- "any professional" booking and a "Layla, please" booking look identical, and
-- rescheduling cannot tell whether moving someone to a different chair is
-- helpful or a betrayal. Not writable by authenticated — it is a record of what
-- was asked for at the time, not a field.
alter table bookings
  add column staff_requested boolean not null default false;

comment on column bookings.staff_requested is
  'True when the customer named a specialist rather than taking anyone. reschedule_booking() '
  'keeps that person; an unrequested booking is re-assigned to whoever is free. Set by '
  'create_booking() and not writable afterwards — see 0006 and 0008.';

-- ---------------------------------------------------------------------------
-- Creating a booking stops being something the browser can do
-- ---------------------------------------------------------------------------

-- This is the half that actually closes gap 1. Revoking UPDATE (0006) stopped
-- a price being edited; only revoking INSERT stops one being stated. From here
-- the single way a booking comes into existence is create_booking(), which
-- reads the price out of the services table.
--
-- bookings_insert_own stays in place. The grant means it is never reached now,
-- but it still documents that a booking belongs to the person who made it, and
-- it would matter again if the grant were ever restored.
revoke insert on bookings from authenticated;
revoke insert on booking_items from authenticated;

-- ---------------------------------------------------------------------------
-- Shared assignment logic
-- ---------------------------------------------------------------------------

-- Who could take this appointment, and is free for it.
--
-- Eligibility mirrors available_slots() (0003) deliberately and exactly: a
-- service with no staff_services rows is performable by anyone, and one with
-- them is performable only by the named staff. If these two ever disagree the
-- app offers times it then refuses, which is worse than offering none.
create function public.free_staff_for(
  p_salon_id   uuid,
  p_service_ids uuid[],
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_exclude_booking_id uuid default null
)
returns table (staff_id uuid, sort_order integer, load integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    st.id,
    st.sort_order,
    -- How much that person already has on, in the salon's own day. The caller
    -- orders by this so an unnamed booking spreads across the team instead of
    -- always landing on whoever happens to sort first.
    (
      select count(*)::integer
      from bookings b
      where b.staff_id = st.id
        and b.status in ('pending', 'confirmed', 'in_progress')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and (b.starts_at at time zone 'Asia/Riyadh')::date
            = (p_starts_at at time zone 'Asia/Riyadh')::date
    )
  from staff st
  where st.salon_id = p_salon_id
    and st.is_active
    and not st.is_archived
    -- Qualified for every service asked for.
    and not exists (
      select 1
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) as wanted(service_id)
      where exists (select 1 from staff_services ss where ss.service_id = wanted.service_id)
        and not exists (
          select 1 from staff_services ss2
          where ss2.service_id = wanted.service_id and ss2.staff_id = st.id
        )
    )
    -- Not already in a chair for any of it.
    and not exists (
      select 1 from bookings b
      where b.staff_id = st.id
        and b.status in ('pending', 'confirmed', 'in_progress')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and b.starts_at < p_ends_at
        and b.ends_at   > p_starts_at
    )
    -- Not on leave, and the salon is not closed for the day.
    and not exists (
      select 1 from time_off t
      where (t.staff_id = st.id or (t.staff_id is null and t.salon_id = p_salon_id))
        and t.starts_at < p_ends_at
        and t.ends_at   > p_starts_at
    );
$$;

comment on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid) is
  'Staff who may and can take an appointment, with how much each already has that day. '
  'Eligibility mirrors available_slots() so what is offered and what is accepted agree.';

revoke all on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid) from public;

-- Is the salon open for the whole appointment? Mirrors the window
-- available_slots() steps across, including the per-staff hours override.
create function public.salon_is_open_for(
  p_salon_id  uuid,
  p_staff_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from working_hours wh
    cross join lateral (
      select (p_starts_at at time zone 'Asia/Riyadh')::date as day
    ) d
    where wh.salon_id = p_salon_id
      and wh.day_of_week = extract(dow from d.day)::smallint
      and case
            when p_staff_id is not null
              and exists (
                select 1 from working_hours w2
                where w2.salon_id = p_salon_id and w2.staff_id = p_staff_id
              )
            then wh.staff_id = p_staff_id
            else wh.staff_id is null
          end
      and p_starts_at >= (d.day + wh.opens_at)  at time zone 'Asia/Riyadh'
      and p_ends_at   <= (d.day + wh.closes_at) at time zone 'Asia/Riyadh'
  );
$$;

revoke all on function public.salon_is_open_for(uuid, uuid, timestamptz, timestamptz) from public;

-- A reference a human can read out over the phone. Retried on the unique index
-- rather than trusted to be collision-free.
create function public.new_booking_reference()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  for _ in 1..10 loop
    candidate := 'SL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    if not exists (select 1 from bookings where reference = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'could not allocate a booking reference';
end;
$$;

revoke all on function public.new_booking_reference() from public;

-- ---------------------------------------------------------------------------
-- create_booking()
-- ---------------------------------------------------------------------------

-- There is no customer parameter: the booking belongs to auth.uid(). "A
-- customer cannot book in someone else's name" stops being a rule to police and
-- becomes impossible to express.
--
-- Failure codes the app words for itself:
--   SL001  a service is not bookable at this salon
--   SL002  the salon is not open then
--   SL003  nobody is free
--   23P01  somebody took the chair in between (the exclusion constraint)
create function public.create_booking(
  p_salon_id       uuid,
  p_staff_id       uuid,
  p_service_ids    uuid[],
  p_starts_at      timestamptz,
  p_payment_method text default null
)
returns table (booking_id uuid, reference text, staff_id uuid, total_halalas integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer   uuid := auth.uid();
  v_wanted     uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_found      integer;
  v_minutes    integer;
  v_ends_at    timestamptz;
  v_vat_rate   numeric(4,3) := 0.150;
  v_subtotal   integer;
  v_net        integer;
  v_vat        integer;
  v_staff      uuid;
  v_booking    uuid;
  v_reference  text;
begin
  if v_customer is null then
    raise exception 'sign in before booking' using errcode = '42501';
  end if;

  -- The services, read from the salon's own rows and priced there. Anything
  -- hidden, archived or belonging to another salon simply does not come back,
  -- and the count check is what turns that into a refusal rather than a
  -- cheaper booking.
  --
  -- Each line is discounted and rounded on its own, then VAT is taken on the
  -- net — mirroring totalsFor() in src/data/bookings.ts so the figure on screen
  -- and the figure stored agree to the halala.
  select
    count(*)::integer,
    sum(s.duration_minutes)::integer,
    sum(s.price_halalas)::integer,
    sum(round(s.price_halalas::numeric * (100 - s.discount_percent) / 100))::integer
  into v_found, v_minutes, v_subtotal, v_net
  from services s
  where s.id = any (v_wanted)
    and s.salon_id = p_salon_id
    and s.is_active
    and not s.is_archived;

  if coalesce(v_found, 0) = 0
     or v_found <> (select count(distinct u.id) from unnest(v_wanted) as u(id))
  then
    raise exception 'one of those services cannot be booked at this salon'
      using errcode = 'SL001';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_minutes);

  if p_starts_at <= now() then
    raise exception 'that time has already passed' using errcode = 'SL002';
  end if;

  if not salon_is_open_for(p_salon_id, p_staff_id, p_starts_at, v_ends_at) then
    raise exception 'the salon is not open then' using errcode = 'SL002';
  end if;

  -- Assign the chair before inserting, so the exclusion constraint has somebody
  -- to compare against. This is what closes the "any professional" race.
  if p_staff_id is not null then
    select f.staff_id into v_staff
    from free_staff_for(p_salon_id, v_wanted, p_starts_at, v_ends_at) f
    where f.staff_id = p_staff_id;
  else
    select f.staff_id into v_staff
    from free_staff_for(p_salon_id, v_wanted, p_starts_at, v_ends_at) f
    -- Least loaded first, then the salon's own ordering, then id so ties break
    -- the same way every time.
    order by f.load, f.sort_order, f.staff_id
    limit 1;
  end if;

  if v_staff is null then
    raise exception 'nobody is free for that time' using errcode = 'SL003';
  end if;

  v_vat := round(v_net::numeric * v_vat_rate)::integer;
  v_reference := new_booking_reference();

  insert into bookings (
    reference, customer_id, salon_id, staff_id, staff_requested,
    starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    payment_method, paid_at
  ) values (
    v_reference, v_customer, p_salon_id, v_staff, p_staff_id is not null,
    p_starts_at, v_ends_at, 'confirmed',
    v_subtotal, v_subtotal - v_net, v_vat, v_net + v_vat, v_vat_rate,
    p_payment_method,
    -- Never set: checkout is simulated and no money has moved. Claiming
    -- otherwise would put a lie in the invoice.
    null
  )
  returning id into v_booking;

  insert into booking_items (
    booking_id, service_id, name_en, name_ar,
    duration_minutes, unit_price_halalas, discount_percent, quantity
  )
  select v_booking, s.id, s.name_en, s.name_ar,
         s.duration_minutes, s.price_halalas, s.discount_percent, 1
  from services s
  where s.id = any (v_wanted)
    and s.salon_id = p_salon_id
    and s.is_active
    and not s.is_archived;

  return query select v_booking, v_reference, v_staff, (v_net + v_vat);
end;
$$;

comment on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) is
  'The only way a booking comes into existence. Prices it from the salon''s own services, assigns '
  'a staff member so the no-double-booking constraint applies, and writes the booking and its '
  'items in one transaction. Books for auth.uid() only.';

revoke all on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) from public;
grant execute on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_booking()
-- ---------------------------------------------------------------------------

-- A plain UPDATE cannot re-assign, because it has no idea who is free. Now that
-- every booking has a chair, an unrequested one would otherwise be narrowed to
-- a single diary the customer never asked for.
create function public.reschedule_booking(
  p_booking_id uuid,
  p_starts_at  timestamptz
)
returns table (staff_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  b         bookings%rowtype;
  v_wanted  uuid[];
  v_ends_at timestamptz;
  v_staff   uuid;
begin
  select * into b from bookings where id = p_booking_id;

  -- A booking that is not yours and one that does not exist are refused
  -- identically, so this cannot be used to find out which references are real.
  if b.id is null or b.customer_id is distinct from auth.uid() then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'that appointment can no longer be moved' using errcode = 'SL002';
  end if;

  -- Its own length, kept: the customer agreed to these services at this price.
  v_ends_at := p_starts_at + (b.ends_at - b.starts_at);

  if p_starts_at <= now() then
    raise exception 'that time has already passed' using errcode = 'SL002';
  end if;

  select coalesce(array_agg(service_id) filter (where service_id is not null), '{}'::uuid[])
    into v_wanted
  from booking_items where booking_id = b.id;

  if not salon_is_open_for(b.salon_id,
                           case when b.staff_requested then b.staff_id else null end,
                           p_starts_at, v_ends_at) then
    raise exception 'the salon is not open then' using errcode = 'SL002';
  end if;

  if b.staff_requested then
    -- They asked for this person. Moving them to somebody else would be a
    -- betrayal of that, so the move simply fails if the person is busy.
    select f.staff_id into v_staff
    from free_staff_for(b.salon_id, v_wanted, p_starts_at, v_ends_at, b.id) f
    where f.staff_id = b.staff_id;
  else
    select f.staff_id into v_staff
    from free_staff_for(b.salon_id, v_wanted, p_starts_at, v_ends_at, b.id) f
    order by f.load, f.sort_order, f.staff_id
    limit 1;
  end if;

  if v_staff is null then
    raise exception 'nobody is free for that time' using errcode = 'SL003';
  end if;

  -- Prices are untouched on purpose: this is the same appointment at a new
  -- time, not a new one.
  update bookings
     set starts_at = p_starts_at,
         ends_at   = v_ends_at,
         staff_id  = v_staff
   where id = b.id;

  return query select v_staff;
end;
$$;

comment on function public.reschedule_booking(uuid, timestamptz) is
  'Moves a booking, keeping its length and its price snapshot. Re-assigns the chair when the '
  'customer did not name anyone, and keeps the person when they did.';

revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;
