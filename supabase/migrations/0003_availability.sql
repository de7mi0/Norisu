-- Saloni — real availability
--
-- Until now the app offered nine hardcoded times to everybody. They ignored the
-- salon's opening hours, the length of the chosen services and the appointments
-- already in the book, so a customer could pick a slot that was already taken
-- and only find out at checkout, when the no_double_booking exclusion
-- constraint rejected the insert.
--
-- Why this lives in the database rather than in the app:
--   bookings_select (0002) deliberately lets a customer read only their own
--   bookings. That is correct — nobody should be able to enumerate a salon's
--   client list — but it means the browser cannot work out which times are
--   taken. available_slots() is therefore security definer: it can see every
--   booking, but it answers only "free" or "taken" and never returns who booked,
--   what they booked, or when their appointment actually runs.

-- ---------------------------------------------------------------------------
-- How far apart the offered times sit, chosen by the salon
-- ---------------------------------------------------------------------------

-- Opening hours are already the owner's data (working_hours, per weekday and
-- optionally per staff member). This is the other half: how finely that window
-- is sliced. A barber running 20-minute cuts and a spa running 90-minute
-- treatments want different grids.
alter table salons
  add column slot_step_minutes smallint not null default 30
    check (slot_step_minutes in (10, 15, 20, 30, 60));

comment on column salons.slot_step_minutes is
  'Spacing between offered appointment times. Owners change this on their own row via salons_update_own.';

-- ---------------------------------------------------------------------------
-- available_slots()
-- ---------------------------------------------------------------------------

-- Returns every time in the salon's opening window for that day, each flagged
-- free or taken, so the booking screen can grey out what is gone instead of
-- silently hiding it — a customer can then see the salon is busy rather than
-- merely short on options.
--
-- p_staff_id null means "any professional". That case is the one the
-- no_double_booking constraint cannot cover (there is nobody to compare
-- against), so capacity is counted here instead: how many eligible staff are
-- free, less the bookings that are themselves unassigned and will consume a
-- chair once the salon allocates one.
--
-- p_exclude_booking_id is for rescheduling: without it an appointment collides
-- with itself and its own current time shows as unavailable.
create function public.available_slots(
  p_salon_id           uuid,
  p_day                date,
  p_duration_minutes   integer,
  p_staff_id           uuid default null,
  p_service_ids        uuid[] default null,
  p_exclude_booking_id uuid default null
)
returns table (slot_at timestamptz, is_free boolean, staff_free integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with params as (
    select
      make_interval(mins => p_duration_minutes) as dur,
      -- Saudi Arabia does not observe daylight saving, so this is a fixed +03,
      -- but naming the zone keeps it correct if that ever changes.
      'Asia/Riyadh'::text as tz
  ),
  settings as (
    select s.slot_step_minutes as step
    from salons s
    where s.id = p_salon_id
  ),
  -- A staff member's own hours win when they have any; otherwise the salon's.
  window_rows as (
    select wh.opens_at, wh.closes_at
    from working_hours wh
    where wh.salon_id = p_salon_id
      and wh.day_of_week = extract(dow from p_day)::smallint
      and case
            when p_staff_id is not null
              and exists (
                select 1 from working_hours w2
                where w2.salon_id = p_salon_id and w2.staff_id = p_staff_id
              )
            then wh.staff_id = p_staff_id
            else wh.staff_id is null
          end
  ),
  -- Who could actually take this appointment. A service with no staff_services
  -- rows is performable by anyone, per the schema's convention.
  eligible_staff as (
    select st.id
    from staff st
    where st.salon_id = p_salon_id
      and st.is_active
      and not st.is_archived
      and (
        p_service_ids is null
        or not exists (
          select 1
          from unnest(p_service_ids) as wanted(service_id)
          where exists (
                  select 1 from staff_services ss
                  where ss.service_id = wanted.service_id
                )
            and not exists (
                  select 1 from staff_services ss2
                  where ss2.service_id = wanted.service_id
                    and ss2.staff_id = st.id
                )
        )
      )
  ),
  -- Step across the opening window, keeping only starts that finish before
  -- closing: a three-hour treatment simply has no late slots.
  candidates as (
    select distinct gs.slot_at
    from window_rows w
    cross join params p
    cross join settings sg
    cross join lateral generate_series(
      (p_day + w.opens_at) at time zone p.tz,
      ((p_day + w.closes_at) at time zone p.tz) - p.dur,
      make_interval(mins => sg.step)
    ) as gs(slot_at)
    where p_duration_minutes > 0
  )
  select
    c.slot_at,
    (agg.effective_free >= 1) as is_free,
    agg.effective_free::integer as staff_free
  from candidates c
  cross join params p
  cross join lateral (
    select
      case
        -- A salon-wide closure blackens the slot for everyone.
        when exists (
          select 1 from time_off t
          where t.salon_id = p_salon_id
            and t.staff_id is null
            and t.starts_at < c.slot_at + p.dur
            and t.ends_at   > c.slot_at
        ) then 0::bigint
        -- Naming someone requires that person to be eligible and free...
        when p_staff_id is not null and not (
          exists (select 1 from eligible_staff es0 where es0.id = p_staff_id)
          and not exists (
                select 1 from bookings b
                where b.staff_id = p_staff_id
                  and b.status in ('pending', 'confirmed', 'in_progress')
                  and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
                  and b.starts_at < c.slot_at + p.dur
                  and b.ends_at   > c.slot_at
              )
          and not exists (
                select 1 from time_off t2
                where t2.staff_id = p_staff_id
                  and t2.starts_at < c.slot_at + p.dur
                  and t2.ends_at   > c.slot_at
              )
        ) then 0::bigint
        -- ...and still leaves the salon a free chair. Without this last part a
        -- pending "any professional" booking could be double-sold: it has not
        -- claimed anyone yet, so naming the only remaining staff member would
        -- otherwise succeed and leave the salon a person short.
        else least(
          greatest(agg_capacity.capacity, 0::bigint),
          case when p_staff_id is not null then 1::bigint else agg_capacity.capacity end
        )
      end as effective_free
    from (
      select
        (
          select count(*)
          from eligible_staff es
          where not exists (
                  select 1 from bookings b2
                  where b2.staff_id = es.id
                    and b2.status in ('pending', 'confirmed', 'in_progress')
                    and (p_exclude_booking_id is null or b2.id <> p_exclude_booking_id)
                    and b2.starts_at < c.slot_at + p.dur
                    and b2.ends_at   > c.slot_at
                )
            and not exists (
                  select 1 from time_off t3
                  where t3.staff_id = es.id
                    and t3.starts_at < c.slot_at + p.dur
                    and t3.ends_at   > c.slot_at
                )
        )
        -- Unassigned bookings hold a chair without naming anyone.
        - (
          select count(*)
          from bookings b3
          where b3.salon_id = p_salon_id
            and b3.staff_id is null
            and b3.status in ('pending', 'confirmed', 'in_progress')
            and (p_exclude_booking_id is null or b3.id <> p_exclude_booking_id)
            and b3.starts_at < c.slot_at + p.dur
            and b3.ends_at   > c.slot_at
        ) as capacity
    ) agg_capacity
  ) agg
  -- Never offer a time that has already passed.
  where c.slot_at > now()
  order by c.slot_at;
$$;

comment on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid) is
  'Free/busy for one salon-day. security definer so it can read every booking; returns only free/taken counts, never customer or booking detail.';

-- Browsing is deliberately ungated, so an anonymous visitor must be able to see
-- times too. Executable by exactly these two roles and nobody else.
revoke all on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid) from public;
grant execute on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid) to anon, authenticated;
