-- Saloni — commission: the rate, the snapshot, and who may see it
--
-- The revenue model is a percentage of each booking rather than a subscription
-- (ROADMAP.md, Phase 2). This migration is the half that is identical whether
-- Saloni invoices the salon afterwards or a gateway splits the payment later,
-- so it lands before that is settled and neither choice wastes it.
--
-- Four decisions are baked in here. Each is commercial rather than technical,
-- so each is written down: a rate sitting in a database with no reasoning
-- attached is the kind of thing nobody later dares to change.
--
--   1. Basis points, not a float.  500 = 5.00%. Money in this schema is
--      integer halalas and never a float (0001's conventions); a rate stored as
--      0.05 would reintroduce exactly the rounding drift those integers exist
--      to avoid.
--
--   2. Charged on the GROSS total, VAT included.  Chosen deliberately over the
--      net-of-VAT alternative, and worth being plain about because it will come
--      up with an accountant: on a 100.00 service the bill is 115.00 and the
--      commission is 5.75 rather than 5.00, so 0.75 of it is a percentage of
--      tax that was never the salon's revenue. Changing it later is one line
--      here plus a new rate for the salons that agreed the old one — every
--      booking already written keeps the number it was written with.
--
--   3. A walk-in earns nothing, and create_walkin_booking() is NOT touched to
--      achieve it.  Commission pays for introducing a customer, and a walk-in
--      is the salon's own customer at its own counter — Saloni introduced
--      nobody. Charging for it would also be self-defeating: the salon would
--      stop recording walk-ins to dodge the fee, the calendar would go back to
--      selling hours somebody is already sitting in, and every figure built on
--      bookings would drift. A fee that makes honesty expensive buys bad data.
--      Both new columns default to zero, so the walk-in path already does the
--      right thing and rewriting a working 120-line function to spell out a
--      zero it already writes would be risk for nothing. Assertion 114 is what
--      makes it a decision rather than an accident.
--
--   4. The obligation arises on 'completed', not on booking.  The number is
--      fixed when the booking is made so a later rate change cannot re-price
--      it; what is *owed* is only what actually happened. See
--      commission_statement().

-- ---------------------------------------------------------------------------
-- 1. The rate, per salon, and not the salon's to set
-- ---------------------------------------------------------------------------

alter table salons
  add column commission_bps integer not null default 500
    check (commission_bps between 0 and 10000);

comment on column salons.commission_bps is
  'What Saloni charges this salon, in basis points of the gross booking total. 500 = 5.00%. '
  'Per salon so an individual deal can differ from the standard rate. Neither readable nor '
  'writable by anon or authenticated: it is revenue, and an owner who could set it would set '
  'it to zero.';

-- No revoke is needed here, and that is worth noticing rather than glossing.
-- 0004 and 0015 replaced every table-wide grant on salons — insert, update AND
-- select — with an explicit column list, so a column added afterwards is
-- invisible and unwritable until somebody names it. This one is deliberately
-- never named, exactly like cr_number: an owner reads their own rate through
-- commission_statement() below, and nobody else reads it at all. A rival
-- learning what deal a competitor is on is a commercial leak, not an untidy
-- one. Assertion 113 fails if a later migration adds it to a grant.

-- ---------------------------------------------------------------------------
-- 2. The snapshot, per booking
-- ---------------------------------------------------------------------------

-- Both columns exist for the reason vat_rate does (0001): what was agreed is
-- history. Re-deriving commission from salons.commission_bps at invoice time
-- would silently re-price every past booking the day a salon's deal changed.
alter table bookings
  add column commission_bps integer not null default 0
    check (commission_bps between 0 and 10000),
  add column commission_halalas integer not null default 0
    check (commission_halalas >= 0);

comment on column bookings.commission_bps is
  'The rate that applied when this booking was made, copied from the salon. Zero on every '
  'booking written before commission existed, and on every walk-in — see 0018''s header.';

comment on column bookings.commission_halalas is
  'What Saloni is owed for this booking, computed at booking time from the gross total. The '
  'obligation only arises once the booking reaches ''completed''; the number is fixed before '
  'that so a later rate change cannot rewrite it.';

-- Nothing to revoke. 0006 replaced the table-wide UPDATE grant on bookings with
-- a named column list and 0008 revoked INSERT entirely, so both columns are
-- unwritable by authenticated from the moment they exist. Assertion 112 keeps
-- that true if somebody widens the list later.

-- ---------------------------------------------------------------------------
-- 3. Priced where every other number on a booking is priced
-- ---------------------------------------------------------------------------

-- create_booking() is reproduced verbatim from 0008 with three additions and
-- nothing else changed: two declarations, the commission calculation after VAT,
-- and the two columns on the insert. The signature is identical — a different
-- one would create a second overload rather than replace this function, and
-- the app would keep calling whichever Postgres chose.
--
-- It already prices from the salon's own services rows, which is what makes the
-- commission trustworthy the day money moves: it is derived from a total the
-- caller never supplied.
create or replace function public.create_booking(
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
  v_total      integer;
  v_bps        integer;
  v_commission integer;
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
  v_total := v_net + v_vat;

  -- The commission, on the gross total, at the rate this salon is on today.
  -- Read here rather than at invoice time so the booking carries its own number
  -- for good. A salon row that has somehow gone missing yields no rate rather
  -- than a default one: billing somebody at a rate nobody agreed is worse than
  -- billing them nothing.
  select s.commission_bps into v_bps from salons s where s.id = p_salon_id;
  v_commission := round(v_total::numeric * coalesce(v_bps, 0) / 10000)::integer;

  v_reference := new_booking_reference();

  insert into bookings (
    reference, customer_id, salon_id, staff_id, staff_requested,
    starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    commission_bps, commission_halalas,
    payment_method, paid_at
  ) values (
    v_reference, v_customer, p_salon_id, v_staff, p_staff_id is not null,
    p_starts_at, v_ends_at, 'confirmed',
    v_subtotal, v_subtotal - v_net, v_vat, v_total, v_vat_rate,
    coalesce(v_bps, 0), v_commission,
    p_payment_method,
    -- Still never set: checkout is simulated and no money has moved. Recording
    -- what Saloni is owed is not the same as recording that anybody has paid,
    -- and conflating the two is how an invoice comes to claim a lie.
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

  return query select v_booking, v_reference, v_staff, v_total;
end;
$$;

comment on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) is
  'The only way a customer booking comes into existence. Prices from the salon''s own services '
  'rows, assigns a chair before inserting so the no-double-booking constraint applies, checks '
  'opening hours, and since 0018 records what Saloni is owed at the rate in force that day.';

-- ---------------------------------------------------------------------------
-- 4. What is owed, and who may ask
-- ---------------------------------------------------------------------------

-- Counts 'completed' and nothing else. A cancellation and a no-show are worth
-- nothing because no service was given; a booking still in the future is worth
-- nothing because it has not happened. Counted by starts_at, so a statement
-- answers "the visits that happened in September" rather than "the bookings
-- made in September" — which is the question an invoice actually settles.
create function public.commission_statement(
  p_salon_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns table (
  bookings_count     integer,
  gross_halalas      bigint,
  commission_halalas bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Two callers, deliberately. Saloni's admin settles the invoice; the salon's
  -- own owner has an unarguable right to see the same number, from the same
  -- rows, before being asked to pay it. A statement only one side can see is a
  -- bill the other has to take on trust.
  if not (is_admin() or is_salon_owner(p_salon_id)) then
    raise exception 'not entitled to this salon''s statement' using errcode = '42501';
  end if;

  return query
  select coalesce(count(*), 0)::integer,
         coalesce(sum(b.total_halalas), 0)::bigint,
         coalesce(sum(b.commission_halalas), 0)::bigint
  from bookings b
  where b.salon_id = p_salon_id
    and b.status = 'completed'
    and b.starts_at >= p_from
    and b.starts_at < p_to;
end;
$$;

comment on function public.commission_statement(uuid, timestamptz, timestamptz) is
  'What Saloni is owed by one salon for visits that actually happened in a period. Readable by '
  'Saloni''s admin and by that salon''s own owner, and by nobody else. Sums the per-booking '
  'snapshot rather than re-deriving from the current rate, so a rate change never re-prices '
  'history.';

-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- default, so "revoke from public" revokes nothing (see 0010). Name the roles,
-- or assertion 84 fails — which is what assertion 84 is for.
revoke all on function public.commission_statement(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.commission_statement(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.commission_statement(uuid, timestamptz, timestamptz) to authenticated;
