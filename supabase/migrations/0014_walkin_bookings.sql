-- Saloni — the bookings a salon takes at the counter and on the phone
--
-- Every booking so far has belonged to auth.uid(). That is deliberate and stays
-- true for customers: create_booking() takes no customer parameter, so "a
-- customer cannot book in someone else's name" is impossible to express rather
-- than policed. Nothing below weakens that. A visitor still cannot create a
-- booking, signed in or not.
--
-- What it could not express is the other half of a real salon's day. Somebody
-- walks in, or rings up, and there is nowhere to put them: they have no
-- account, and there is no way for the owner to write one. Today the owner has
-- two options and both are bad.
--
--   Tell the app nothing.  available_slots() then offers that hour to a
--                          customer who arrives to find the chair occupied.
--   Block the time out.    The slot stops being sold — time_off has done that
--                          since 0003 — but nothing records who, what, or for
--                          how much, so "Booked today", the occupancy figure
--                          and the day list are all wrong.
--
-- Either way the salon keeps its paper book beside Saloni, and at that point
-- the app is extra work rather than the system. So: a booking may belong to a
-- customer account OR carry a name the salon typed, never neither, and never
-- both.
--
-- The person named here has no account, sees nothing, and can cancel nothing.
-- It is the salon's own diary entry, written by the owner, about an appointment
-- the salon has already agreed to.

-- ---------------------------------------------------------------------------
-- 1. A booking may name a guest instead of an account
-- ---------------------------------------------------------------------------

alter table bookings alter column customer_id drop not null;

alter table bookings
  add column guest_name  text,
  add column guest_phone text;

-- Either an account or a name, never neither — a booking with nobody attached
-- is not a record of anything. And never both: two names on one appointment is
-- a question about which is right, and the salon should not have to answer it.
--
-- The length caps match what the app allows for a customer's own name
-- (NAME_MAX_LENGTH, 60) so the two paths cannot disagree about what fits.
alter table bookings
  add constraint booking_belongs_to_somebody check (
    (customer_id is not null and guest_name is null and guest_phone is null)
    or (
      customer_id is null
      and guest_name is not null
      and length(btrim(guest_name)) between 1 and 60
      and (guest_phone is null or length(btrim(guest_phone)) between 1 and 20)
    )
  );

comment on column bookings.customer_id is
  'The account the booking belongs to. Null only for a booking the salon wrote itself for '
  'somebody with no account — see guest_name and create_walkin_booking().';

comment on column bookings.guest_name is
  'What the salon called this person when it took the booking at the counter or on the phone. '
  'Set only by create_walkin_booking(); not writable by authenticated, because the name on an '
  'appointment is part of the record rather than a field.';

comment on column bookings.guest_phone is
  'Optional, and typed by the salon itself — this is the salon''s own note of how to reach '
  'somebody it already spoke to, not a customer''s contact detail crossing a boundary. A '
  'profile''s phone number is still never handed to a salon; see salon_day() below.';

-- The guest columns are unwritable already — 0008 revoked INSERT on bookings
-- entirely, and 0006's UPDATE grant names its columns — so this adds nothing
-- and is here to be explicit about it. Adding either column to that grant would
-- let a salon rename somebody else's appointment after the fact.

-- ---------------------------------------------------------------------------
-- 2. Writing one
-- ---------------------------------------------------------------------------

-- The mirror of create_booking(), guarded the other way round: that one refuses
-- to book for anybody but the caller, this one refuses to write anywhere but
-- the caller's own salon.
--
-- Three deliberate differences from the customer's path, all of them because
-- this records something that has already happened rather than offering
-- something that has not:
--
--   * A time in the past is allowed. The walk-in most worth recording is the
--     one sitting in the chair right now, which started ten minutes ago.
--   * Opening hours are not checked. A salon that stayed late for somebody is
--     describing its own day; refusing the entry would not make the day
--     shorter, it would just keep it out of the app.
--   * Time off is not checked for a named staff member. If the owner says Layla
--     did it, Layla did it — blocking the hour out was the salon's own note,
--     and reality wins over it.
--
-- What is NOT relaxed is the one thing the database is actually for: the chair.
-- A staff member is assigned before the insert, so the exclusion constraint on
-- (staff_id, period) applies exactly as it does to a customer's booking, and
-- two appointments cannot occupy one person.
--
-- Failure codes the app words for itself:
--   42501  not this salon's owner
--   SL001  a service is not bookable at this salon
--   SL003  nobody free, or the named staff member is not this salon's
--   23P01  that chair is already taken (the exclusion constraint)
create function public.create_walkin_booking(
  p_salon_id    uuid,
  p_staff_id    uuid,
  p_service_ids uuid[],
  p_starts_at   timestamptz,
  p_guest_name  text,
  p_guest_phone text default null,
  p_notes       text default ''
)
returns table (booking_id uuid, reference text, staff_id uuid, total_halalas integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted    uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_name      text := btrim(coalesce(p_guest_name, ''));
  v_phone     text := nullif(btrim(coalesce(p_guest_phone, '')), '');
  v_found     integer;
  v_minutes   integer;
  v_ends_at   timestamptz;
  v_vat_rate  numeric(4,3) := 0.150;
  v_subtotal  integer;
  v_net       integer;
  v_vat       integer;
  v_staff     uuid;
  v_booking   uuid;
  v_reference text;
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'a walk-in needs a name to be filed under' using errcode = 'SL004';
  end if;

  -- Capped here as well as in the constraint, so a long name is trimmed to fit
  -- rather than refusing the booking in front of a waiting customer.
  v_name  := left(v_name, 60);
  v_phone := left(v_phone, 20);

  -- Priced from the salon's own rows, the same way create_booking() prices a
  -- customer's. The owner could be allowed to type their own figure — they are
  -- their prices — but a second pricing path is a second thing to keep in step
  -- with the receipt, and "Booked today" should mean the same thing whoever
  -- wrote the booking.
  --
  -- One difference: a hidden service (is_active false) is accepted here, where
  -- the customer's path takes only live ones. Hiding a service stops it being
  -- offered, and a salon that has stopped advertising something can still do it
  -- for somebody at the counter. Archived is the real "no longer exists", and
  -- that is refused on both paths, because bookings reference those rows.
  select
    count(*)::integer,
    sum(s.duration_minutes)::integer,
    sum(s.price_halalas)::integer,
    sum(round(s.price_halalas::numeric * (100 - s.discount_percent) / 100))::integer
  into v_found, v_minutes, v_subtotal, v_net
  from services s
  where s.id = any (v_wanted)
    and s.salon_id = p_salon_id
    and not s.is_archived;

  if coalesce(v_found, 0) = 0
     or v_found <> (select count(distinct u.id) from unnest(v_wanted) as u(id))
  then
    raise exception 'one of those services cannot be booked at this salon'
      using errcode = 'SL001';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_minutes);

  if p_staff_id is not null then
    -- Named: the only question is whether they are this salon's. Whether they
    -- are free is the exclusion constraint's to answer, and it will. Hidden
    -- staff are accepted for the same reason hidden services are; archived
    -- ones are not, because a booking points at the row.
    select st.id into v_staff
    from staff st
    where st.id = p_staff_id
      and st.salon_id = p_salon_id
      and not st.is_archived;
  else
    select f.staff_id into v_staff
    from free_staff_for(p_salon_id, v_wanted, p_starts_at, v_ends_at) f
    order by f.load, f.sort_order, f.staff_id
    limit 1;
  end if;

  if v_staff is null then
    raise exception 'nobody is free for that time' using errcode = 'SL003';
  end if;

  v_vat := round(v_net::numeric * v_vat_rate)::integer;
  v_reference := new_booking_reference();

  insert into bookings (
    reference, customer_id, guest_name, guest_phone,
    salon_id, staff_id, staff_requested,
    starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    notes
  ) values (
    v_reference, null, v_name, v_phone,
    p_salon_id, v_staff, p_staff_id is not null,
    p_starts_at, v_ends_at,
    -- Somebody is in the chair or has said they are coming; the salon does not
    -- need to confirm its own booking to itself.
    'confirmed',
    v_subtotal, v_subtotal - v_net, v_vat, v_net + v_vat, v_vat_rate,
    left(coalesce(p_notes, ''), 500)
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
    and not s.is_archived;

  return query select v_booking, v_reference, v_staff, (v_net + v_vat);
end;
$$;

comment on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) is
  'The salon writing its own diary: a booking for somebody with no account, filed under a name '
  'the owner typed. Guarded by is_salon_owner(), priced from the salon''s own services, and it '
  'assigns a chair before inserting so the no-double-booking constraint still applies.';

revoke all on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) from public;
revoke execute on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) from anon;
grant execute on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The calendar has to show them
-- ---------------------------------------------------------------------------

-- salon_day() joined profiles on customer_id. An inner join drops every row
-- where that is null, so without this change a walk-in would be written
-- successfully, hold its chair, count towards the figures — and be invisible on
-- the calendar it was written from. Left join, and the name comes from whichever
-- side has one.
--
-- The phone number needs the same care in the other direction. Guarantee 9 is
-- that a customer's contact details never reach the salon, and it holds: this
-- returns guest_phone and nothing from profiles, so a salon sees only the
-- number it typed in itself. Coalescing p.phone in here would break that
-- silently, which is why assertion 92 checks it.
drop function if exists public.salon_day(uuid, date);

create function public.salon_day(
  p_salon_id uuid,
  p_day      date
)
returns table (
  booking_id     uuid,
  reference      text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         booking_status,
  staff_name_en  text,
  staff_name_ar  text,
  customer_name  text,
  customer_phone text,
  is_walk_in     boolean,
  services_en    text[],
  services_ar    text[],
  total_halalas  integer
)
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
  select
    b.id,
    b.reference,
    b.starts_at,
    b.ends_at,
    b.status,
    -- Null staff is "any professional": nobody is assigned yet, and the screen
    -- says so rather than inventing a name.
    st.name_en,
    st.name_ar,
    -- The one piece of the customer's profile that crosses this boundary, and
    -- only when they have filled it in; or, for the salon's own entry, the name
    -- the salon wrote. Null leaves the screen showing the booking reference.
    coalesce(nullif(p.full_name, ''), nullif(b.guest_name, '')),
    -- Never p.phone. See the note above.
    b.guest_phone,
    b.customer_id is null,
    items.names_en,
    items.names_ar,
    b.total_halalas
  from bookings b
  left join profiles p on p.id = b.customer_id
  left join staff st on st.id = b.staff_id
  cross join lateral (
    select
      coalesce(array_agg(bi.name_en order by bi.id), '{}') as names_en,
      coalesce(array_agg(bi.name_ar order by bi.id), '{}') as names_ar
    from booking_items bi
    where bi.booking_id = b.id
  ) items
  where b.salon_id = p_salon_id
    -- The salon's own calendar day, not the viewer's. An owner abroad still
    -- reads the diary in Riyadh time.
    and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day
  order by b.starts_at;
end;
$$;

comment on function public.salon_day(uuid, date) is
  'One salon-day''s appointments for its owner, walk-ins included. security definer so it can '
  'read the customer''s display name, which profiles_select_own otherwise hides; returns no '
  'other profile detail, and the only phone number it returns is one the salon typed itself.';

revoke all on function public.salon_day(uuid, date) from public;
revoke execute on function public.salon_day(uuid, date) from anon;
grant execute on function public.salon_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What is deliberately unchanged
-- ---------------------------------------------------------------------------
--
-- The row policies need no edit, and it is worth saying why rather than leaving
-- it to be rediscovered:
--
--   bookings_select      `customer_id = auth.uid() or is_salon_owner(salon_id)`.
--                        With customer_id null the first half is null, never
--                        true, so a walk-in is visible to its salon and to
--                        nobody else. Not even to the person it names.
--   booking_items_*      Reached through the booking, so they inherit that.
--   status transitions   The 0006 trigger lets the owner move any of their
--                        salon's bookings and lets a customer cancel their own.
--                        `old.customer_id = auth.uid()` is null for a walk-in,
--                        so the customer branch cannot be reached at all.
--   reviews              reviews_insert_after_visit wants a completed booking
--                        belonging to the reviewer. A walk-in belongs to no
--                        account, so it earns nobody a review — correct: there
--                        is no one to attribute it to.
--   reschedule_booking() Checks `customer_id is distinct from auth.uid()` and
--                        so refuses walk-ins to everyone, the owner included.
--                        The owner moves one from the calendar instead, which
--                        is a plain UPDATE of starts_at/ends_at they already
--                        have. Left alone rather than widened.
