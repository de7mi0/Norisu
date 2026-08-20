-- Saloni — the owner's own day
--
-- The vendor portal's dashboard figures, day calendar and reviews list were the
-- last sections still running on invented numbers. Registration, opening hours,
-- the booking interval, services and the team already belong to whoever is
-- signed in; these three did not, and each carried a notice on screen saying so.
--
-- Why these live in the database rather than in the app:
--
--   bookings_select and booking_items_select (0002) already let a salon owner
--   read their own salon's rows, so the appointments themselves need no new
--   privilege. The customer's *name* does. profiles_select_own is
--   `id = auth.uid()` — an owner cannot read anybody's profile but their own,
--   which is right, and which would leave every appointment on the calendar
--   belonging to nobody.
--
--   So these follow available_slots() (0003): security definer, reading across
--   policies, but answering a deliberately narrow question. They return the
--   customer's display name and nothing else about them — no e-mail, no phone
--   number, no other booking. A salon should not be handed a contact detail the
--   customer never chose to give it.
--
-- security definer bypasses row-level security, so the ownership guard at the
-- top of each function *is* the security boundary. is_salon_owner() (0002)
-- does the check; a stranger gets 42501 rather than a row.

-- ---------------------------------------------------------------------------
-- salon_day() — one day's appointments
-- ---------------------------------------------------------------------------

-- Cancelled bookings are still returned, marked as such: a salon needs to see
-- that somebody dropped out. They are excluded from every count in
-- salon_stats() below, which is a different question.
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
    -- only when they have filled it in. Null leaves the screen showing the
    -- booking reference instead.
    nullif(p.full_name, ''),
    items.names_en,
    items.names_ar,
    b.total_halalas
  from bookings b
  join profiles p on p.id = b.customer_id
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
  'One salon-day''s appointments for its owner. security definer so it can read the customer''s display name, which profiles_select_own otherwise hides; returns no other profile detail.';

revoke all on function public.salon_day(uuid, date) from public;
-- Owner-only data, unlike available_slots(): anon has no business here.
grant execute on function public.salon_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- salon_stats() — the four figures on the dashboard
-- ---------------------------------------------------------------------------

-- booked_halalas is deliberately not called revenue. Nothing is paid: bookings
-- record a payment_method but paid_at stays null because no money moves yet.
-- Reporting it as takings would be the one thing this portal must not do.
--
-- occupancy_percent is null when the salon does not open that day, so the tile
-- can show a dash rather than a false zero.
create function public.salon_stats(
  p_salon_id uuid,
  p_day      date
)
returns table (
  bookings_today     integer,
  bookings_yesterday integer,
  booked_halalas     bigint,
  occupancy_percent  integer,
  is_open            boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_open_minutes  integer;
  v_staff_count   integer;
  v_booked_minutes integer;
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  -- The salon's default hours for that weekday. Per-staff rows are ignored
  -- here: capacity is counted as chairs below, not as individual diaries.
  select coalesce(sum(extract(epoch from (wh.closes_at - wh.opens_at)) / 60), 0)::integer
    into v_open_minutes
  from working_hours wh
  where wh.salon_id = p_salon_id
    and wh.staff_id is null
    and wh.day_of_week = extract(dow from p_day)::smallint;

  select count(*)::integer
    into v_staff_count
  from staff st
  where st.salon_id = p_salon_id
    and st.is_active
    and not st.is_archived;

  select coalesce(sum(extract(epoch from (b.ends_at - b.starts_at)) / 60), 0)::integer
    into v_booked_minutes
  from bookings b
  where b.salon_id = p_salon_id
    and b.status <> 'cancelled'
    and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day;

  return query
  select
    (
      select count(*)::integer from bookings b
      where b.salon_id = p_salon_id
        and b.status <> 'cancelled'
        and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day
    ),
    (
      select count(*)::integer from bookings b
      where b.salon_id = p_salon_id
        and b.status <> 'cancelled'
        and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day - 1
    ),
    (
      select coalesce(sum(b.total_halalas), 0)::bigint from bookings b
      where b.salon_id = p_salon_id
        and b.status <> 'cancelled'
        and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day
    ),
    case
      when v_open_minutes = 0 or v_staff_count = 0 then null
      -- Capped at 100: "any professional" bookings are not assigned a chair at
      -- write time, so an oversold day can otherwise exceed the salon's hours.
      else least(
        100,
        round(v_booked_minutes::numeric * 100 / (v_open_minutes * v_staff_count))
      )::integer
    end,
    (v_open_minutes > 0);
end;
$$;

comment on function public.salon_stats(uuid, date) is
  'Today''s counts, booked value and occupancy for a salon''s owner. booked_halalas is what was agreed, not what was paid — paid_at is still always null.';

revoke all on function public.salon_stats(uuid, date) from public;
grant execute on function public.salon_stats(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- salon_reviews() — the salon's reviews, with who wrote them
-- ---------------------------------------------------------------------------

-- reviews_select (0002) already lets an owner read their salon's reviews. Only
-- the reviewer's name needs this function, for exactly the reason above.
-- Unpublished reviews are included: they are the salon's own, and hiding a
-- complaint from the business it is about helps nobody.
create function public.salon_reviews(
  p_salon_id uuid
)
returns table (
  review_id     uuid,
  rating        numeric,
  body          text,
  reply         text,
  replied_at    timestamptz,
  is_published  boolean,
  created_at    timestamptz,
  customer_name text
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
    r.id,
    r.rating,
    r.body,
    r.reply,
    r.replied_at,
    r.is_published,
    r.created_at,
    nullif(p.full_name, '')
  from reviews r
  join profiles p on p.id = r.customer_id
  where r.salon_id = p_salon_id
  order by r.created_at desc;
end;
$$;

comment on function public.salon_reviews(uuid) is
  'A salon''s reviews for its owner, including the reviewer''s display name and unpublished rows.';

revoke all on function public.salon_reviews(uuid) from public;
grant execute on function public.salon_reviews(uuid) to authenticated;
