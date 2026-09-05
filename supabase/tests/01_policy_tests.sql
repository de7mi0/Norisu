-- Saloni — schema and policy assertions.
--
-- Run with scripts/test-db.sh. Every check raises an exception on failure, so
-- the script exits non-zero if any guarantee is broken.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures, created as superuser so RLS does not interfere with setup.
-- ---------------------------------------------------------------------------

insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111', '+966500000001'), -- customer A
  ('22222222-2222-2222-2222-222222222222', '+966500000002'), -- customer B
  ('33333333-3333-3333-3333-333333333333', '+966500000003'), -- vendor  A
  ('44444444-4444-4444-4444-444444444444', '+966500000004'); -- vendor  B

update profiles set role = 'vendor'
  where id in ('33333333-3333-3333-3333-333333333333',
               '44444444-4444-4444-4444-444444444444');

insert into salons (id, owner_id, slug, name_en, name_ar, is_verified, is_published)
values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'maison-noir', 'Maison Noir', 'ميزون نوار', true, true),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   '44444444-4444-4444-4444-444444444444',
   'rose-oud', 'Rose & Oud', 'وردة وعود', true, true);

insert into services (id, salon_id, name_en, name_ar, duration_minutes, price_halalas, discount_percent)
values
  ('cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'Signature Haircut', 'قص شعر', 45, 15000, 20);

insert into staff (id, salon_id, name_en, name_ar, initials)
values
  ('dddddddd-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Layla A.', 'ليلى ع.', 'LA');

-- 10:00–23:00 every day but Friday, which opens at 14:00. Mirrors seed.sql.
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', d, time '10:00', time '23:00'
from generate_series(0, 6) d where d <> 5;
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 5, time '14:00', time '23:00');


-- ---------------------------------------------------------------------------
-- A day the salon is actually open at the times these assertions book.
--
-- The fixture above mirrors seed.sql, where Friday opens at 14:00 rather than
-- 10:00. Most assertions below book a fixed clock time — 12:00, 15:00 — on a
-- day expressed as an offset from today, which means they pass six days a week
-- and fail on the seventh. Assertion 21 found this by failing on a Friday, five
-- weeks after it was written.
--
-- Stepping over Friday keeps every offset stable and makes the suite give the
-- same answer whichever day it is run. Assertion 25, which is specifically
-- about Friday's late start, finds its own Friday and does not use this.
-- ---------------------------------------------------------------------------

-- The p_offset-th day from now that is not a Friday. Nudging a Friday forward
-- by one is not enough: two adjacent offsets would then land on the same date,
-- and these assertions rely on having a day each — one test's bookings would
-- silently occupy another's slots. Counting non-Fridays keeps every offset
-- distinct as well as open.
create function test_day(p_offset integer) returns date
language sql stable as $$
  select d::date
  from generate_series(current_date + 1,
                       current_date + p_offset + (p_offset / 5) + 8,
                       interval '1 day') d
  where extract(dow from d) <> 5
  offset greatest(p_offset, 1) - 1
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 1. A staff member cannot be booked twice over the same period.
--    This is the guarantee the UI cannot make.
-- ---------------------------------------------------------------------------

insert into bookings (
  reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
  subtotal_halalas, total_halalas
) values (
  'SL-0001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
  '2026-08-20 10:00+03', '2026-08-20 10:45+03', 'confirmed', 12000, 13800
);

do $$
begin
  -- Overlaps the booking above by 15 minutes.
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-0002', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    '2026-08-20 10:30+03', '2026-08-20 11:15+03', 'confirmed', 12000, 13800
  );
  raise exception 'FAIL 1: overlapping booking was accepted';
exception
  when exclusion_violation then
    raise notice 'PASS 1: overlapping booking rejected by the database';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Cancelling frees the slot, so it can be rebooked.
-- ---------------------------------------------------------------------------

update bookings set status = 'cancelled', cancelled_at = now()
  where reference = 'SL-0001';

insert into bookings (
  reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
  subtotal_halalas, total_halalas
) values (
  'SL-0003', '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
  '2026-08-20 10:00+03', '2026-08-20 10:45+03', 'confirmed', 12000, 13800
);

do $$
begin
  raise notice 'PASS 2: a cancelled booking releases its slot';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Editing a service price must not change past bookings.
-- ---------------------------------------------------------------------------

insert into booking_items (
  booking_id, service_id, name_en, name_ar, duration_minutes,
  unit_price_halalas, discount_percent
)
select id, 'cccccccc-0000-0000-0000-000000000001',
       'Signature Haircut', 'قص شعر', 45, 15000, 20
from bookings where reference = 'SL-0003';

-- The salon raises its prices.
update services set price_halalas = 18000
  where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare
  snapshotted integer;
begin
  select unit_price_halalas into snapshotted
  from booking_items bi
  join bookings b on b.id = bi.booking_id
  where b.reference = 'SL-0003';

  if snapshotted <> 15000 then
    raise exception 'FAIL 3: past booking changed to % after a price rise', snapshotted;
  end if;
  raise notice 'PASS 3: past booking still reads 15000 after the price rose to 18000';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. A customer sees only their own bookings.
-- ---------------------------------------------------------------------------

do $$
declare
  visible integer;
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  select count(*) into visible from bookings;

  -- Customer A owns SL-0001 only; SL-0003 belongs to customer B.
  if visible <> 1 then
    raise exception 'FAIL 4: customer A can see % bookings, expected 1', visible;
  end if;
  raise notice 'PASS 4: customer A sees only their own booking';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. A salon owner sees every booking made with their salon.
-- ---------------------------------------------------------------------------

do $$
declare
  visible integer;
begin
  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;

  select count(*) into visible from bookings;
  if visible <> 2 then
    raise exception 'FAIL 5: vendor A can see % bookings, expected 2', visible;
  end if;
  raise notice 'PASS 5: vendor A sees both bookings at their salon';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. A vendor cannot see or touch another vendor's salon data.
--    This is the one that matters most: it is the tenant boundary.
-- ---------------------------------------------------------------------------

do $$
declare
  visible integer;
  touched integer;
begin
  perform auth.login_as('44444444-4444-4444-4444-444444444444'); -- vendor B
  set local role authenticated;

  select count(*) into visible from bookings;
  if visible <> 0 then
    raise exception 'FAIL 6a: vendor B can see % bookings at another salon', visible;
  end if;

  -- Attempt to discount a competitor's service.
  update services set price_halalas = 1
    where id = 'cccccccc-0000-0000-0000-000000000001';
  get diagnostics touched = row_count;

  if touched <> 0 then
    raise exception 'FAIL 6b: vendor B modified another salon''s service';
  end if;
  raise notice 'PASS 6: vendor B sees no other salon''s bookings and cannot edit its services';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. A customer cannot create a booking in someone else's name — and since
--     0008, cannot create one directly at all. create_booking() takes no
--     customer parameter, so filing a booking under somebody else stopped being
--     a rule to enforce and became impossible to express.
-- ---------------------------------------------------------------------------

do $$
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  insert into bookings (
    reference, customer_id, salon_id, starts_at, ends_at,
    subtotal_halalas, total_halalas
  ) values (
    'SL-9999', '22222222-2222-2222-2222-222222222222', -- not themselves
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-08-21 10:00+03', '2026-08-21 10:45+03', 12000, 13800
  );
  raise exception 'FAIL 7: booking created on behalf of another customer';
exception
  when insufficient_privilege then
    raise notice 'PASS 7: cannot book in another customer''s name';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 8. Reviews can only be left for a completed booking of your own.
-- ---------------------------------------------------------------------------

do $$
declare
  target uuid;
begin
  select id into target from bookings where reference = 'SL-0003';

  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;

  -- The visit has not happened yet: status is 'confirmed'.
  insert into reviews (booking_id, salon_id, customer_id, rating, body)
  values (target, 'aaaaaaaa-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 5, 'Lovely');
  raise exception 'FAIL 8: review accepted for a visit that has not happened';
exception
  when insufficient_privilege then
    raise notice 'PASS 8: review rejected until the booking is completed';
end
$$;
reset role;

-- Once completed, the same review is allowed.
update bookings set status = 'completed' where reference = 'SL-0003';

do $$
declare
  target uuid;
begin
  select id into target from bookings where reference = 'SL-0003';

  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;

  insert into reviews (booking_id, salon_id, customer_id, rating, body)
  values (target, 'aaaaaaaa-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 5, 'Lovely');
  raise notice 'PASS 9: review accepted once the booking is completed';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 10. An unverified salon cannot be published.
-- ---------------------------------------------------------------------------

do $$
begin
  insert into salons (owner_id, slug, name_en, name_ar, is_verified, is_published)
  values ('44444444-4444-4444-4444-444444444444',
          'unverified', 'Unverified', 'غير موثق', false, true);
  raise exception 'FAIL 10: an unverified salon was published';
exception
  when check_violation then
    raise notice 'PASS 10: publishing requires verification';
end
$$;

-- ---------------------------------------------------------------------------
-- 11. A salon has at most one cover photo.
-- ---------------------------------------------------------------------------

-- Real paths: `<salon id>/<kind>/<file>`, which 0015 now constrains them to.
insert into salon_media (salon_id, storage_path, is_cover)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001/cover/1.jpg', true);

do $$
begin
  insert into salon_media (salon_id, storage_path, is_cover)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001/cover/2.jpg', true);
  raise exception 'FAIL 11: a second cover photo was accepted';
exception
  when unique_violation then
    raise notice 'PASS 11: only one cover photo per salon';
end
$$;

-- ---------------------------------------------------------------------------
-- 12. One live waitlist request per customer, per salon, per day.
-- ---------------------------------------------------------------------------

insert into waitlist_entries (customer_id, salon_id, requested_date)
values ('11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-25');

do $$
begin
  insert into waitlist_entries (customer_id, salon_id, requested_date)
  values ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-25');
  raise exception 'FAIL 12: duplicate waitlist request accepted';
exception
  when unique_violation then
    raise notice 'PASS 12: one active waitlist request per salon per day';
end
$$;

-- ---------------------------------------------------------------------------
-- 13. Anonymous visitors read published salons but no bookings.
-- ---------------------------------------------------------------------------

do $$
declare
  salons_visible integer;
  bookings_visible integer;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  select count(*) into salons_visible from salons;
  select count(*) into bookings_visible from bookings;

  if salons_visible <> 2 then
    raise exception 'FAIL 13a: anon sees % published salons, expected 2', salons_visible;
  end if;
  if bookings_visible <> 0 then
    raise exception 'FAIL 13b: anon can read % bookings', bookings_visible;
  end if;
  raise notice 'PASS 13: anon reads published salons and no bookings';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 14. The rating view reflects published reviews.
-- ---------------------------------------------------------------------------

do $$
declare
  computed numeric;
begin
  select rating into computed from salon_ratings
  where salon_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if computed is distinct from 5.0 then
    raise exception 'FAIL 14: salon rating is %, expected 5.0', computed;
  end if;
  raise notice 'PASS 14: salon rating computed from reviews';
end
$$;

-- ---------------------------------------------------------------------------
-- 15. The catalogue query the app actually issues.
--     Names every column src/data/repository.ts reads, so renaming one here
--     fails the tests rather than the app in someone's browser.
-- ---------------------------------------------------------------------------

do $$
declare
  salon_count integer;
  service_count integer;
  staff_count integer;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  select count(*) into salon_count from (
    select id, slug, name_en, name_ar, tags_en, tags_ar, category_en, category_ar,
           area_en, area_ar, phone, is_published
    from salons
    where is_published
    order by name_en
  ) q;

  select count(*) into service_count from (
    select id, salon_id, name_en, name_ar, duration_minutes, price_halalas,
           discount_percent, is_active, is_archived, sort_order
    from services
    where is_active and not is_archived
    order by sort_order
  ) q;

  select count(*) into staff_count from (
    select id, salon_id, name_en, name_ar, role_en, role_ar, initials,
           is_active, is_archived, sort_order
    from staff
    where is_active and not is_archived
    order by sort_order
  ) q;

  -- The rating view must be readable too, even while it is empty.
  perform salon_id, rating, review_count from salon_ratings;

  if salon_count <> 2 then
    raise exception 'FAIL 15: anon sees % published salons, expected 2', salon_count;
  end if;
  if service_count <> 1 then
    raise exception 'FAIL 15: anon sees % live services, expected 1', service_count;
  end if;
  if staff_count <> 1 then
    raise exception 'FAIL 15: anon sees % active staff, expected 1', staff_count;
  end if;
  raise notice 'PASS 15: the app''s catalogue query works for an anonymous visitor';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 16. Sign-in: a user reads their own profile and nobody else's, and can save
--     their language preference. These are the two policies src/lib/auth.ts
--     depends on the moment somebody signs in.
-- ---------------------------------------------------------------------------

do $$
declare
  visible integer;
  own_role user_role;
  saved text;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111"}',
    true
  );
  set local role authenticated;

  -- Four profiles exist; the policy narrows that to one.
  select count(*) into visible from profiles;
  if visible <> 1 then
    raise exception 'FAIL 16a: customer A sees % profiles, expected only their own', visible;
  end if;

  -- Exactly the columns fetchProfile() selects.
  select role into own_role from profiles
  where id = '11111111-1111-1111-1111-111111111111';
  perform id, role, full_name, phone, locale from profiles;
  if own_role <> 'customer' then
    raise exception 'FAIL 16b: new accounts default to role %, expected customer', own_role;
  end if;

  update profiles set locale = 'ar'
  where id = '11111111-1111-1111-1111-111111111111';
  select locale into saved from profiles
  where id = '11111111-1111-1111-1111-111111111111';
  if saved <> 'ar' then
    raise exception 'FAIL 16c: language preference saved as %, expected ar', saved;
  end if;

  -- Writing somebody else's preference must change nothing.
  update profiles set locale = 'ar'
  where id = '22222222-2222-2222-2222-222222222222';
  if found then
    raise exception 'FAIL 16d: customer A rewrote another account''s profile';
  end if;

  raise notice 'PASS 16: a signed-in user reads and updates only their own profile';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 17. The booking the app actually makes, through create_booking().
--     Since 0008 this is the only way one comes into existence: the client no
--     longer states the price, or the staff member, or the end time.
-- ---------------------------------------------------------------------------

do $$
declare
  customer uuid := '22222222-2222-2222-2222-222222222222';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  -- Read rather than hardcoded: what matters is that the function prices from
  -- the salon's own row, whatever earlier assertions have left it saying.
  listed   integer;
  cut      integer;
  net      integer;
  -- Far enough out that it cannot collide with the availability fixtures below,
  -- which all work a week ahead.
  day      date := test_day(200);
  at_time  timestamptz := (day + time '14:30') at time zone 'Asia/Riyadh';
  made     record;
  readback record;
begin
  select price_halalas, discount_percent into listed, cut
  from services where id = service;
  net := round(listed::numeric * (100 - cut) / 100)::integer;

  perform auth.login_as(customer);
  set local role authenticated;

  select * into made from create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001',
    null,                                             -- any professional
    array[service]::uuid[],
    at_time,
    'applepay'
  );

  reset role;

  -- The price is the salon's, not the caller's.
  select b.reference, b.subtotal_halalas, b.discount_halalas, b.vat_halalas,
         b.total_halalas, b.staff_id, b.staff_requested, b.status, b.paid_at,
         b.ends_at, i.name_ar, i.unit_price_halalas,
         sa.name_en as salon_name, st.name_en as staff_name
    into readback
  from bookings b
  join booking_items i on i.booking_id = b.id
  join salons sa on sa.id = b.salon_id
  left join staff st on st.id = b.staff_id
  where b.id = made.booking_id;

  -- Line discounted and rounded on its own, VAT taken on the net. This is
  -- totalsFor() in src/data/bookings.ts, restated — if the two ever disagree,
  -- the cart total and the invoice disagree.
  if readback.subtotal_halalas <> listed
     or readback.discount_halalas <> listed - net
     or readback.vat_halalas <> round(net::numeric * 0.150)::integer
     or readback.total_halalas <> net + round(net::numeric * 0.150)::integer then
    raise exception 'FAIL 17a: priced % / % / % / % from a listed % at %%%',
      readback.subtotal_halalas, readback.discount_halalas,
      readback.vat_halalas, readback.total_halalas, listed, cut;
  end if;
  -- A discount that silently stopped applying would still satisfy the formula
  -- above if both sides dropped it, so check it actually bit.
  if cut > 0 and readback.discount_halalas <= 0 then
    raise exception 'FAIL 17b: the %%% discount was not applied', cut;
  end if;
  if made.total_halalas <> readback.total_halalas then
    raise exception 'FAIL 17c: the function reported a different total (% vs %)',
      made.total_halalas, readback.total_halalas;
  end if;

  -- Nobody was named, so somebody was assigned anyway — that is what brings the
  -- no-double-booking constraint to bear on "any professional".
  if readback.staff_id is null then
    raise exception 'FAIL 17d: no staff member was assigned';
  end if;
  if readback.staff_requested then
    raise exception 'FAIL 17e: an unnamed booking was recorded as a request';
  end if;

  -- The end time follows the service length, not anything the caller said.
  if readback.ends_at <> at_time + interval '45 minutes' then
    raise exception 'FAIL 17f: the appointment does not last 45 minutes';
  end if;

  -- Simulated checkout: a method is recorded, no money moved.
  if readback.paid_at is not null then
    raise exception 'FAIL 17g: the booking came out marked paid';
  end if;

  -- Arabic must survive the round trip byte for byte.
  if readback.name_ar <> 'قص شعر' then
    raise exception 'FAIL 17h: Arabic service name came back as %', readback.name_ar;
  end if;
  if readback.salon_name is null or readback.staff_name is null then
    raise exception 'FAIL 17i: the joins the app relies on returned nothing';
  end if;

  -- Later assertions work on this booking; the reference is generated by the
  -- database now, so it is carried forward rather than hardcoded.
  perform set_config('saloni.booking_ref', readback.reference, false);

  raise notice 'PASS 17: create_booking() prices, assigns and writes in one call';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 18. The price snapshot outlives a price change, and a booking cannot be
--     filed under somebody else's name.
-- ---------------------------------------------------------------------------

do $$
declare
  charged integer;
begin
  -- The salon raises its price after the booking above was taken.
  update services set price_halalas = 25000
  where id = 'cccccccc-0000-0000-0000-000000000001';

  select i.unit_price_halalas into charged
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.reference = current_setting('saloni.booking_ref');

  -- Whatever the service listed at when the booking was made, that is what the
  -- item still says — 25000 above must not reach it.
  if charged = 25000 then
    raise exception 'FAIL 18a: the price rise rewrote a past booking';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222"}',
    true
  );
  set local role authenticated;

  begin
    insert into bookings (
      reference, customer_id, salon_id, starts_at, ends_at, status,
      subtotal_halalas, total_halalas
    ) values (
      'SL-FORGERY', '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-0000-0000-0000-000000000001',
      '2027-04-01 10:00+03', '2027-04-01 10:45+03', 'confirmed', 15000, 17250
    );
    raise exception 'FAIL 18b: booked an appointment in another customer''s name';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS 18: prices are snapshotted and bookings cannot be forged';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 19. Rescheduling MOVES a booking. It must not leave the old one standing,
--     which is what creating a second row did — the salon was then holding two
--     appointments for one customer.
-- ---------------------------------------------------------------------------

do $$
declare
  before_count integer;
  after_count  integer;
  moved        record;
  items_after  integer;
  total_before integer;
  staff_before uuid;
  -- The day after the one assertion 17 booked, so nothing collides.
  moved_to     timestamptz := ((test_day(201)) + time '16:00') at time zone 'Asia/Riyadh';
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222"}',
    true
  );
  set local role authenticated;

  select count(*) into before_count from bookings
  where customer_id = '22222222-2222-2222-2222-222222222222';

  select total_halalas, staff_id into total_before, staff_before
  from bookings where reference = current_setting('saloni.booking_ref');

  -- Exactly the call src/data/bookings.ts issues. Since 0008 this is a function
  -- rather than an update, because moving an unrequested booking has to be able
  -- to re-pick whoever is free.
  perform reschedule_booking(
    (select id from bookings where reference = current_setting('saloni.booking_ref')),
    moved_to
  );

  select count(*) into after_count from bookings
  where customer_id = '22222222-2222-2222-2222-222222222222';

  if after_count <> before_count then
    raise exception 'FAIL 19a: rescheduling changed the booking count from % to %',
      before_count, after_count;
  end if;

  select starts_at, reference, total_halalas, staff_id into moved
  from bookings where reference = current_setting('saloni.booking_ref');

  if moved.starts_at <> moved_to then
    raise exception 'FAIL 19b: booking did not move, starts_at is %', moved.starts_at;
  end if;
  -- The reference and the money must survive the move untouched: this is the
  -- same appointment at a new time, not a new one.
  if moved.total_halalas <> total_before then
    raise exception 'FAIL 19c: moving the booking changed its total from % to %',
      total_before, moved.total_halalas;
  end if;
  -- Nobody was named when it was booked, so the move is free to re-pick — but
  -- it must still land on somebody.
  if moved.staff_id is null then
    raise exception 'FAIL 19e: the moved booking lost its staff member';
  end if;

  select count(*) into items_after from booking_items i
  join bookings b on b.id = i.booking_id where b.reference = current_setting('saloni.booking_ref');
  if items_after <> 1 then
    raise exception 'FAIL 19d: the price snapshot was disturbed (% items)', items_after;
  end if;

  raise notice 'PASS 19: rescheduling moves the booking instead of duplicating it';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 20. A cancelled booking keeps its history but releases its slot, so somebody
--     else can take the time.
-- ---------------------------------------------------------------------------

do $$
declare
  still_there integer;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222"}',
    true
  );
  set local role authenticated;

  update bookings set status = 'cancelled', cancelled_at = now()
  where reference = current_setting('saloni.booking_ref');

  select count(*) into still_there from bookings where reference = current_setting('saloni.booking_ref');
  if still_there <> 1 then
    raise exception 'FAIL 20a: cancelling deleted the row instead of marking it';
  end if;

  -- The freed time is immediately bookable by the same staff member, because
  -- the exclusion constraint ignores cancelled rows. Inserted as the table
  -- owner: since 0008 nobody signs in and inserts a booking directly, and what
  -- is under test here is the constraint rather than the write path.
  reset role;
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-AFTERCANCEL', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    ((test_day(201)) + time '16:00') at time zone 'Asia/Riyadh',
    ((test_day(201)) + time '16:45') at time zone 'Asia/Riyadh',
    'confirmed', 15000, 17250
  );

  raise notice 'PASS 20: cancelling keeps the record and frees the slot';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Availability (0003). The booking screen used to offer nine hardcoded times;
-- these prove the times now come from the salon's hours, the service length and
-- the appointments already in the book.
--
-- Dates are relative to today on purpose: an absolute date would silently stop
-- testing anything once it fell into the past, because available_slots() never
-- offers a time that has already gone.
-- ---------------------------------------------------------------------------

-- A second staff member, so "any professional" has capacity to count.
insert into staff (id, salon_id, name_en, name_ar, initials)
values ('dddddddd-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Noura S.', 'نورة س.', 'NS');

-- Opening hours are set up with the other fixtures at the top of this file:
-- create_booking() needs them too, and it runs long before this section.

-- ---------------------------------------------------------------------------
-- 21. A booked staff member's time is offered but marked taken, and the same
--     time stays free for a colleague.
-- ---------------------------------------------------------------------------

do $$
declare
  day        date := test_day(7);
  layla      uuid := 'dddddddd-0000-0000-0000-000000000001';
  noura      uuid := 'dddddddd-0000-0000-0000-000000000002';
  salon      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  taken      boolean;
  colleague  boolean;
begin
  insert into bookings (
    id, reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'eeeeeeee-0000-0000-0000-000000000001', 'SL-AVAIL1',
    '11111111-1111-1111-1111-111111111111', salon, layla,
    (day + time '12:00') at time zone 'Asia/Riyadh',
    (day + time '12:45') at time zone 'Asia/Riyadh',
    'confirmed', 15000, 17250
  );

  select is_free into taken from available_slots(salon, day, 45, layla)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if taken is null then
    raise exception 'FAIL 21a: the booked time was not offered at all; it should appear, greyed out';
  end if;
  if taken then
    raise exception 'FAIL 21b: a time already booked was offered as free';
  end if;

  select is_free into colleague from available_slots(salon, day, 45, noura)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if not colleague then
    raise exception 'FAIL 21c: one staff member being busy blocked another';
  end if;

  raise notice 'PASS 21: a taken time is shown taken, and only for that staff member';
end
$$;

-- ---------------------------------------------------------------------------
-- 22. An overlapping booking, not merely an identical one, takes the slot.
-- ---------------------------------------------------------------------------

do $$
declare
  day   date := test_day(7);
  layla uuid := 'dddddddd-0000-0000-0000-000000000001';
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  free  boolean;
begin
  -- 11:30 + 45 min runs to 12:15, over the 12:00 booking by a quarter hour.
  select is_free into free from available_slots(salon, day, 45, layla)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '11:30';

  if free then
    raise exception 'FAIL 22: a slot overlapping an existing booking was offered';
  end if;

  raise notice 'PASS 22: partial overlaps count as taken, not just exact matches';
end
$$;

-- ---------------------------------------------------------------------------
-- 23. Rescheduling: a booking must not collide with itself, or its own current
--     time would show as unavailable on the screen used to move it.
-- ---------------------------------------------------------------------------

do $$
declare
  day   date := test_day(7);
  layla uuid := 'dddddddd-0000-0000-0000-000000000001';
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  free  boolean;
begin
  select is_free into free
  from available_slots(salon, day, 45, layla, null, 'eeeeeeee-0000-0000-0000-000000000001')
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if not free then
    raise exception 'FAIL 23: a booking blocked its own slot while being rescheduled';
  end if;

  raise notice 'PASS 23: p_exclude_booking_id frees the appointment being moved';
end
$$;

-- ---------------------------------------------------------------------------
-- 24. Cancelling frees the time for everyone else, immediately.
-- ---------------------------------------------------------------------------

do $$
declare
  day   date := test_day(7);
  layla uuid := 'dddddddd-0000-0000-0000-000000000001';
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  free  boolean;
begin
  update bookings set status = 'cancelled', cancelled_at = now()
  where id = 'eeeeeeee-0000-0000-0000-000000000001';

  select is_free into free from available_slots(salon, day, 45, layla)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if not free then
    raise exception 'FAIL 24: a cancelled booking still held its slot';
  end if;

  update bookings set status = 'confirmed', cancelled_at = null
  where id = 'eeeeeeee-0000-0000-0000-000000000001';

  raise notice 'PASS 24: cancelling releases the time';
end
$$;

-- ---------------------------------------------------------------------------
-- 25. The salon's own opening hours are honoured, including Friday's late start.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  noura    uuid := 'dddddddd-0000-0000-0000-000000000002';
  friday   date;
  ordinary date := test_day(7);
  earliest time;
begin
  -- The next Friday that is not today, so "already passed" cannot interfere.
  select d::date into friday
  from generate_series(current_date + 1, current_date + 8, interval '1 day') d
  where extract(dow from d) = 5
  limit 1;

  select min((slot_at at time zone 'Asia/Riyadh')::time) into earliest
  from available_slots(salon, friday, 45, noura);

  if earliest <> time '14:00' then
    raise exception 'FAIL 25a: Friday opened at %, expected 14:00', earliest;
  end if;

  select min((slot_at at time zone 'Asia/Riyadh')::time) into earliest
  from available_slots(salon, ordinary, 45, noura);

  if earliest <> time '10:00' then
    raise exception 'FAIL 25b: an ordinary day opened at %, expected 10:00', earliest;
  end if;

  raise notice 'PASS 25: opening hours drive the times, Friday included';
end
$$;

-- ---------------------------------------------------------------------------
-- 26. A long service gets no slot that would run past closing time.
-- ---------------------------------------------------------------------------

do $$
declare
  salon  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  noura  uuid := 'dddddddd-0000-0000-0000-000000000002';
  day    date := test_day(7);
  latest time;
begin
  -- Four hours against a 23:00 close: nothing may start after 19:00.
  select max((slot_at at time zone 'Asia/Riyadh')::time) into latest
  from available_slots(salon, day, 240, noura);

  if latest > time '19:00' then
    raise exception 'FAIL 26: a 4-hour service was offered at %, which runs past closing', latest;
  end if;

  raise notice 'PASS 26: service length is respected against closing time';
end
$$;

-- ---------------------------------------------------------------------------
-- 27. slot_step_minutes is the salon owner's setting and actually changes the
--     grid. Opening hours are already theirs; this is the spacing.
-- ---------------------------------------------------------------------------

do $$
declare
  salon  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  noura  uuid := 'dddddddd-0000-0000-0000-000000000002';
  day    date := test_day(7);
  half   bigint;
  hourly bigint;
begin
  select count(*) into half from available_slots(salon, day, 45, noura);

  update salons set slot_step_minutes = 60 where id = salon;
  select count(*) into hourly from available_slots(salon, day, 45, noura);

  if hourly >= half then
    raise exception 'FAIL 27a: hourly spacing produced % slots, not fewer than the %  at 30 minutes', hourly, half;
  end if;

  if exists (
    select 1 from available_slots(salon, day, 45, noura)
    where extract(minute from (slot_at at time zone 'Asia/Riyadh')) <> 0
  ) then
    raise exception 'FAIL 27b: hourly spacing still offered a half-past time';
  end if;

  update salons set slot_step_minutes = 30 where id = salon;
  raise notice 'PASS 27: the salon''s slot_step_minutes sets the spacing';
end
$$;

-- ---------------------------------------------------------------------------
-- 28. "Any professional" is a capacity question, since the exclusion constraint
--     cannot cover a null staff_id. An unassigned booking holds a chair without
--     naming anyone — including against a request for the last free person.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  layla uuid := 'dddddddd-0000-0000-0000-000000000001';
  noura uuid := 'dddddddd-0000-0000-0000-000000000002';
  day   date := test_day(7);
  free  boolean;
  chairs integer;
begin
  -- Layla is already booked at 12:00 (assertion 21). One of two staff left.
  select is_free, staff_free into free, chairs
  from available_slots(salon, day, 45, null)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if not free or chairs <> 1 then
    raise exception 'FAIL 28a: one free staff member of two reported free=%, chairs=%', free, chairs;
  end if;

  -- An unassigned booking takes the remaining chair.
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-AVAIL-ANY', '22222222-2222-2222-2222-222222222222', salon, null,
    (day + time '12:00') at time zone 'Asia/Riyadh',
    (day + time '12:45') at time zone 'Asia/Riyadh',
    'confirmed', 15000, 17250
  );

  select is_free into free from available_slots(salon, day, 45, null)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if free then
    raise exception 'FAIL 28b: the salon was full but still offered "any professional"';
  end if;

  -- And naming the last person must fail too, or the salon is sold three
  -- appointments for two chairs.
  select is_free into free from available_slots(salon, day, 45, noura)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '12:00';

  if free then
    raise exception 'FAIL 28c: the one chair left was sold twice — once unassigned, once by name';
  end if;

  raise notice 'PASS 28: unassigned bookings consume capacity, by name or otherwise';
end
$$;

-- ---------------------------------------------------------------------------
-- 29. A salon-wide closure blacks out the period for everybody.
-- ---------------------------------------------------------------------------

do $$
declare
  salon  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  noura  uuid := 'dddddddd-0000-0000-0000-000000000002';
  day    date := test_day(7);
  during boolean;
  after  boolean;
begin
  insert into time_off (salon_id, staff_id, starts_at, ends_at, reason)
  values (salon, null,
          (day + time '16:00') at time zone 'Asia/Riyadh',
          (day + time '18:00') at time zone 'Asia/Riyadh',
          'Maintenance');

  select is_free into during from available_slots(salon, day, 45, noura)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '16:30';

  select is_free into after from available_slots(salon, day, 45, noura)
  where (slot_at at time zone 'Asia/Riyadh')::time = time '18:00';

  if during then
    raise exception 'FAIL 29a: a slot inside a salon-wide closure was offered';
  end if;
  if not after then
    raise exception 'FAIL 29b: the closure blocked times after it had ended';
  end if;

  raise notice 'PASS 29: salon-wide closures black out their period only';
end
$$;

-- ---------------------------------------------------------------------------
-- 30. The security definer function widened exactly one door: an anonymous
--     visitor can ask what is free, and still cannot read a single booking.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  offered bigint;
  leaked  bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  select count(*) into offered
  from available_slots(salon, test_day(7), 45, null);

  if offered = 0 then
    raise exception 'FAIL 30a: an anonymous visitor was offered no times at all';
  end if;

  select count(*) into leaked from bookings;
  if leaked <> 0 then
    raise exception 'FAIL 30b: anon read % booking rows through the open door', leaked;
  end if;
end
$$;
reset role;

do $$
begin
  raise notice 'PASS 30: anon may ask what is free, and still cannot read bookings';
end
$$;

-- ---------------------------------------------------------------------------
-- Owner-managed settings (the vendor portal's hours and booking interval).
-- These are written by the app as the signed-in owner, so the policies — not
-- the screen — are what stop one salon editing another's.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 31. An owner changes their own booking interval; the schema rejects a value
--     the booking screen could not step by.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  step  smallint;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  update salons set slot_step_minutes = 15 where id = salon;

  select slot_step_minutes into step from salons where id = salon;
  if step <> 15 then
    raise exception 'FAIL 31a: the owner''s interval did not save, got %', step;
  end if;

  begin
    update salons set slot_step_minutes = 7 where id = salon;
    raise exception 'FAIL 31b: an interval outside the allowed set was accepted';
  exception
    when check_violation then null;
  end;

  update salons set slot_step_minutes = 30 where id = salon;
end
$$;
reset role;

do $$
begin
  raise notice 'PASS 31: an owner sets their own booking interval, within the allowed steps';
end
$$;

-- ---------------------------------------------------------------------------
-- 32. A different vendor cannot change that salon's interval. The update is
--     silently filtered rather than refused, which is how RLS narrows an
--     UPDATE — so the assertion is that the value did not move.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  step  smallint;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}',
    true
  );
  set local role authenticated;

  update salons set slot_step_minutes = 60 where id = salon;

  reset role;
  select slot_step_minutes into step from salons where id = salon;
  if step <> 30 then
    raise exception 'FAIL 32: another vendor changed a salon''s interval, now %', step;
  end if;

  raise notice 'PASS 32: one salon cannot change another salon''s booking interval';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 33. An owner edits their own opening hours, and closing a day removes the
--     row — which is exactly what available_slots() reads as "not open".
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  noura    uuid := 'dddddddd-0000-0000-0000-000000000002';
  day      date := test_day(7);
  dow      smallint := extract(dow from test_day(7))::smallint;
  earliest time;
  offered  bigint;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  -- Open later than the seeded 10:00.
  delete from working_hours
    where salon_id = salon and day_of_week = dow and staff_id is null;
  insert into working_hours (salon_id, staff_id, day_of_week, opens_at, closes_at)
    values (salon, null, dow, time '13:00', time '20:00');

  reset role;
  select min((slot_at at time zone 'Asia/Riyadh')::time) into earliest
  from available_slots(salon, day, 45, noura);

  if earliest is distinct from time '13:00' then
    raise exception 'FAIL 33a: booking screen opened at %, expected the owner''s 13:00', earliest;
  end if;

  -- Now close the day entirely.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;
  delete from working_hours
    where salon_id = salon and day_of_week = dow and staff_id is null;

  reset role;
  select count(*) into offered from available_slots(salon, day, 45, noura);
  if offered <> 0 then
    raise exception 'FAIL 33b: a closed day still offered % times', offered;
  end if;

  -- Put the seeded hours back for anything that runs after this.
  insert into working_hours (salon_id, staff_id, day_of_week, opens_at, closes_at)
    values (salon, null, dow, time '10:00', time '23:00');

  raise notice 'PASS 33: an owner''s hours drive the booking screen, closures included';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 34. A vendor cannot write opening hours onto a salon they do not own —
--     the portal would otherwise be one mistaken salon id from editing
--     somebody else's week.
-- ---------------------------------------------------------------------------

do $$
declare
  other uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}',
    true
  );
  set local role authenticated;

  begin
    insert into working_hours (salon_id, staff_id, day_of_week, opens_at, closes_at)
      values (other, null, 3, time '08:00', time '09:00');
    raise exception 'FAIL 34: a vendor wrote opening hours onto another salon';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS 34: opening hours can only be written by the salon''s owner';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 35. The vendor portal's own read: an owner finds their salon by owner_id and
--     sees it even before it is published, along with their services and team.
-- ---------------------------------------------------------------------------

do $$
declare
  mine     uuid;
  services bigint;
  team     bigint;
begin
  -- Unpublish it: an owner still setting up must be able to manage their salon.
  update salons set is_published = false
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select id into mine from salons
  where owner_id = '33333333-3333-3333-3333-333333333333'
  order by created_at limit 1;

  if mine is distinct from 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'FAIL 35a: the owner could not find their own unpublished salon';
  end if;

  select count(*) into services from services where salon_id = mine and not is_archived;
  select count(*) into team     from staff    where salon_id = mine and not is_archived;

  if services = 0 or team = 0 then
    raise exception 'FAIL 35b: owner read % services and % staff on their own salon', services, team;
  end if;

  reset role;
  update salons set is_published = true
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  raise notice 'PASS 35: an owner reads their own salon, services and team before publishing';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Salon registration — the front door of the vendor side. Salons sign
-- themselves up, so these are the guarantees around that.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 36. Anyone signed in can register a salon, and it belongs to them. It is
--     created unverified and unpublished, so it is invisible to customers
--     until its commercial registration has been checked.
-- ---------------------------------------------------------------------------

do $$
declare
  newbie    uuid := '55555555-5555-5555-5555-555555555555';
  mine      uuid;
  published boolean;
  verified  boolean;
  visible   bigint;
begin
  insert into auth.users (id, phone) values (newbie, '+966500000005');

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', newbie), true);
  set local role authenticated;

  insert into salons (owner_id, slug, name_en, name_ar, cr_number)
  values (newbie, 'new-salon-test', 'New Salon', 'صالون جديد', '1010999999')
  returning id into mine;

  select is_published, is_verified into published, verified
  from salons where id = mine;

  if published or verified then
    raise exception 'FAIL 36a: a newly registered salon was already live (published=%, verified=%)',
      published, verified;
  end if;

  -- The owner can see it straight away, which is what the portal depends on.
  if not exists (select 1 from salons where owner_id = newbie) then
    raise exception 'FAIL 36b: the owner cannot see the salon they just registered';
  end if;

  reset role;
  -- An anonymous visitor carries no JWT, so the claim must go too — otherwise
  -- auth.uid() still names the owner and the policy rightly shows them their
  -- own unpublished salon.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into visible from salons where id = mine;
  if visible <> 0 then
    raise exception 'FAIL 36c: an unverified salon was visible to the public';
  end if;

  raise notice 'PASS 36: a salon registers itself, owned and hidden until verified';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 37. Registration cannot be used to create a salon in someone else's name —
--     owner_id is checked against the signed-in user, not trusted from the app.
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555"}',
    true
  );
  set local role authenticated;

  begin
    insert into salons (owner_id, slug, name_en, name_ar)
    values ('11111111-1111-1111-1111-111111111111', 'forged-salon', 'Forged', 'مزور');
    raise exception 'FAIL 37: a salon was registered in another user''s name';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS 37: a salon can only be registered for the account doing it';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 38. Verifying then publishing is what puts a salon in front of customers,
--     and the constraint refuses that order being skipped.
-- ---------------------------------------------------------------------------

do $$
declare
  mine    uuid;
  visible bigint;
begin
  select id into mine from salons where slug = 'new-salon-test';

  -- Publishing an unverified salon is refused outright.
  begin
    update salons set is_published = true where id = mine;
    raise exception 'FAIL 38a: an unverified salon was published';
  exception
    when check_violation then null;
  end;

  -- Verification is an admin act; the owner cannot self-verify into the
  -- catalogue. Done here as the table owner, which is what a human approving
  -- in the Supabase dashboard is doing.
  update salons set is_verified = true, is_published = true where id = mine;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into visible from salons where id = mine;
  if visible <> 1 then
    raise exception 'FAIL 38b: a verified, published salon was still not visible to customers';
  end if;

  raise notice 'PASS 38: a salon reaches customers only after verification, then publishing';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- The owner's own catalogue. A salon that has just registered has no services
-- and no team, so these are the writes that make a real sign-up complete.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 39. An owner builds their menu and team, and the schema holds them to the
--     same bounds the form does.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  svc   uuid;
  team  uuid;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  insert into services (salon_id, name_en, name_ar, duration_minutes, price_halalas)
  values (salon, 'Beard Trim', 'تهذيب لحية', 20, 6000)
  returning id into svc;

  insert into staff (salon_id, name_en, name_ar, role_en, role_ar, initials)
  values (salon, 'Omar K.', 'عمر ك.', 'Barber', 'حلاق', 'OK')
  returning id into team;

  if svc is null or team is null then
    raise exception 'FAIL 39a: an owner could not add a service or a team member';
  end if;

  -- A ten-second service and a 200% discount are refused by Postgres, not by
  -- the form alone.
  begin
    insert into services (salon_id, name_en, name_ar, duration_minutes, price_halalas)
    values (salon, 'Too short', 'قصير جداً', 1, 1000);
    raise exception 'FAIL 39b: a service shorter than the schema allows was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into services (salon_id, name_en, name_ar, duration_minutes, price_halalas, discount_percent)
    values (salon, 'Silly discount', 'خصم غريب', 30, 1000, 200);
    raise exception 'FAIL 39c: a discount over 100%% was accepted';
  exception
    when check_violation then null;
  end;

  raise notice 'PASS 39: an owner builds their own menu and team, within the schema''s bounds';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 40. Removing a service archives it. This is the guarantee that matters: a
--     booking made at yesterday's price must still read correctly after the
--     salon takes the service off its menu.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  svc      uuid;
  booking  uuid;
  archived boolean;
  snapshot text;
  price    integer;
  offered  bigint;
begin
  select id into svc from services where salon_id = salon and name_en = 'Beard Trim';

  -- A customer books it at today's price.
  insert into bookings (
    id, reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    gen_random_uuid(), 'SL-ARCHIVE1', '11111111-1111-1111-1111-111111111111',
    salon, null,
    ((test_day(9)) + time '15:00') at time zone 'Asia/Riyadh',
    ((test_day(9)) + time '15:20') at time zone 'Asia/Riyadh',
    'confirmed', 6000, 6900
  ) returning id into booking;

  insert into booking_items (
    booking_id, service_id, name_en, name_ar, duration_minutes, unit_price_halalas
  ) values (booking, svc, 'Beard Trim', 'تهذيب لحية', 20, 6000);

  -- The owner takes it off the menu.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;
  update services set is_archived = true, is_active = false where id = svc;
  reset role;

  select is_archived into archived from services where id = svc;
  if not archived then
    raise exception 'FAIL 40a: removing a service did not archive it';
  end if;

  -- The row survives, so the booking still points at something.
  if not exists (select 1 from services where id = svc) then
    raise exception 'FAIL 40b: the service row was destroyed, orphaning a booking';
  end if;

  select name_en, unit_price_halalas into snapshot, price
  from booking_items where booking_id = booking;

  if snapshot <> 'Beard Trim' or price <> 6000 then
    raise exception 'FAIL 40c: the booking lost its snapshot, got % at %', snapshot, price;
  end if;

  -- And customers are no longer offered it.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into offered from services where id = svc;
  if offered <> 0 then
    raise exception 'FAIL 40d: an archived service was still offered to customers';
  end if;

  raise notice 'PASS 40: removing a service archives it, and past bookings keep their prices';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 41. The Live / Hidden switch takes a service out of the customer catalogue
--     without archiving it, and the owner still sees it either way.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  svc     uuid := 'cccccccc-0000-0000-0000-000000000001';
  public_count bigint;
  owner_count  bigint;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;
  update services set is_active = false where id = svc;

  select count(*) into owner_count from services where id = svc;
  if owner_count <> 1 then
    raise exception 'FAIL 41a: an owner lost sight of their own hidden service';
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into public_count from services where id = svc;
  if public_count <> 0 then
    raise exception 'FAIL 41b: a hidden service was still shown to customers';
  end if;

  reset role;
  update services set is_active = true where id = svc;

  raise notice 'PASS 41: hiding a service removes it from the catalogue, not from the salon';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 42. One salon cannot add a service or a team member to another's.
-- ---------------------------------------------------------------------------

do $$
declare
  other uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}',
    true
  );
  set local role authenticated;

  begin
    insert into services (salon_id, name_en, name_ar, duration_minutes, price_halalas)
    values (other, 'Sneaked in', 'مُدرج', 30, 1000);
    raise exception 'FAIL 42a: a vendor added a service to another salon';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into staff (salon_id, name_en, name_ar, initials)
    values (other, 'Sneaked in', 'مُدرج', 'SI');
    raise exception 'FAIL 42b: a vendor added a team member to another salon';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS 42: a salon''s menu and team can only be changed by its owner';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- The business profile, and the line between editing a salon and approving it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 43. An owner maintains their own business details — the typo they made at
--     registration should not need a database administrator to fix.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  area  text;
  cr    text;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  update salons
  set area_en = 'Al Malaz', area_ar = 'الملز', cr_number = '1010123456',
      phone = '+966500000003'
  where id = salon;

  reset role;
  select area_en, cr_number into area, cr from salons where id = salon;

  if area <> 'Al Malaz' or cr <> '1010123456' then
    raise exception 'FAIL 43: an owner could not correct their own details, got % / %', area, cr;
  end if;

  raise notice 'PASS 43: an owner maintains their own business details';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 44. A salon cannot approve itself.
--
--     salons_update_own lets an owner write their own row, and 0002's blanket
--     UPDATE grant once covered every column — so an owner could set
--     is_verified and is_published together and walk straight into the
--     catalogue. published_salons_are_verified constrains the *order* of those
--     flags, not who may set them, so it did not help. 0004 revokes the
--     privilege at the column level, which is the only place this can be said.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  verified boolean;
begin
  update salons set is_verified = false, is_published = false where id = salon;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  begin
    update salons set is_verified = true where id = salon;
    raise exception 'FAIL 44a: an owner verified their own salon';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update salons set is_published = true where id = salon;
    raise exception 'FAIL 44b: an owner published their own salon';
  exception
    when insufficient_privilege then null;
  end;

  -- Both at once was the actual bypass: it satisfies the constraint.
  begin
    update salons set is_verified = true, is_published = true where id = salon;
    raise exception 'FAIL 44c: an owner approved and published in one statement';
  exception
    when insufficient_privilege then null;
  end;

  -- Editing everything else still works, so the block is narrow.
  update salons set name_en = 'Maison Noir' where id = salon;

  reset role;
  select is_verified into verified from salons where id = salon;
  if verified then
    raise exception 'FAIL 44d: the salon ended up verified anyway';
  end if;

  -- An admin, connecting as the table owner the way the dashboard does, still can.
  update salons set is_verified = true, is_published = true where id = salon;

  raise notice 'PASS 44: a salon cannot approve itself; only an admin can';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 45. An owner reads their own day, with the customer's name on it.
--
--     bookings_select already lets them read the appointments. The name is the
--     part that needs salon_day(): profiles_select_own hides every profile but
--     the viewer's own, so without this the calendar would show appointments
--     belonging to nobody.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  row_count integer;
  got record;
begin
  -- A named appointment and an unassigned one, on the same salon-day.
  update profiles set full_name = 'Huda A.'
    where id = '11111111-1111-1111-1111-111111111111';

  delete from bookings where salon_id = salon;

  insert into bookings (
    id, reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'eeeeeeee-0000-0000-0000-000000000045', 'SL-D001',
    '11111111-1111-1111-1111-111111111111', salon,
    'dddddddd-0000-0000-0000-000000000001',
    '2026-09-10 10:00+03', '2026-09-10 10:45+03', 'confirmed', 12000, 13800
  );

  insert into booking_items (
    booking_id, service_id, name_en, name_ar, duration_minutes, unit_price_halalas
  ) values (
    'eeeeeeee-0000-0000-0000-000000000045',
    'cccccccc-0000-0000-0000-000000000001',
    'Signature Haircut', 'قص شعر', 45, 15000
  );

  -- Customer B has never filled in a name, and asked for "any professional".
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-D002', '22222222-2222-2222-2222-222222222222', salon, null,
    '2026-09-10 12:00+03', '2026-09-10 13:00+03', 'pending', 20000, 23000
  );

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select count(*) into row_count
    from salon_day(salon, date '2026-09-10');
  if row_count <> 2 then
    raise exception 'FAIL 45a: expected both appointments, got %', row_count;
  end if;

  select * into got
    from salon_day(salon, date '2026-09-10')
    where reference = 'SL-D001';

  if got.customer_name is distinct from 'Huda A.' then
    raise exception 'FAIL 45b: the customer name did not reach the owner (%)',
      got.customer_name;
  end if;
  if got.staff_name_en is distinct from 'Layla A.' then
    raise exception 'FAIL 45c: the staff name is wrong (%)', got.staff_name_en;
  end if;
  if got.services_en <> array['Signature Haircut'] then
    raise exception 'FAIL 45d: the snapshotted service names are wrong (%)',
      got.services_en;
  end if;

  -- A blank name comes back null rather than as an empty string, so the screen
  -- can fall back to the reference instead of rendering a gap.
  select * into got
    from salon_day(salon, date '2026-09-10')
    where reference = 'SL-D002';
  if got.customer_name is not null then
    raise exception 'FAIL 45e: a blank name should be null, got %', got.customer_name;
  end if;
  -- "Any professional": nobody is assigned, and no name is invented.
  if got.staff_name_en is not null then
    raise exception 'FAIL 45f: an unassigned booking named a staff member';
  end if;
  -- A booking with no items still returns a row, with an empty list.
  if got.services_en <> '{}'::text[] then
    raise exception 'FAIL 45g: expected no services, got %', got.services_en;
  end if;

  reset role;
  raise notice 'PASS 45: an owner reads their own day, with the customer name on it';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 46. Nobody else may call it.
--
--     security definer bypasses row-level security, so the guard inside the
--     function is the whole boundary. If it were dropped, any signed-in
--     account could read any salon's diary and its customers' names — this is
--     the assertion that would catch it.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  -- The other salon's owner.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}',
    true
  );
  set local role authenticated;

  begin
    perform * from salon_day(salon, date '2026-09-10');
    raise exception 'FAIL 46a: a rival salon read this salon''s day';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform * from salon_stats(salon, date '2026-09-10');
    raise exception 'FAIL 46b: a rival salon read this salon''s figures';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform * from salon_reviews(salon);
    raise exception 'FAIL 46c: a rival salon read this salon''s reviews';
  exception
    when insufficient_privilege then null;
  end;

  -- And the customer whose booking it is — they may read their own booking,
  -- but not the salon's diary of everyone else's.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111"}',
    true
  );
  begin
    perform * from salon_day(salon, date '2026-09-10');
    raise exception 'FAIL 46d: a customer read the salon''s whole day';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'PASS 46: the owner''s day, figures and reviews are for that owner alone';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 47. An anonymous visitor cannot call these at all.
--
--     available_slots() is granted to anon on purpose — browsing is ungated.
--     These three are not, and the grant is the only thing separating them.
-- ---------------------------------------------------------------------------

do $$
begin
  set local role anon;
  begin
    perform * from salon_day('aaaaaaaa-0000-0000-0000-000000000001', date '2026-09-10');
    raise exception 'FAIL 47: an anonymous visitor read a salon''s day';
  exception
    when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'PASS 47: the vendor functions are closed to anonymous visitors';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 48. Cancelled bookings stay on the calendar but leave the figures.
--
--     A salon needs to see that somebody dropped out — that is why the row is
--     kept at all — but a cancellation is not a booking taken, is not money
--     agreed, and does not occupy a chair.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  stats record;
  listed integer;
begin
  update bookings set status = 'cancelled', cancelled_at = now()
    where reference = 'SL-D002';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select count(*) into listed from salon_day(salon, date '2026-09-10');
  if listed <> 2 then
    raise exception 'FAIL 48a: the cancelled appointment vanished from the day';
  end if;

  select * into stats from salon_stats(salon, date '2026-09-10');
  if stats.bookings_today <> 1 then
    raise exception 'FAIL 48b: the cancelled booking was counted (%)',
      stats.bookings_today;
  end if;
  if stats.booked_halalas <> 13800 then
    raise exception 'FAIL 48c: the cancelled booking was still valued (%)',
      stats.booked_halalas;
  end if;

  reset role;
  raise notice 'PASS 48: a cancellation stays on the calendar and leaves the figures';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 49. Occupancy is null on a day the salon does not open.
--
--     Dividing by a zero-length day would otherwise report 0% — which reads
--     as "open and empty" when the truth is "closed". The screen says
--     different things, so the function must distinguish them.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  stats record;
begin
  delete from working_hours where salon_id = salon;
  -- 2026-09-10 is a Thursday (dow 4). Ten open hours.
  insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
  values (salon, 4, '10:00', '20:00');

  -- Earlier assertions hired their own staff into this salon. Occupancy is a
  -- fraction of the chairs available, so pin it to the one chair this check
  -- reasons about rather than letting an unrelated fixture move the answer.
  update staff set is_archived = true
    where salon_id = salon
      and id <> 'dddddddd-0000-0000-0000-000000000001';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select * into stats from salon_stats(salon, date '2026-09-10');
  if not stats.is_open then
    raise exception 'FAIL 49a: the salon should be open on the Thursday';
  end if;
  -- 45 minutes booked out of 600 available = 8%.
  if stats.occupancy_percent <> 8 then
    raise exception 'FAIL 49b: occupancy should be 8%%, got %',
      stats.occupancy_percent;
  end if;

  -- The Friday has no hours at all.
  select * into stats from salon_stats(salon, date '2026-09-11');
  if stats.is_open then
    raise exception 'FAIL 49c: the salon should be closed on the Friday';
  end if;
  if stats.occupancy_percent is not null then
    raise exception 'FAIL 49d: a closed day reported %%% occupancy',
      stats.occupancy_percent;
  end if;

  reset role;
  raise notice 'PASS 49: occupancy is a real fraction of the open day, or nothing';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 50. Yesterday's count is the comparison the dashboard shows.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  stats record;
begin
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-D003', '22222222-2222-2222-2222-222222222222', salon,
    'dddddddd-0000-0000-0000-000000000001',
    '2026-09-09 10:00+03', '2026-09-09 11:00+03', 'confirmed', 20000, 23000
  );

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select * into stats from salon_stats(salon, date '2026-09-10');
  if stats.bookings_yesterday <> 1 then
    raise exception 'FAIL 50: yesterday''s count is wrong (%)',
      stats.bookings_yesterday;
  end if;

  reset role;
  raise notice 'PASS 50: the dashboard compares against the day before';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 51. A salon reads its own reviews, unpublished ones included, with names.
--
--     Hiding a complaint from the business it is about helps nobody, so
--     is_published is returned rather than filtered on.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  listed integer;
  got record;
begin
  -- A review must belong to a completed booking of the reviewer's own.
  update bookings set status = 'completed'
    where reference = 'SL-D001';

  insert into reviews (booking_id, salon_id, customer_id, rating, body, is_published)
  values (
    'eeeeeeee-0000-0000-0000-000000000045', salon,
    '11111111-1111-1111-1111-111111111111', 4.5, 'Lovely cut.', false
  );

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select count(*) into listed from salon_reviews(salon);
  if listed <> 1 then
    raise exception 'FAIL 51a: expected the unpublished review, got % rows', listed;
  end if;

  select * into got from salon_reviews(salon);
  if got.customer_name is distinct from 'Huda A.' then
    raise exception 'FAIL 51b: the reviewer''s name did not reach the owner (%)',
      got.customer_name;
  end if;
  if got.is_published then
    raise exception 'FAIL 51c: the review should still be unpublished';
  end if;

  reset role;
  raise notice 'PASS 51: a salon reads its own reviews, unpublished ones included';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 52. The dashboard's rating tile agrees with the customer's salon card.
--
--     salon_ratings has no row at all for a salon nobody has reviewed, so the
--     figure is null and the tile says "New" — never 0.0, which would read as
--     a terrible salon rather than a new one.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  fresh uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  stats record;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  -- The only review on this salon is still unpublished, so the public view
  -- excludes it and the owner's tile must agree.
  select * into stats from salon_stats(salon, date '2026-09-10');
  if stats.rating is not null or coalesce(stats.review_count, 0) <> 0 then
    raise exception 'FAIL 52a: an unpublished review reached the rating (%, %)',
      stats.rating, stats.review_count;
  end if;

  reset role;
  update reviews set is_published = true where salon_id = salon;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}',
    true
  );
  set local role authenticated;

  select * into stats from salon_stats(salon, date '2026-09-10');
  if stats.rating <> 4.5 or stats.review_count <> 1 then
    raise exception 'FAIL 52b: the published review is not on the tile (%, %)',
      stats.rating, stats.review_count;
  end if;

  reset role;

  -- And a salon nobody has reviewed reports nothing rather than zero.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}',
    true
  );
  set local role authenticated;

  select * into stats from salon_stats(fresh, date '2026-09-10');
  if stats.rating is not null then
    raise exception 'FAIL 52c: an unreviewed salon reported a rating of %',
      stats.rating;
  end if;

  reset role;
  raise notice 'PASS 52: the rating tile reads the same view the customer does';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 53. A customer cannot make themselves an administrator.
--
--     This is the one that mattered. is_admin() reads profiles.role, and
--     profiles_update_own lets you write your own row — so before 0006 the
--     blanket column grant meant one statement turned any customer into an
--     admin, and admin unlocks reading every profile, every booking at every
--     salon, and every unpublished salon. Confirmed by doing it before the fix.
-- ---------------------------------------------------------------------------

do $$
declare
  attacker uuid := '11111111-1111-1111-1111-111111111111';
  role_now user_role;
begin
  perform set_config('request.jwt.claims',
    format('{"sub":"%s"}', attacker), true);
  set local role authenticated;

  begin
    update profiles set role = 'admin' where id = attacker;
    raise exception 'FAIL 53a: a customer promoted themselves to admin';
  exception
    when insufficient_privilege then null;
  end;

  -- Nor by writing every column at once, which is how the salons equivalent
  -- was bypassed before 0004.
  begin
    update profiles set full_name = 'Huda A.', role = 'admin' where id = attacker;
    raise exception 'FAIL 53b: role slipped through alongside a legitimate column';
  exception
    when insufficient_privilege then null;
  end;

  -- ...and not on somebody else's row either, though the policy already said so.
  begin
    update profiles set role = 'admin'
      where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 53c: a customer promoted another account';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  select role into role_now from profiles where id = attacker;
  if role_now <> 'customer' then
    raise exception 'FAIL 53d: the account ended up % anyway', role_now;
  end if;

  raise notice 'PASS 53: a customer cannot make themselves an administrator';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 54. ...while still being able to edit what is genuinely theirs.
--
--     A fix that stopped people setting their own name or language would be no
--     fix at all: those are the only two profile columns the app writes.
-- ---------------------------------------------------------------------------

do $$
declare
  me uuid := '11111111-1111-1111-1111-111111111111';
  got record;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', me), true);
  set local role authenticated;

  update profiles set full_name = 'Huda Al-Otaibi' where id = me;
  update profiles set locale = 'ar' where id = me;
  update profiles set phone = '+966500000001', allow_whatsapp = false where id = me;

  select full_name, locale, allow_whatsapp into got from profiles where id = me;
  if got.full_name <> 'Huda Al-Otaibi' or got.locale <> 'ar' or got.allow_whatsapp then
    raise exception 'FAIL 54: the account could not edit its own details';
  end if;

  reset role;
  raise notice 'PASS 54: an account still edits its own name, language and contact preferences';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 55. A salon cannot rewrite the reviews written about it.
--
--     reviews_update lets the customer and the salon owner touch the row, but
--     they own different columns of it and a grant cannot draw that line — so
--     0006 revokes UPDATE on the table outright and grants nothing back.
--     Before it, an owner turned a 1.0 "Terrible" into a 5.0 rave, still in the
--     customer's name, and salon_ratings averaged the result.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  got record;
begin
  -- Assertion 51 left one review on this salon; make its content known.
  update reviews set rating = 1.0, body = 'Terrible. Rude staff and dirty tools.'
    where salon_id = salon;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;

  begin
    update reviews set rating = 5.0, body = 'Wonderful!' where salon_id = salon;
    raise exception 'FAIL 55a: the salon rewrote a review of itself';
  exception
    when insufficient_privilege then null;
  end;

  -- Replying is not built yet, and until it is a function it is closed too.
  begin
    update reviews set reply = 'Thanks!' where salon_id = salon;
    raise exception 'FAIL 55b: the salon wrote a reply through a raw update';
  exception
    when insufficient_privilege then null;
  end;

  -- Hiding an unflattering review is the other half of the same abuse.
  begin
    update reviews set is_published = false where salon_id = salon;
    raise exception 'FAIL 55c: the salon buried a review';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  select rating, body into got from reviews where salon_id = salon;
  if got.rating <> 1.0 or got.body <> 'Terrible. Rude staff and dirty tools.' then
    raise exception 'FAIL 55d: the review was altered anyway (% / %)', got.rating, got.body;
  end if;

  raise notice 'PASS 55: a salon cannot rewrite, bury or reply to reviews by raw update';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 56. Nobody on a booking can rewrite what it cost.
--
--     Before 0006 the customer zeroed their own subtotal and total, and the
--     owner set paid_at on a booking nobody had paid for. Today that corrupts
--     the vendor dashboard, which sums total_halalas; the day money moves it is
--     a payment bypass.
--
--     Note what this does NOT cover: the price is still stated by the client
--     when the booking is first created. Only computing it in Postgres closes
--     that — see the comment in 0006 and create_booking() on the roadmap.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  customer uuid := '22222222-2222-2222-2222-222222222222';
  owner    uuid := '33333333-3333-3333-3333-333333333333';
  booking  uuid;
  got      record;
begin
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-MONEY', customer, salon, 'dddddddd-0000-0000-0000-000000000001',
    '2026-10-01 10:00+03', '2026-10-01 11:00+03', 'confirmed', 50000, 57500
  ) returning id into booking;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', customer), true);
  set local role authenticated;

  begin
    update bookings set total_halalas = 0, subtotal_halalas = 0 where id = booking;
    raise exception 'FAIL 56a: the customer rewrote what they owe';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update bookings set paid_at = now() where id = booking;
    raise exception 'FAIL 56b: the customer marked their own booking paid';
  exception
    when insufficient_privilege then null;
  end;

  -- Moving one by hand is refused since 0015. It was granted in 0006 because
  -- rescheduling was an UPDATE from the browser; 0008 made it a function and
  -- the grant outlived its use, which let a customer stretch a booking across
  -- a whole day and hold the chair. reschedule_booking() is the way now, and
  -- assertion 68 covers that it still works.
  begin
    update bookings set ends_at = '2026-10-01 22:00+03' where id = booking;
    raise exception 'FAIL 56h: the customer stretched their booking to hold the chair';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update bookings set staff_id = 'dddddddd-0000-0000-0000-000000000001' where id = booking;
    raise exception 'FAIL 56i: the customer chose the chair their booking occupies';
  exception
    when insufficient_privilege then null;
  end;

  -- Calling it off must still work: it is the one booking update the app still
  -- makes directly.
  update bookings set status = 'cancelled', cancelled_at = now() where id = booking;

  reset role;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', owner), true);
  set local role authenticated;

  begin
    update bookings set paid_at = now() where id = booking;
    raise exception 'FAIL 56c: the salon marked an unpaid booking paid';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update bookings set total_halalas = 99999 where id = booking;
    raise exception 'FAIL 56d: the salon inflated a booking after the fact';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  select subtotal_halalas, total_halalas, paid_at, status, starts_at, ends_at
    into got from bookings where id = booking;
  if got.ends_at <> '2026-10-01 11:00+03'::timestamptz then
    raise exception 'FAIL 56j: the booking ended up longer than it was made (%)', got.ends_at;
  end if;
  if got.subtotal_halalas <> 50000 or got.total_halalas <> 57500 then
    raise exception 'FAIL 56e: the price changed anyway (% / %)',
      got.subtotal_halalas, got.total_halalas;
  end if;
  if got.paid_at is not null then
    raise exception 'FAIL 56f: the booking ended up marked paid';
  end if;
  if got.status <> 'cancelled' then
    raise exception 'FAIL 56g: the customer could no longer cancel';
  end if;

  raise notice 'PASS 56: a booking''s money, hours and chair are all fixed once made; cancelling still works';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 57. A customer cannot mark their own booking completed.
--
--     reviews_insert_after_visit decides who has earned the right to review by
--     reading `status = 'completed'`. A customer who can set that reviews a
--     salon they never visited — guarantee 5 failing quietly. A grant can
--     restrict which column you write, not which value, so this is a trigger.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  customer uuid := '22222222-2222-2222-2222-222222222222';
  owner    uuid := '33333333-3333-3333-3333-333333333333';
  booking  uuid;
  final    booking_status;
begin
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-STATUS', customer, salon, 'dddddddd-0000-0000-0000-000000000001',
    '2026-10-02 10:00+03', '2026-10-02 11:00+03', 'confirmed', 50000, 57500
  ) returning id into booking;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', customer), true);
  set local role authenticated;

  begin
    update bookings set status = 'completed' where id = booking;
    raise exception 'FAIL 57a: a customer marked their own booking completed';
  exception
    when insufficient_privilege then null;
  end;

  -- Nor any other part of the salon's lifecycle.
  begin
    update bookings set status = 'no_show' where id = booking;
    raise exception 'FAIL 57b: a customer marked their own booking a no-show';
  exception
    when insufficient_privilege then null;
  end;

  -- Cancelling is theirs, and still works.
  update bookings set status = 'cancelled' where id = booking;

  -- But not un-cancelling: the record of what happened is not theirs to redo.
  begin
    update bookings set status = 'confirmed' where id = booking;
    raise exception 'FAIL 57c: a customer reinstated a cancelled booking';
  exception
    when insufficient_privilege then null;
  end;

  reset role;

  -- The salon runs the appointment, so the lifecycle is theirs.
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', owner), true);
  set local role authenticated;
  update bookings set status = 'confirmed'   where id = booking;
  update bookings set status = 'in_progress' where id = booking;
  update bookings set status = 'completed'   where id = booking;
  reset role;

  select status into final from bookings where id = booking;
  if final <> 'completed' then
    raise exception 'FAIL 57d: the salon could not run its own appointment (%)', final;
  end if;

  raise notice 'PASS 57: only the salon may complete a booking; the customer may only cancel';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 58. An admin is still not locked out.
--
--     0004 deliberately left the Supabase dashboard working, because approving
--     a salon has to happen somewhere. The status trigger keeps that door open
--     the same way: no JWT means service_role, and it passes straight through.
-- ---------------------------------------------------------------------------

do $$
declare
  booking uuid;
  final   booking_status;
begin
  select id into booking from bookings where reference = 'SL-STATUS';

  -- No request.jwt.claims set: this is how the dashboard connects.
  perform set_config('request.jwt.claims', '', true);
  update bookings set status = 'no_show' where id = booking;

  select status into final from bookings where id = booking;
  if final <> 'no_show' then
    raise exception 'FAIL 58: an admin could not correct a status (%)', final;
  end if;

  raise notice 'PASS 58: the dashboard can still correct a booking';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 59. A salon answers a review of itself, and touches nothing else.
--
--     0006 left reviews with no UPDATE privilege at all, so replying can only
--     happen through reply_to_review(). The function is security definer, which
--     means its own guard is the entire boundary — the same shape as the 0005
--     functions, and asserted the same way.
-- ---------------------------------------------------------------------------

do $$
declare
  salon  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  review uuid;
  got    record;
begin
  select id into review from reviews where salon_id = salon;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;

  perform reply_to_review(review, '  We are sorry, and we have retrained the team.  ');

  reset role;
  select rating, body, reply, replied_at into got from reviews where id = review;

  if got.reply <> 'We are sorry, and we have retrained the team.' then
    raise exception 'FAIL 59a: the reply was not stored (%)', got.reply;
  end if;
  if got.replied_at is null then
    raise exception 'FAIL 59b: a reply was stored without a timestamp';
  end if;

  -- 55 set these; the function must not have been able to reach them.
  if got.rating <> 1.0 or got.body <> 'Terrible. Rude staff and dirty tools.' then
    raise exception 'FAIL 59c: replying altered the customer''s own words (% / %)',
      got.rating, got.body;
  end if;

  -- Clearing the reply clears the timestamp, so the two cannot disagree.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  perform reply_to_review(review, '');
  reset role;

  select reply, replied_at into got from reviews where id = review;
  if got.reply <> '' or got.replied_at is not null then
    raise exception 'FAIL 59d: clearing the reply left a timestamp behind';
  end if;

  raise notice 'PASS 59: a salon answers a review of itself, and can change nothing else about it';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 60. Nobody else may answer it.
--
--     If the guard inside the function were dropped, any signed-in account
--     could put words in any salon's mouth. This is the assertion that catches
--     that.
-- ---------------------------------------------------------------------------

do $$
declare
  salon  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  review uuid;
begin
  select id into review from reviews where salon_id = salon;

  -- The rival salon.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  begin
    perform reply_to_review(review, 'Their tools really are dirty.');
    raise exception 'FAIL 60a: a rival salon replied to this salon''s review';
  exception
    when insufficient_privilege then null;
  end;

  -- The customer who wrote it. Editing their own review is a different job and
  -- is not this function.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  begin
    perform reply_to_review(review, 'Actually it was fine.');
    raise exception 'FAIL 60b: the customer wrote the salon''s reply';
  exception
    when insufficient_privilege then null;
  end;

  -- A review that does not exist answers exactly like one that is not yours,
  -- so the function cannot be used to find out which reviews are real.
  begin
    perform reply_to_review('00000000-0000-0000-0000-000000000000', 'hello');
    raise exception 'FAIL 60c: a missing review answered differently';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'PASS 60: only the salon a review is about may answer it';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 61. The salon runs the appointment; reassigning cannot double-book.
--
--     Phase 1 lets an owner confirm, complete, cancel, no-show and reassign
--     from the calendar. The status half is 0006's trigger (57); this is the
--     other half — moving an appointment to a staff member who is already busy
--     must be refused by the exclusion constraint rather than quietly accepted.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner    uuid := '33333333-3333-3333-3333-333333333333';
  layla    uuid := 'dddddddd-0000-0000-0000-000000000001';
  omar     uuid;
  first_b  uuid;
  second_b uuid;
  final    booking_status;
begin
  insert into staff (salon_id, name_en, name_ar, initials)
  values (salon, 'Omar K.', 'عمر ك.', 'OK') returning id into omar;

  -- Two appointments at the same time, on different people.
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-REA1', '11111111-1111-1111-1111-111111111111', salon, layla,
          '2026-11-01 10:00+03', '2026-11-01 11:00+03', 'confirmed', 10000, 11500)
  returning id into first_b;

  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-REA2', '22222222-2222-2222-2222-222222222222', salon, omar,
          '2026-11-01 10:00+03', '2026-11-01 11:00+03', 'confirmed', 10000, 11500)
  returning id into second_b;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', owner), true);
  set local role authenticated;

  -- Reassigning goes through the function since 0015: the column itself is no
  -- longer writable, because the same grant let a *customer* move their booking
  -- onto another salon's stylist.
  begin
    update bookings set staff_id = layla where id = second_b;
    raise exception 'FAIL 61a: the chair is still writable by hand';
  exception
    when insufficient_privilege then null;
  end;

  -- Moving the second onto Layla would put her in two chairs at once.
  begin
    perform reassign_appointment(second_b, layla);
    raise exception 'FAIL 61b: reassigning double-booked a staff member';
  exception
    when exclusion_violation then null;
  end;

  -- Freeing the slot first makes the same move legitimate.
  update bookings set status = 'cancelled', cancelled_at = now() where id = first_b;
  perform reassign_appointment(second_b, layla);

  -- And the salon may run the appointment through to the end.
  update bookings set status = 'in_progress' where id = second_b;
  update bookings set status = 'completed'   where id = second_b;

  reset role;
  select status into final from bookings where id = second_b;
  if final <> 'completed' then
    raise exception 'FAIL 61c: the salon could not complete its own appointment (%)', final;
  end if;

  raise notice 'PASS 61: a salon runs its own appointments, and reassigning cannot double-book';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- create_booking() and reschedule_booking() (0008).
--
-- Assertion 49 cut this salon back to one weekday to test a closed day, and
-- create_booking() refuses a time the salon is not open for — so the week goes
-- back before any of these run.
-- ---------------------------------------------------------------------------

delete from working_hours where salon_id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', d, time '10:00', time '23:00'
from generate_series(0, 6) d where d <> 5;
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 5, time '14:00', time '23:00');

-- Assertion 49 also archived the rest of the team to pin occupancy to one
-- chair. Two are needed here, so "any professional" has somewhere to go.
update staff set is_active = true, is_archived = false
where id in ('dddddddd-0000-0000-0000-000000000001',
             'dddddddd-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- 62. Two people cannot both take the last chair through "any professional".
--
--     THE race this whole migration exists for, open since 0001. With staff_id
--     null the exclusion constraint has nobody to compare against, so both
--     bookings were written and the salon was oversold. create_booking()
--     assigns a chair before inserting, which is what brings the constraint to
--     bear — and when the chairs run out there is simply nobody to assign.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  day      date := test_day(210);
  at_time  timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  taken    integer;
  who      uuid[];
begin
  -- Exactly two people can work, so the third booking has nowhere to go.
  update staff set is_active = false, is_archived = true
   where salon_id = salon
     and id not in ('dddddddd-0000-0000-0000-000000000001',
                    'dddddddd-0000-0000-0000-000000000002');

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  perform create_booking(salon, null, array[service]::uuid[], at_time, 'cash');
  reset role;

  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  perform create_booking(salon, null, array[service]::uuid[], at_time, 'cash');
  reset role;

  -- Both fitted, on different people.
  select count(*), array_agg(distinct staff_id) into taken, who
  from bookings
  where salon_id = salon and starts_at = at_time
    and status in ('pending', 'confirmed', 'in_progress');

  if taken <> 2 then
    raise exception 'FAIL 62a: expected two bookings to fit, got %', taken;
  end if;
  if array_length(who, 1) <> 2 or who @> array[null]::uuid[] then
    raise exception 'FAIL 62b: they were not given different staff (%)', who;
  end if;

  -- The third has nobody left, and must be refused rather than oversold.
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  begin
    perform create_booking(salon, null, array[service]::uuid[], at_time, 'cash');
    raise exception 'FAIL 62c: a third booking was accepted with no chair free';
  exception
    when sqlstate 'SL003' then null;
  end;
  reset role;

  select count(*) into taken
  from bookings
  where salon_id = salon and starts_at = at_time
    and status in ('pending', 'confirmed', 'in_progress');
  if taken <> 2 then
    raise exception 'FAIL 62d: the salon ended up oversold (% bookings)', taken;
  end if;

  raise notice 'PASS 62: "any professional" can no longer oversell the salon';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 63. An unnamed booking goes to whoever has least on that day.
--
--     The alternative — first by sort order — piles every unnamed booking onto
--     one person until they are full.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  layla   uuid := 'dddddddd-0000-0000-0000-000000000001';
  noura   uuid := 'dddddddd-0000-0000-0000-000000000002';
  day     date := test_day(211);
  chosen  uuid;
begin
  -- Layla already has one that morning; Noura has nothing.
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-LOAD1', '11111111-1111-1111-1111-111111111111', salon, layla,
          (day + time '10:00') at time zone 'Asia/Riyadh',
          (day + time '10:45') at time zone 'Asia/Riyadh',
          'confirmed', 1000, 1150);

  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  select f.staff_id into chosen from create_booking(
    salon, null, array[service]::uuid[],
    (day + time '15:00') at time zone 'Asia/Riyadh', 'cash') f;
  reset role;

  if chosen <> noura then
    raise exception 'FAIL 63: the busier staff member was given the booking';
  end if;

  raise notice 'PASS 63: an unnamed booking goes to whoever has least on that day';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 64. Naming somebody is honoured, and recorded — and refused if they are busy.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  layla    uuid := 'dddddddd-0000-0000-0000-000000000001';
  day      date := test_day(212);
  at_time  timestamptz := (day + time '16:00') at time zone 'Asia/Riyadh';
  made     record;
  asked    boolean;
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select * into made from create_booking(salon, layla, array[service]::uuid[], at_time, 'cash');
  reset role;

  if made.staff_id <> layla then
    raise exception 'FAIL 64a: the named specialist was not the one booked';
  end if;
  select staff_requested into asked from bookings where id = made.booking_id;
  if not asked then
    raise exception 'FAIL 64b: naming somebody was not recorded';
  end if;

  -- She is now busy, so asking for her again is refused rather than quietly
  -- handed to a colleague.
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  begin
    perform create_booking(salon, layla, array[service]::uuid[], at_time, 'cash');
    raise exception 'FAIL 64c: a busy specialist was booked twice';
  exception
    when sqlstate 'SL003' then null;
  end;
  reset role;

  raise notice 'PASS 64: naming a specialist is honoured, recorded, and refused when busy';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 65. The caller can no longer state a price, or write a booking at all.
--
--     0006 stopped a price being edited. This is the other half: creating one
--     is not something a browser can do any more, so there is no moment at
--     which a total is taken on trust.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  begin
    insert into bookings (reference, customer_id, salon_id, starts_at, ends_at,
                          subtotal_halalas, total_halalas)
    values ('SL-FREE', '11111111-1111-1111-1111-111111111111', salon,
            (test_day(213) + time '10:00') at time zone 'Asia/Riyadh',
            (test_day(213) + time '10:45') at time zone 'Asia/Riyadh',
            0, 0);
    raise exception 'FAIL 65a: a customer wrote their own booking, priced at zero';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into booking_items (booking_id, name_en, name_ar, duration_minutes,
                               unit_price_halalas)
    values ((select id from bookings limit 1), 'x', 'x', 30, 0);
    raise exception 'FAIL 65b: a customer wrote a line item directly';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'PASS 65: only create_booking() can bring a booking into existence';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 66. A booking and its items are written together or not at all.
--
--     They used to be two round trips with a compensating delete between them,
--     and the compensation could itself fail — leaving a booking with no
--     services on it and no price anybody could explain.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  before_count integer;
  after_count  integer;
  orphans      integer;
begin
  select count(*) into before_count from bookings;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  -- One real service and one that belongs to nobody.
  begin
    perform create_booking(
      salon, null,
      array[service, '00000000-0000-0000-0000-000000000000']::uuid[],
      (test_day(214) + time '15:00') at time zone 'Asia/Riyadh', 'cash');
    raise exception 'FAIL 66a: a booking was made with a service that does not exist';
  exception
    when sqlstate 'SL001' then null;
  end;

  -- A hidden service is refused the same way, so a customer cannot book
  -- something the salon has taken off its menu. Hidden as the table owner: a
  -- customer cannot edit a salon's services, and services_write would filter
  -- the update to nothing rather than fail, quietly making this prove nothing.
  reset role;
  update services set is_active = false where id = service;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  begin
    perform create_booking(salon, null, array[service]::uuid[],
      (test_day(214) + time '16:00') at time zone 'Asia/Riyadh', 'cash');
    raise exception 'FAIL 66b: a hidden service was bookable';
  exception
    when sqlstate 'SL001' then null;
  end;
  reset role;
  update services set is_active = true where id = service;

  select count(*) into after_count from bookings;
  if after_count <> before_count then
    raise exception 'FAIL 66c: a failed booking left % row(s) behind',
      after_count - before_count;
  end if;

  -- Every booking the function has made carries its services. Matched on the
  -- reference it generates, because assertions elsewhere insert bare fixture
  -- bookings as the table owner and those are not what is under test here.
  select count(*) into orphans from bookings b
  where b.reference ~ '^SL-[0-9A-F]{8}$'
    and not exists (select 1 from booking_items i where i.booking_id = b.id);
  if orphans > 0 then
    raise exception 'FAIL 66d: % booking(s) exist with no services on them', orphans;
  end if;

  raise notice 'PASS 66: a booking that cannot be completed leaves nothing behind';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 67. The salon's opening hours bound what can be booked, not just what is
--     offered. available_slots() never offers a time outside them; this is what
--     stops somebody calling the API directly and taking one anyway.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  day     date := test_day(215);
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  -- Long before it opens.
  begin
    perform create_booking(salon, null, array[service]::uuid[],
      (day + time '06:00') at time zone 'Asia/Riyadh', 'cash');
    raise exception 'FAIL 67a: booked before the salon opens';
  exception
    when sqlstate 'SL002' then null;
  end;

  -- Starts inside the day but would run past closing.
  begin
    perform create_booking(salon, null, array[service]::uuid[],
      (day + time '22:45') at time zone 'Asia/Riyadh', 'cash');
    raise exception 'FAIL 67b: booked an appointment that runs past closing';
  exception
    when sqlstate 'SL002' then null;
  end;

  -- And the past is not bookable at all.
  begin
    perform create_booking(salon, null, array[service]::uuid[],
      (current_date - 1 + time '11:00') at time zone 'Asia/Riyadh', 'cash');
    raise exception 'FAIL 67c: booked a time that has already passed';
  exception
    when sqlstate 'SL002' then null;
  end;

  reset role;
  raise notice 'PASS 67: opening hours bound what can be booked, not just what is offered';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 68. Rescheduling re-picks for a booking nobody asked for, keeps the person
--     for one they did, and never touches the money.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  layla    uuid := 'dddddddd-0000-0000-0000-000000000001';
  noura    uuid := 'dddddddd-0000-0000-0000-000000000002';
  day      date := test_day(216);
  target   timestamptz := (day + time '17:00') at time zone 'Asia/Riyadh';
  loose    record;
  firm     record;
  paid     integer;
  landed   uuid;
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  -- One booked without naming anyone, one that asked for Layla.
  select * into loose from create_booking(salon, null, array[service]::uuid[],
    (day + time '15:00') at time zone 'Asia/Riyadh', 'cash');
  select * into firm  from create_booking(salon, layla, array[service]::uuid[],
    (day + time '16:00') at time zone 'Asia/Riyadh', 'cash');
  reset role;

  -- Block the target time for whoever the loose booking landed on, so moving it
  -- there has to find somebody else.
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  select 'SL-BLOCK', '22222222-2222-2222-2222-222222222222', salon, b.staff_id,
         target, target + interval '45 minutes', 'confirmed', 1000, 1150
  from bookings b where b.id = loose.booking_id;

  select total_halalas into paid from bookings where id = loose.booking_id;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select r.staff_id into landed from reschedule_booking(loose.booking_id, target) r;

  if landed is null then
    raise exception 'FAIL 68a: an unrequested booking could not be moved';
  end if;
  if landed not in (layla, noura) then
    raise exception 'FAIL 68b: it landed on somebody who does not work here';
  end if;

  -- The person it was blocked against must not be the one it landed on.
  if exists (select 1 from bookings where reference = 'SL-BLOCK' and staff_id = landed) then
    raise exception 'FAIL 68c: it was moved onto somebody already busy';
  end if;

  -- Asking for Layla means Layla. Moving that booking onto the hour she is
  -- already working must fail rather than quietly hand it to a colleague.
  begin
    perform reschedule_booking(firm.booking_id,
      (select starts_at from bookings where id = loose.booking_id));
    raise exception 'FAIL 68d: a requested specialist was silently swapped';
  exception
    when sqlstate 'SL003' then null;
  end;
  reset role;

  if (select total_halalas from bookings where id = loose.booking_id) <> paid then
    raise exception 'FAIL 68e: moving the booking changed what it cost';
  end if;

  raise notice 'PASS 68: rescheduling re-picks when nobody was asked for, and keeps them when they were';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 69. What the customer asked for is not theirs to rewrite afterwards.
-- ---------------------------------------------------------------------------

do $$
declare
  booking uuid;
begin
  select id into booking from bookings
  where customer_id = '11111111-1111-1111-1111-111111111111'
  order by created_at desc limit 1;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  begin
    update bookings set staff_requested = true where id = booking;
    raise exception 'FAIL 69: staff_requested was rewritten after the booking';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 69: what the customer asked for is recorded once and not edited';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- The waitlist (0009).
--
-- Holds are 15 minutes and nothing runs on a schedule, so these move
-- expires_at directly rather than waiting — the behaviour under test is what
-- happens when a hold has lapsed, not how long a minute is.
-- ---------------------------------------------------------------------------

-- 70. A cancellation offers the freed seat to whoever has waited longest.

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  day      date := test_day(300);
  at_time  timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  booking  uuid;
  first_e  uuid;
  second_e uuid;
  held     uuid;
begin
  -- Somebody has the slot, and two people are waiting for that day. The second
  -- joins later, so the first must be asked first.
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-WL1', '44444444-4444-4444-4444-444444444444', salon,
          'dddddddd-0000-0000-0000-000000000001',
          at_time, at_time + interval '45 minutes', 'confirmed', 15000, 17250)
  returning id into booking;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select w.entry_id into first_e from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  select w.entry_id into second_e from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  -- Make the order unambiguous rather than relying on clock resolution.
  update waitlist_entries set created_at = now() - interval '2 hours' where id = first_e;
  update waitlist_entries set created_at = now() - interval '1 hour'  where id = second_e;

  -- The salon cancels, which is the real path — and the one 0006's status
  -- trigger permits. Nothing in it knows the waitlist exists.
  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  update bookings set status = 'cancelled', cancelled_at = now() where id = booking;
  reset role;

  select o.entry_id into held from waitlist_offers o where o.starts_at = at_time;
  if held is distinct from first_e then
    raise exception 'FAIL 70a: the seat went to the wrong person';
  end if;
  if (select count(*) from waitlist_offers where starts_at = at_time) <> 1 then
    raise exception 'FAIL 70b: it was offered to more than one person at once';
  end if;
  if (select status from waitlist_entries where id = first_e) <> 'offered' then
    raise exception 'FAIL 70c: the entry was not marked as holding the seat';
  end if;
  if (select status from waitlist_entries where id = second_e) <> 'waiting' then
    raise exception 'FAIL 70d: the second person was disturbed';
  end if;

  perform set_config('saloni.wl_slot', at_time::text, false);
  perform set_config('saloni.wl_first', first_e::text, false);
  perform set_config('saloni.wl_second', second_e::text, false);

  raise notice 'PASS 70: a cancellation offers the freed seat to whoever waited longest';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 71. A lapsed hold passes to the next person, and never back to the first.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  first_e  uuid := current_setting('saloni.wl_first')::uuid;
  second_e uuid := current_setting('saloni.wl_second')::uuid;
  at_time  timestamptz := current_setting('saloni.wl_slot')::timestamptz;
  held     uuid;
begin
  -- The 15 minutes run out.
  -- Wind the hold back rather than waiting out fifteen real minutes. Both
  -- timestamps move, because offer_expires_after_offer keeps them in order.
  update waitlist_offers
     set offered_at = now() - interval '20 minutes',
         expires_at = now() - interval '5 minutes'
   where starts_at = at_time and claimed_at is null;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  perform salon_waitlist(salon);          -- reading is what sweeps
  reset role;

  select o.entry_id into held from waitlist_offers o
   where o.starts_at = at_time and o.expires_at > now();
  if held is distinct from second_e then
    raise exception 'FAIL 71a: the seat did not pass to the next in the queue';
  end if;

  -- The first person is back in the queue for other slots, but must not be
  -- offered this one again.
  if (select status from waitlist_entries where id = first_e) <> 'waiting' then
    raise exception 'FAIL 71b: the lapsed holder was left marked as holding';
  end if;
  if (select count(*) from waitlist_offers where starts_at = at_time and entry_id = first_e) <> 1 then
    raise exception 'FAIL 71c: the same slot was offered to the same person twice';
  end if;

  raise notice 'PASS 71: a lapsed hold passes on, and nobody gets the same slot twice';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 72. Once everybody has had a turn, the slot is open to all of them.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  first_e  uuid := current_setting('saloni.wl_first')::uuid;
  at_time  timestamptz := current_setting('saloni.wl_slot')::timestamptz;
  mine     record;
begin
  -- The second person's hold lapses too, so both have now been asked.
  -- Wind the hold back rather than waiting out fifteen real minutes. Both
  -- timestamps move, because offer_expires_after_offer keeps them in order.
  update waitlist_offers
     set offered_at = now() - interval '20 minutes',
         expires_at = now() - interval '5 minutes'
   where starts_at = at_time and claimed_at is null;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select * into mine from my_waitlist() where entry_id = first_e;
  reset role;

  if mine.offer_id is null then
    raise exception 'FAIL 72a: the first person cannot see the slot at all';
  end if;
  if not mine.claimable then
    raise exception 'FAIL 72b: nobody was left to ask, but the slot is not open to them';
  end if;

  raise notice 'PASS 72: when everybody has had a turn the slot opens to all of them';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 73. Claiming makes a real booking, and only once.
-- ---------------------------------------------------------------------------

do $$
declare
  first_e  uuid := current_setting('saloni.wl_first')::uuid;
  second_e uuid := current_setting('saloni.wl_second')::uuid;
  at_time  timestamptz := current_setting('saloni.wl_slot')::timestamptz;
  offer_1  uuid;
  offer_2  uuid;
  got      record;
  priced   record;
begin
  select id into offer_1 from waitlist_offers where entry_id = first_e and starts_at = at_time;
  select id into offer_2 from waitlist_offers where entry_id = second_e and starts_at = at_time;

  -- One chair, so the claim genuinely takes the last of them. With two free
  -- the second claim below would rightly succeed and prove nothing.
  update staff set is_active = false, is_archived = true
   where id = 'dddddddd-0000-0000-0000-000000000002';

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select * into got from claim_waitlist_offer(offer_1);
  reset role;

  select b.reference, b.starts_at, b.customer_id, b.staff_id, b.total_halalas,
         count(i.*) as items
    into priced
  from bookings b join booking_items i on i.booking_id = b.id
  where b.id = got.booking_id
  group by b.reference, b.starts_at, b.customer_id, b.staff_id, b.total_halalas;

  if priced.starts_at <> at_time then
    raise exception 'FAIL 73a: the booking is not at the offered time';
  end if;
  if priced.customer_id <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FAIL 73b: the booking belongs to somebody else';
  end if;
  -- Priced and staffed like any other booking, not a lesser kind.
  if priced.total_halalas <= 0 or priced.staff_id is null or priced.items < 1 then
    raise exception 'FAIL 73c: the claimed booking is not a real one (% / % / %)',
      priced.total_halalas, priced.staff_id, priced.items;
  end if;
  if (select status from waitlist_entries where id = first_e) <> 'claimed' then
    raise exception 'FAIL 73d: the entry was not closed off';
  end if;

  -- Claiming the same offer again is refused outright.
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  begin
    perform claim_waitlist_offer(offer_1);
    raise exception 'FAIL 73e: the same offer was claimed twice';
  exception
    when sqlstate 'SL012' then null;
  end;
  reset role;

  -- And the second person is now too late: the chair is gone, so they are told
  -- rather than the salon being double-booked.
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  begin
    perform claim_waitlist_offer(offer_2);
    raise exception 'FAIL 73f: a claim went through with no chair free';
  exception
    when sqlstate 'SL003' then null;
  end;
  reset role;

  -- Put the team back for the assertions that follow.
  update staff set is_active = true, is_archived = false
   where id = 'dddddddd-0000-0000-0000-000000000002';

  raise notice 'PASS 73: claiming makes a real, priced booking, and only the first one wins';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 74. Extending is offered only when nobody is queued behind.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  day     date := test_day(301);
  at_time timestamptz := (day + time '16:00') at time zone 'Asia/Riyadh';
  booking uuid;
  e1      uuid;
  e2      uuid;
  offer   uuid;
  before  timestamptz;
  after_  timestamptz;
  row_    record;
begin
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-WL2', '44444444-4444-4444-4444-444444444444', salon,
          'dddddddd-0000-0000-0000-000000000001',
          at_time, at_time + interval '45 minutes', 'confirmed', 15000, 17250)
  returning id into booking;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select w.entry_id into e1 from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  select w.entry_id into e2 from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;
  update waitlist_entries set created_at = now() - interval '2 hours' where id = e1;
  update waitlist_entries set created_at = now() - interval '1 hour'  where id = e2;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  update bookings set status = 'cancelled', cancelled_at = now() where id = booking;
  reset role;
  select id, expires_at into offer, before from waitlist_offers where starts_at = at_time;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;

  -- Somebody is queued behind, so it passes on rather than being held longer.
  begin
    perform extend_waitlist_offer(offer, 15);
    raise exception 'FAIL 74a: extended a hold while somebody was queued behind';
  exception
    when sqlstate 'SL013' then null;
  end;

  -- The screen must not offer a button that would be refused.
  select * into row_ from salon_waitlist(salon) where entry_id = e1;
  if row_.can_extend then
    raise exception 'FAIL 74b: the screen offered Extend with a queue behind';
  end if;
  reset role;

  -- The person behind leaves, so there is nobody left to pass it to.
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  perform leave_waitlist(e2);
  reset role;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  select extend_waitlist_offer(offer, 20) into after_;
  select * into row_ from salon_waitlist(salon) where entry_id = e1;
  reset role;

  if after_ <= before then
    raise exception 'FAIL 74c: the hold was not extended (% -> %)', before, after_;
  end if;
  if not row_.can_extend then
    raise exception 'FAIL 74d: Extend is still hidden with nobody queued behind';
  end if;

  raise notice 'PASS 74: a hold can be extended only when nobody is waiting behind';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 75. The queue is not something a customer can write themselves into.
--
--     created_at decides position, so an account able to insert its own row
--     could insert itself at the front of it. status is writable too, which
--     would let it hold a seat nobody offered.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  day     date := test_day(302);
  mine    uuid;
  theirs  uuid;
begin
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select w.entry_id into mine from join_waitlist(salon, array[service]::uuid[], day) w;

  begin
    insert into waitlist_entries (customer_id, salon_id, service_id, requested_date, created_at)
    values ('11111111-1111-1111-1111-111111111111', salon, service,
            test_day(303), now() - interval '10 years');
    raise exception 'FAIL 75a: a customer wrote themselves to the front of the queue';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update waitlist_entries set status = 'offered' where id = mine;
    raise exception 'FAIL 75b: a customer marked themselves as holding a seat';
  exception
    when insufficient_privilege then null;
  end;

  -- Joining twice for the same salon and day is refused, in its own words.
  begin
    perform join_waitlist(salon, array[service]::uuid[], day);
    raise exception 'FAIL 75c: joined the same day twice';
  exception
    when sqlstate 'SL011' then null;
  end;
  reset role;

  -- Somebody else's entry is invisible, and cannot be left on their behalf.
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  if exists (select 1 from my_waitlist() where entry_id = mine) then
    raise exception 'FAIL 75d: another customer''s waitlist entry was visible';
  end if;
  begin
    perform leave_waitlist(mine);
    raise exception 'FAIL 75e: another customer removed somebody from the queue';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  -- And a rival salon cannot read the queue at all.
  perform auth.login_as('44444444-4444-4444-4444-444444444444');
  set local role authenticated;
  begin
    perform salon_waitlist(salon);
    raise exception 'FAIL 75f: a rival salon read this salon''s waitlist';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 75: the queue is the database''s to order, not the customer''s';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 76. Who is not offered a freed seat: the wrong day, and outside the window
--     the customer said they would accept.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  day     date := test_day(304);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  booking uuid;
  evening uuid;
  wrongday uuid;
  gone     uuid;
  offered  integer;
begin
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-WL3', '44444444-4444-4444-4444-444444444444', salon,
          'dddddddd-0000-0000-0000-000000000001',
          at_time, at_time + interval '45 minutes', 'confirmed', 15000, 17250)
  returning id into booking;

  -- Only wants the evening.
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  select w.entry_id into evening
  from join_waitlist(salon, array[service]::uuid[], day, time '18:00', time '22:00') w;
  reset role;

  -- Wants a different day entirely.
  perform auth.login_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  select w.entry_id into wrongday
  from join_waitlist(salon, array[service]::uuid[], day + 1) w;
  reset role;

  -- Joined, then changed their mind.
  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  select w.entry_id into gone from join_waitlist(salon, array[service]::uuid[], day) w;
  perform leave_waitlist(gone);
  reset role;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  update bookings set status = 'cancelled', cancelled_at = now() where id = booking;
  reset role;

  select count(*) into offered from waitlist_offers where starts_at = at_time;
  if offered <> 0 then
    raise exception 'FAIL 76: % offer(s) went to people who did not want that slot', offered;
  end if;

  raise notice 'PASS 76: a freed seat is not offered to people who did not ask for it';
end
$$;
reset role;


-- ---------------------------------------------------------------------------
-- Notification fixtures. Separate people from the customers above, whose
-- preferences other assertions have already changed.
-- ---------------------------------------------------------------------------

insert into auth.users (id, phone) values
  ('a1111111-0000-0000-0000-00000000000a', '+966555000001'),  -- installed, wants notifying
  ('a2222222-0000-0000-0000-00000000000b', '+966555000002'),  -- installed, then turned it off
  ('a3333333-0000-0000-0000-00000000000c', '+966555000003');  -- willing, never installed

update profiles set locale = 'ar'      where id = 'a1111111-0000-0000-0000-00000000000a';
update profiles set allow_push = false where id = 'a2222222-0000-0000-0000-00000000000b';

-- Two of them have a browser registered. Through the function, as the app does.
do $$
begin
  perform auth.login_as('a1111111-0000-0000-0000-00000000000a');
  set local role authenticated;
  perform register_push_device('https://push.example/aaa', 'key-a', 'auth-a', 'web', 'iPhone');
  reset role;

  perform auth.login_as('a2222222-0000-0000-0000-00000000000b');
  set local role authenticated;
  perform register_push_device('https://push.example/bbb', 'key-b', 'auth-b', 'web', 'Pixel');
  reset role;
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 77. Making an offer queues a message the sender can act on: right channel,
--     right template, the customer's own language, and a single-use claim link.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  who     uuid := 'a1111111-0000-0000-0000-00000000000a';
  day     date := test_day(401);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  entry   uuid;
  offer   waitlist_offers%rowtype;
  n       notifications%rowtype;
begin
  perform auth.login_as(who);
  set local role authenticated;
  select w.entry_id into entry
  from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');

  select * into offer from waitlist_offers o
   join waitlist_entries e on e.id = o.entry_id
   where e.id = entry;
  if offer.id is null then
    raise exception 'FAIL 77: no offer was made, so there is nothing to notify about';
  end if;

  select * into n from notifications where offer_id = offer.id;
  if n.id is null then
    raise exception 'FAIL 77: an offer was made and no message was queued';
  end if;

  if n.channel <> 'push' or n.template <> 'waitlist_seat_offer' then
    raise exception 'FAIL 77: queued as % / %, not a push waitlist offer',
      n.channel, n.template;
  end if;

  -- The language the customer chose in the app, not the salon's or the default.
  if n.locale <> 'ar' then
    raise exception 'FAIL 77: queued in % for a customer whose app is in Arabic', n.locale;
  end if;

  if n.profile_id <> who then
    raise exception 'FAIL 77: queued for the wrong person';
  end if;

  -- The deep link carries the offer's own claim token, so tapping it claims
  -- this seat and no other.
  if n.payload ->> 'claim_url' is null
     or position(offer.claim_token::text in n.payload ->> 'claim_url') = 0 then
    raise exception 'FAIL 77: the queued message has no working claim link';
  end if;

  if n.payload -> 'salon' ->> 'ar' is null or n.payload -> 'services' ->> 'en' is null then
    raise exception 'FAIL 77: the sender cannot fill the template from this payload';
  end if;

  -- Contact details are the sender's to look up, not something to copy into a
  -- row the account itself can read back.
  if n.payload::text ilike '%966555000001%' then
    raise exception 'FAIL 77: the payload carries the customer''s phone number';
  end if;

  if n.sent_at is not null then
    raise exception 'FAIL 77: queued already marked as sent, with no sender running';
  end if;

  raise notice 'PASS 77: an offer queues a push to the customer''s own device, in their own language';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 78. Two people who must not be pushed to: one who turned notifications off,
--     and one who never installed the app. Both still get the offer — they
--     simply find it the next time they open Saloni.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  optedout uuid := 'a2222222-0000-0000-0000-00000000000b';
  nodevice uuid := 'a3333333-0000-0000-0000-00000000000c';
  day1     date := test_day(402);
  day2     date := test_day(403);
  t1 timestamptz := (day1 + time '15:00') at time zone 'Asia/Riyadh';
  t2 timestamptz := (day2 + time '15:00') at time zone 'Asia/Riyadh';
  e1 uuid;
  e2 uuid;
  queued integer;
  offers integer;
begin
  perform auth.login_as(optedout);
  set local role authenticated;
  select w.entry_id into e1 from join_waitlist(salon, array[service]::uuid[], day1) w;
  reset role;

  perform auth.login_as(nodevice);
  set local role authenticated;
  select w.entry_id into e2 from join_waitlist(salon, array[service]::uuid[], day2) w;
  reset role;

  perform offer_next_for_slot(salon, t1, t1 + interval '45 minutes');
  perform offer_next_for_slot(salon, t2, t2 + interval '45 minutes');

  select count(*) into offers from waitlist_offers o
   where o.entry_id in (e1, e2);
  if offers <> 2 then
    raise exception 'FAIL 78: % offers made, expected both people to still be offered a seat', offers;
  end if;

  select count(*) into queued from notifications
   where profile_id in (optedout, nodevice);
  if queued <> 0 then
    raise exception 'FAIL 78: % message(s) queued for people with nowhere to send them', queued;
  end if;

  raise notice 'PASS 78: turning it off, and never installing, both mean silence — not a lost seat';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 79. The same seat is never messaged about twice, however many code paths
--     reach the offer. This is what makes it safe to call from a trigger, a
--     lazy sweep and the salon's Notify button.
-- ---------------------------------------------------------------------------

do $$
declare
  offer  uuid;
  before integer;
  after_ integer;
begin
  select o.id into offer from waitlist_offers o
   join waitlist_entries e on e.id = o.entry_id
   where e.customer_id = 'a1111111-0000-0000-0000-00000000000a'
   limit 1;

  select count(*) into before from notifications where offer_id = offer;
  perform enqueue_offer_notification(offer);
  perform enqueue_offer_notification(offer);
  select count(*) into after_ from notifications where offer_id = offer;

  if before <> 1 or after_ <> 1 then
    raise exception 'FAIL 79: % message(s) before, % after re-queueing the same offer',
      before, after_;
  end if;

  raise notice 'PASS 79: queueing the same offer again does not message anybody twice';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 80. Nothing is ever queued about a seat that has already come and gone.
--     A notification about a slot in the past is the thing that teaches people
--     to stop opening them.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  who     uuid := 'a1111111-0000-0000-0000-00000000000a';
  day     date := test_day(404);
  entry   uuid;
  offer   uuid;
  queued  integer;
begin
  perform auth.login_as(who);
  set local role authenticated;
  select w.entry_id into entry from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  -- Written directly: offer_next_for_slot() would not make this offer, so this
  -- is the guard inside the queueing itself being tested, on a row that could
  -- only arrive by a slot falling into the past while a hold was live.
  insert into waitlist_offers (entry_id, starts_at, ends_at, expires_at)
  values (entry, now() - interval '2 hours', now() - interval '75 minutes',
          now() + interval '5 minutes')
  returning id into offer;

  perform enqueue_offer_notification(offer);

  select count(*) into queued from notifications where offer_id = offer;
  if queued <> 0 then
    raise exception 'FAIL 80: queued a message about a seat that is already in the past';
  end if;

  raise notice 'PASS 80: a seat that has already passed is never messaged about';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 81. Somebody already pinged their fill this hour is passed over rather than
--     pestered — and keeps their place, because no offer is spent on them.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  who     uuid := 'a1111111-0000-0000-0000-00000000000a';
  day     date := test_day(405);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  entry   uuid;
  offered integer;
  status_ waitlist_status;
begin
  perform auth.login_as(who);
  set local role authenticated;
  select w.entry_id into entry from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  -- This person has already been messaged about earlier seats in this run.
  update notification_settings set rate_per_hour = 1;

  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');

  select count(*) into offered from waitlist_offers where entry_id = entry;
  if offered <> 0 then
    raise exception 'FAIL 81: offered a seat to somebody already at their message cap';
  end if;

  select status into status_ from waitlist_entries where id = entry;
  if status_ <> 'waiting' then
    raise exception 'FAIL 81: being passed over cost them their place (status %)', status_;
  end if;

  -- Raise the cap and the same seat reaches them normally.
  update notification_settings set rate_per_hour = 20;
  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');

  select count(*) into offered from waitlist_offers where entry_id = entry;
  if offered <> 1 then
    raise exception 'FAIL 81: % offers once under the cap, expected exactly 1', offered;
  end if;

  update notification_settings set rate_per_hour = 4;

  raise notice 'PASS 81: nobody is pestered past the cap, and being skipped costs them nothing';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 82. Quiet hours hold the seat rather than waking anybody. Suppressing the
--     message alone would be the unfair version: the hold would lapse unseen
--     and "never the same slot twice" would bar them from it forever.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  who     uuid := 'a1111111-0000-0000-0000-00000000000a';
  day     date := test_day(406);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  local_now time := (now() at time zone 'Asia/Riyadh')::time;
  entry   uuid;
  offer   waitlist_offers%rowtype;
  n       notifications%rowtype;
begin
  perform auth.login_as(who);
  set local role authenticated;
  select w.entry_id into entry from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  -- A window that certainly contains this instant, whenever the suite is run,
  -- and that wraps midnight if the hour happens to be near it.
  update notification_settings
     set quiet_from = local_now - interval '1 hour',
         quiet_to   = local_now + interval '1 hour';

  if notification_quiet_until(now()) is null then
    raise exception 'FAIL 82: the quiet window does not contain the present moment';
  end if;

  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');

  select * into offer from waitlist_offers where entry_id = entry;
  if offer.id is null then
    raise exception 'FAIL 82: quiet hours suppressed the offer instead of holding it';
  end if;

  -- The ordinary hold is 15 minutes; this one has to cover the silence.
  if offer.expires_at < now() + interval '45 minutes' then
    raise exception 'FAIL 82: the hold expires at %, before the quiet window even ends',
      offer.expires_at;
  end if;

  select * into n from notifications where offer_id = offer.id;
  if n.id is null then
    raise exception 'FAIL 82: nothing queued at all — the message should wait, not vanish';
  end if;
  if n.send_after < now() + interval '30 minutes' then
    raise exception 'FAIL 82: the message would go out at %, during the quiet window',
      n.send_after;
  end if;

  -- And with quiet hours off, the ordinary 15-minute hold is back.
  update notification_settings set quiet_from = null, quiet_to = null;
  if notification_quiet_until(now()) is not null then
    raise exception 'FAIL 82: quiet hours still apply after being switched off';
  end if;

  raise notice 'PASS 82: quiet hours stretch the hold instead of waking anybody';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 83. The outbox belongs to the sender. Draining it hands over the phone
--     number and name of everybody with a message waiting, so an account
--     reaching it would be a directory of who is waiting and how to call them.
-- ---------------------------------------------------------------------------

do $$
declare
  mine integer;
  got  integer;
begin
  perform auth.login_as('a1111111-0000-0000-0000-00000000000a');
  set local role authenticated;

  begin
    perform * from claim_pending_notifications(10);
    raise exception 'FAIL 83a: an ordinary account drained the outbox';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform mark_notification_sent(gen_random_uuid());
    raise exception 'FAIL 83b: an ordinary account marked a message as sent';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into notifications (profile_id, channel, template)
    values ('a1111111-0000-0000-0000-00000000000a', 'whatsapp', 'forged');
    raise exception 'FAIL 83c: an ordinary account queued a message';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update notifications set sent_at = now() where profile_id = auth.uid();
    raise exception 'FAIL 83d: an ordinary account rewrote its own outbox rows';
  exception
    when insufficient_privilege then null;
  end;

  -- Reading your own messages is still allowed: it is what a notification
  -- centre in the app would be built on.
  select count(*) into mine from notifications;
  if mine = 0 then
    raise exception 'FAIL 83e: an account cannot read the messages queued for it';
  end if;
  reset role;

  -- The sender, holding the secret key, can do the job.
  set local role service_role;
  select count(*) into got from claim_pending_notifications(50);
  if got = 0 then
    raise exception 'FAIL 83f: the sender found nothing to send in a full outbox';
  end if;
  reset role;

  raise notice 'PASS 83: only the sender drains the outbox; an account reads its own and writes none';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 84. No internal function is reachable from the browser.
--
--     This one is a guard against a mistake rather than a specific hole.
--     Supabase grants execute on every new function to anon and authenticated
--     by default, so "revoke ... from public" — written throughout these
--     migrations — revokes nothing. Anything added later that forgets to name
--     anon and authenticated fails here rather than shipping open.
-- ---------------------------------------------------------------------------

do $$
declare
  leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and p.proname not in (
      -- Called by the app over PostgREST.
      'available_slots', 'claim_waitlist_offer', 'create_booking',
      'extend_waitlist_offer', 'join_waitlist', 'leave_waitlist', 'my_waitlist',
      'reoffer_waitlist_slot', 'reply_to_review', 'reschedule_booking',
      'salon_day', 'salon_reviews', 'salon_stats', 'salon_waitlist',
      'create_walkin_booking', 'reassign_appointment', 'my_salon_cr',
      'delete_my_account',
      'register_push_device', 'forget_push_device', 'claim_offer_by_token',
      -- Called by row policies, which are evaluated as the querying role.
      'is_admin', 'is_salon_owner', 'salon_is_public',
      -- Trigger functions: a trigger fires without an execute check.
      'handle_new_user', 'offer_cancelled_slot', 'enforce_booking_status_transition'
    );

  if leaked is not null then
    raise exception 'FAIL 84: internal function(s) reachable from the browser: %', leaked;
  end if;

  raise notice 'PASS 84: no internal function is reachable from the browser';
end
$$;
reset role;


-- ---------------------------------------------------------------------------
-- 85. A device belongs to the person holding it. Endpoints are the address a
--     push is delivered to, so registering one against somebody else's account
--     would redirect their notifications onto your phone.
-- ---------------------------------------------------------------------------

do $$
declare
  mine   uuid := 'a1111111-0000-0000-0000-00000000000a';
  theirs uuid := 'a2222222-0000-0000-0000-00000000000b';
  seen   integer;
  owner_ uuid;
  gone   integer;
begin
  perform auth.login_as(mine);
  set local role authenticated;

  -- You see your own devices and nobody else's.
  select count(*) into seen from push_subscriptions;
  if seen <> 1 then
    raise exception 'FAIL 85a: sees % devices, expected only its own', seen;
  end if;

  -- The table itself is not writable, so a row cannot be forged against
  -- another profile.
  begin
    insert into push_subscriptions (profile_id, endpoint, p256dh, auth)
    values (theirs, 'https://push.example/forged', 'k', 'a');
    raise exception 'FAIL 85b: registered a device against another account';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update push_subscriptions set endpoint = 'https://push.example/hijacked';
    raise exception 'FAIL 85c: re-pointed a device by writing the table';
  exception
    when insufficient_privilege then null;
  end;

  -- Revoking somebody else's device is a no-op, not an error: an error would
  -- say whether that endpoint exists.
  select forget_push_device('https://push.example/bbb') into gone;
  if gone <> 0 then
    raise exception 'FAIL 85d: revoked another account''s device';
  end if;
  reset role;

  select profile_id into owner_ from push_subscriptions
   where endpoint = 'https://push.example/bbb';
  if owner_ <> theirs then
    raise exception 'FAIL 85e: another account''s device was taken away from them';
  end if;

  -- Re-registering an endpoint moves it, because it is the same browser and
  -- whoever is signed in now is who should be notified on it.
  perform auth.login_as(mine);
  set local role authenticated;
  perform register_push_device('https://push.example/bbb', 'key-b', 'auth-b', 'web', 'shared phone');
  reset role;

  select profile_id into owner_ from push_subscriptions
   where endpoint = 'https://push.example/bbb';
  if owner_ <> mine then
    raise exception 'FAIL 85f: re-registering a shared browser did not move it';
  end if;

  -- Put it back, so later assertions see the fixture they expect.
  update push_subscriptions set profile_id = theirs
   where endpoint = 'https://push.example/bbb';

  raise notice 'PASS 85: a device is its owner''s, and cannot be registered or moved by anyone else';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 86. WhatsApp is switched off, not removed. It stays under test so that
--     turning it back on is one update rather than a rediscovery.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  who     uuid := 'a3333333-0000-0000-0000-00000000000c';  -- has a number, no device
  day     date := test_day(407);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  entry   uuid;
  offer   uuid;
  chans   integer;
begin
  -- Off by default, which is the point.
  select count(*) into chans from notification_settings
   where 'whatsapp' = any (channels);
  if chans <> 0 then
    raise exception 'FAIL 86: WhatsApp is switched on by default';
  end if;

  perform auth.login_as(who);
  set local role authenticated;
  select w.entry_id into entry from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  update notification_settings set channels = '{push,whatsapp}';
  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');

  select o.id into offer from waitlist_offers o where o.entry_id = entry;
  if offer is null then
    raise exception 'FAIL 86: no offer was made';
  end if;

  -- A number but no device: WhatsApp only.
  if not exists (select 1 from notifications where offer_id = offer and channel = 'whatsapp') then
    raise exception 'FAIL 86: WhatsApp switched on and still queued nothing';
  end if;
  if exists (select 1 from notifications where offer_id = offer and channel = 'push') then
    raise exception 'FAIL 86: queued a push to somebody with no device';
  end if;

  update notification_settings set channels = '{push}';

  raise notice 'PASS 86: WhatsApp still works when switched back on, and is off until it is';
end
$$;
reset role;


-- ---------------------------------------------------------------------------
-- 87. The link in a notification claims that seat, for the person it was sent
--     to and nobody else. A forwarded link is worth nothing, which is what
--     makes it safe to put in a message that can be screenshotted.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  mine    uuid := 'a1111111-0000-0000-0000-00000000000a';
  theirs  uuid := 'a2222222-0000-0000-0000-00000000000b';
  day     date := test_day(408);
  at_time timestamptz := (day + time '15:00') at time zone 'Asia/Riyadh';
  entry   uuid;
  token   uuid;
  got     record;
  booked  integer;
begin
  perform auth.login_as(mine);
  set local role authenticated;
  select w.entry_id into entry from join_waitlist(salon, array[service]::uuid[], day) w;
  reset role;

  perform offer_next_for_slot(salon, at_time, at_time + interval '45 minutes');
  select o.claim_token into token from waitlist_offers o where o.entry_id = entry;
  if token is null then
    raise exception 'FAIL 87: no offer was made, so there is no link to follow';
  end if;

  -- Somebody else holding the same link gets nowhere.
  perform auth.login_as(theirs);
  set local role authenticated;
  begin
    perform * from claim_offer_by_token(token);
    raise exception 'FAIL 87a: a forwarded link claimed somebody else''s seat';
  exception
    when insufficient_privilege then null;
  end;

  -- And an invented token is refused the same way, so this cannot be used to
  -- find out which tokens are real.
  begin
    perform * from claim_offer_by_token('11111111-2222-3333-4444-555555555555');
    raise exception 'FAIL 87b: a made-up token was treated as a real one';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  -- The person it was sent to gets the seat, priced and referenced like any
  -- other booking.
  perform auth.login_as(mine);
  set local role authenticated;
  select * into got from claim_offer_by_token(token);
  reset role;

  if got.booking_id is null or got.reference is null then
    raise exception 'FAIL 87c: the link did not produce a booking';
  end if;

  select count(*) into booked from bookings b
   where b.id = got.booking_id and b.starts_at = at_time
     and b.customer_id = mine and b.total_halalas > 0;
  if booked <> 1 then
    raise exception 'FAIL 87d: the claimed booking is not a real priced appointment';
  end if;

  raise notice 'PASS 87: the notification''s link claims that seat, and only for its owner';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 88. A link is good once. Tapping it twice — or tapping it after the seat has
--     gone — books nothing a second time.
-- ---------------------------------------------------------------------------

do $$
declare
  mine  uuid := 'a1111111-0000-0000-0000-00000000000a';
  token uuid;
  before integer;
  after_ integer;
begin
  select o.claim_token into token from waitlist_offers o
   join waitlist_entries e on e.id = o.entry_id
   where e.customer_id = mine and o.claimed_at is not null
   order by o.offered_at desc limit 1;

  if token is null then
    raise exception 'FAIL 88: no claimed offer to try a second time';
  end if;

  select count(*) into before from bookings where customer_id = mine;

  perform auth.login_as(mine);
  set local role authenticated;
  begin
    perform * from claim_offer_by_token(token);
    raise exception 'FAIL 88a: the same link claimed a second booking';
  exception
    when insufficient_privilege then
      raise exception 'FAIL 88b: refused as not-yours rather than as already-taken';
    when others then
      if sqlstate <> 'SL012' then
        raise exception 'FAIL 88c: refused with % rather than SL012', sqlstate;
      end if;
  end;
  reset role;

  select count(*) into after_ from bookings where customer_id = mine;
  if before <> after_ then
    raise exception 'FAIL 88d: % bookings before, % after re-using the link', before, after_;
  end if;

  raise notice 'PASS 88: a claim link is good once, and says so rather than booking twice';
end
$$;
reset role;


-- ---------------------------------------------------------------------------
-- 89. A salon's photographs are its own. The path's first segment is the salon,
--     so uploading into somebody else's folder is the attack this has to stop —
--     a rival replacing a salon's cover photograph would be both trivial and
--     humiliating.
-- ---------------------------------------------------------------------------

do $$
declare
  mine   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- owned by vendor A
  theirs uuid := 'bbbbbbbb-0000-0000-0000-000000000002';  -- owned by vendor B
  seen   integer;
begin
  perform auth.login_as('33333333-3333-3333-3333-333333333333');  -- vendor A
  set local role authenticated;

  -- Their own folder: allowed.
  insert into storage.objects (bucket_id, name)
  values ('salon-photos', mine || '/cover/one.jpg');

  -- Somebody else's: refused.
  begin
    insert into storage.objects (bucket_id, name)
    values ('salon-photos', theirs || '/cover/two.jpg');
    raise exception 'FAIL 89a: uploaded into another salon''s folder';
  exception
    when insufficient_privilege then null;
  end;

  -- And a path that names no salon at all cannot be used to sidestep it.
  begin
    insert into storage.objects (bucket_id, name)
    values ('salon-photos', 'cover/three.jpg');
    raise exception 'FAIL 89b: uploaded outside any salon''s folder';
  exception
    when insufficient_privilege then null;
    -- A single-segment path leaves foldername() empty, so the cast to uuid gets
    -- null and the policy is simply false. Postgres may report either.
    when others then
      if sqlstate not in ('22P02', '42501') then
        raise exception 'FAIL 89b: refused with % rather than a privilege error', sqlstate;
      end if;
  end;
  reset role;

  -- Vendor B may not take over the file vendor A just wrote, in either
  -- direction: not by editing it, and not by moving it into their own folder.
  perform auth.login_as('44444444-4444-4444-4444-444444444444');
  set local role authenticated;

  update storage.objects
     set name = theirs || '/cover/stolen.jpg'
   where name = mine || '/cover/one.jpg';
  if found then
    raise exception 'FAIL 89c: another salon moved a photograph into its own folder';
  end if;

  delete from storage.objects where name = mine || '/cover/one.jpg';
  if found then
    raise exception 'FAIL 89d: another salon deleted a photograph that was not theirs';
  end if;
  reset role;

  select count(*) into seen from storage.objects
   where name = mine || '/cover/one.jpg';
  if seen <> 1 then
    raise exception 'FAIL 89e: the photograph did not survive the attempts on it';
  end if;

  raise notice 'PASS 89: a salon writes photographs only into its own folder';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 90. Photographs are public to look at, because the catalogue renders for
--     visitors who are not signed in — and the bucket says so out loud rather
--     than relying on a flag nobody can see from here.
-- ---------------------------------------------------------------------------

do $$
declare
  visible integer;
  bucket  record;
begin
  select public, file_size_limit, allowed_mime_types into bucket
  from storage.buckets where id = 'salon-photos';

  if bucket is null then
    raise exception 'FAIL 90a: the bucket does not exist';
  end if;
  if not bucket.public then
    raise exception 'FAIL 90b: the bucket is private, so the catalogue cannot show it';
  end if;
  if bucket.file_size_limit is null or bucket.file_size_limit > 5 * 1024 * 1024 then
    raise exception 'FAIL 90c: no usable size limit (%), so a phone photo goes up raw',
      bucket.file_size_limit;
  end if;
  if bucket.allowed_mime_types is null
     or 'application/pdf' = any (bucket.allowed_mime_types)
     or not ('image/jpeg' = any (bucket.allowed_mime_types)) then
    raise exception 'FAIL 90d: the bucket accepts more than photographs: %',
      bucket.allowed_mime_types;
  end if;

  -- Photographs load for a signed-out visitor because the bucket is public
  -- (90b above) — public objects are served without consulting row-level
  -- security at all. What that visitor must NOT be able to do is enumerate the
  -- bucket: the folder names are salon ids, unpublished salons included, and
  -- 0013's read policy handed out exactly that. 0015 replaced it with one that
  -- lists a salon's own folder to its own owner.
  set local role anon;
  select count(*) into visible from storage.objects where bucket_id = 'salon-photos';
  reset role;

  if visible <> 0 then
    raise exception 'FAIL 90e: a signed-out visitor listed % object(s) in the bucket', visible;
  end if;

  perform auth.login_as('33333333-3333-3333-3333-333333333333');
  set local role authenticated;
  select count(*) into visible from storage.objects where bucket_id = 'salon-photos';
  reset role;

  if visible < 1 then
    raise exception 'FAIL 90f: the salon cannot list its own photographs';
  end if;

  raise notice 'PASS 90: photographs are public to read, capped, images only, and the bucket is not listable';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 91. The salon writes its own diary: a walk-in with no account behind it is
--     filed under a name the owner typed, holds a chair like any other
--     appointment, and appears on the calendar it was written from.
--
--     The last of those is not obvious. salon_day() joined profiles on
--     customer_id, and an inner join drops a null one — a walk-in would have
--     been written, would have held its chair, and would have been invisible.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  vendor_a uuid := '33333333-3333-3333-3333-333333333333';
  day      date := test_day(500);
  at_time  timestamptz;
  made     record;
  row_     record;
  seen     integer;
  expected integer;
begin
  at_time := (day + time '12:00') at time zone 'Asia/Riyadh';

  perform auth.login_as(vendor_a);
  set local role authenticated;

  select * into made
  from create_walkin_booking(salon, null, array[service], at_time, '  Sara from the counter  ', '0500000009');

  if made.booking_id is null then
    raise exception 'FAIL 91a: the owner could not write a walk-in at all';
  end if;

  -- A chair was assigned, which is what puts it inside the no-double-booking
  -- constraint rather than beside it.
  if made.staff_id is null then
    raise exception 'FAIL 91b: the walk-in holds no chair, so it can be double-booked';
  end if;

  -- Priced from the salon's own service row, not from anything the caller
  -- said. Worked out from the table rather than written in here, which is the
  -- claim being made: the figure comes from the salon's prices.
  select round(net * 1.15)::integer into expected
  from (
    select round(s.price_halalas::numeric * (100 - s.discount_percent) / 100) as net
    from services s where s.id = service
  ) priced;

  if made.total_halalas <> expected then
    raise exception 'FAIL 91c: priced at % rather than the salon''s own % ',
      made.total_halalas, expected;
  end if;

  select * into row_ from salon_day(salon, day) where booking_id = made.booking_id;
  if row_ is null then
    raise exception 'FAIL 91d: the walk-in is invisible on the calendar it was written from';
  end if;
  if row_.customer_name <> 'Sara from the counter' then
    raise exception 'FAIL 91e: filed under % rather than the name the salon typed',
      coalesce(row_.customer_name, '<null>');
  end if;
  if not row_.is_walk_in then
    raise exception 'FAIL 91f: the calendar cannot tell a walk-in from an app booking';
  end if;
  if row_.services_en[1] is null then
    raise exception 'FAIL 91g: the walk-in has no services on it';
  end if;
  reset role;

  -- The chair is genuinely held. Asking for *that* person at that time is
  -- refused — the salon has other chairs by now, and a customer being offered
  -- one of those is right rather than wrong, so the check names the one Sara
  -- is sitting in.
  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  begin
    perform create_booking(salon, made.staff_id, array[service], at_time);
    raise exception 'FAIL 91h: a customer was sold the chair the walk-in is in';
  exception
    when sqlstate 'SL003' then
      null;
  end;
  reset role;

  -- And the salon cannot double-book its own person either. This path names a
  -- staff member, so free_staff_for() is not consulted at all: the exclusion
  -- constraint is the whole of the protection, and this is what proves it is
  -- still there.
  perform auth.login_as(vendor_a);
  set local role authenticated;
  begin
    perform create_walkin_booking(salon, made.staff_id, array[service], at_time, 'Second Sara');
    raise exception 'FAIL 91i: the salon double-booked its own stylist';
  exception
    when exclusion_violation then
      null;
  end;
  reset role;

  perform auth.login_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  -- And no customer can see it. It is the salon's record, not a shared one.
  select count(*) into seen from bookings where id = made.booking_id;
  if seen <> 0 then
    raise exception 'FAIL 91j: a customer can read the salon''s own diary entry';
  end if;
  reset role;

  raise notice 'PASS 91: a walk-in is filed under its name, holds a chair, and shows on the calendar';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 92. The only phone number a salon gets is the one it typed itself.
--
--     Guarantee 9 — a customer's contact details never reach the salon — met
--     the walk-in's phone number in salon_day(), and the tempting one-word
--     change is to coalesce the profile's phone beside it. This fails if
--     anybody makes it.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  vendor_a uuid := '33333333-3333-3333-3333-333333333333';
  cust_a   uuid := '11111111-1111-1111-1111-111111111111';
  day      date := test_day(501);
  walk_in  uuid;
  booked   uuid;
  row_     record;
begin
  -- The customer has filled in a phone number and a name on their profile.
  update profiles set phone = '+966500000001', full_name = 'Huda A.' where id = cust_a;

  perform auth.login_as(cust_a);
  set local role authenticated;
  select booking_id into booked
  from create_booking(salon, null, array[service], (day + time '12:00') at time zone 'Asia/Riyadh');
  reset role;

  perform auth.login_as(vendor_a);
  set local role authenticated;
  select booking_id into walk_in
  from create_walkin_booking(salon, null, array[service],
                             (day + time '15:00') at time zone 'Asia/Riyadh',
                             'Nora', '0501112233');

  select * into row_ from salon_day(salon, day) where booking_id = booked;
  if row_.customer_name <> 'Huda A.' then
    raise exception 'FAIL 92a: the salon cannot see the name the customer chose to give';
  end if;
  if row_.customer_phone is not null then
    raise exception 'FAIL 92b: the salon was handed a customer''s phone number: %',
      row_.customer_phone;
  end if;
  if row_.is_walk_in then
    raise exception 'FAIL 92c: an app booking is reported as a walk-in';
  end if;

  select * into row_ from salon_day(salon, day) where booking_id = walk_in;
  if row_.customer_phone <> '0501112233' then
    raise exception 'FAIL 92d: the salon cannot see the number it wrote down itself: %',
      coalesce(row_.customer_phone, '<null>');
  end if;
  reset role;

  raise notice 'PASS 92: a salon sees the number it typed, and never one from a profile';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 93. Only the salon's own owner may write into its diary. A rival salon and a
--     plain customer are both refused, so "the owner records it" is enforced
--     rather than assumed by the screen that calls it.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  service  uuid := 'cccccccc-0000-0000-0000-000000000001';
  vendor_b uuid := '44444444-4444-4444-4444-444444444444';
  cust_b   uuid := '22222222-2222-2222-2222-222222222222';
  at_time  timestamptz := (test_day(502) + time '12:00') at time zone 'Asia/Riyadh';
  refused  integer := 0;
begin
  perform auth.login_as(vendor_b);
  set local role authenticated;
  begin
    perform create_walkin_booking(salon, null, array[service], at_time, 'Not mine');
    raise exception 'FAIL 93a: a rival salon wrote a booking into this salon''s calendar';
  exception
    when insufficient_privilege then refused := refused + 1;
  end;
  reset role;

  perform auth.login_as(cust_b);
  set local role authenticated;
  begin
    perform create_walkin_booking(salon, null, array[service], at_time, 'Also not mine');
    raise exception 'FAIL 93b: a customer wrote a booking into a salon''s calendar';
  exception
    when insufficient_privilege then refused := refused + 1;
  end;

  -- And the table itself is still shut: 0008 revoked INSERT, so there is no way
  -- round the function.
  begin
    insert into bookings (reference, guest_name, salon_id, staff_id, starts_at, ends_at,
                          status, subtotal_halalas, total_halalas)
    values ('SL-FORGE', 'Forged', salon, 'dddddddd-0000-0000-0000-000000000001',
            at_time, at_time + interval '45 min', 'confirmed', 0, 0);
    raise exception 'FAIL 93c: a booking was inserted directly, bypassing the function';
  exception
    when insufficient_privilege then refused := refused + 1;
  end;
  reset role;

  if refused <> 3 then
    raise exception 'FAIL 93d: only % of the three attempts were refused', refused;
  end if;

  raise notice 'PASS 93: only the salon''s owner writes its walk-ins, and only through the function';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 94. Every booking belongs to somebody. A row with neither an account nor a
--     name is a record of nothing, and one with both raises a question about
--     which is right — so the schema refuses each, whoever is asking.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff_  uuid := 'dddddddd-0000-0000-0000-000000000001';
  at_time timestamptz := (test_day(503) + time '12:00') at time zone 'Asia/Riyadh';
  refused integer := 0;
begin
  begin
    insert into bookings (reference, salon_id, staff_id, starts_at, ends_at, status,
                          subtotal_halalas, total_halalas)
    values ('SL-NOBODY', salon, staff_, at_time, at_time + interval '45 min',
            'confirmed', 0, 0);
    raise exception 'FAIL 94a: a booking belonging to nobody was accepted';
  exception
    when check_violation then refused := refused + 1;
  end;

  begin
    insert into bookings (reference, customer_id, guest_name, salon_id, staff_id,
                          starts_at, ends_at, status, subtotal_halalas, total_halalas)
    values ('SL-BOTH', '11111111-1111-1111-1111-111111111111', 'And also Sara',
            salon, staff_, at_time, at_time + interval '45 min', 'confirmed', 0, 0);
    raise exception 'FAIL 94b: a booking with two people on it was accepted';
  exception
    when check_violation then refused := refused + 1;
  end;

  begin
    insert into bookings (reference, guest_name, salon_id, staff_id, starts_at, ends_at,
                          status, subtotal_halalas, total_halalas)
    values ('SL-BLANK', '   ', salon, staff_, at_time, at_time + interval '45 min',
            'confirmed', 0, 0);
    raise exception 'FAIL 94c: a booking filed under a blank name was accepted';
  exception
    when check_violation then refused := refused + 1;
  end;

  if refused <> 3 then
    raise exception 'FAIL 94: only % of the three malformed bookings were refused', refused;
  end if;

  raise notice 'PASS 94: a booking has an account or a name, never neither and never both';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- The second audit (0015). Every one of 95-106 was demonstrated against a
-- database *before* the fix and succeeded there; each is run again here against
-- a database with its own protection removed, and fails.
--
-- The shape they share: a row policy says whose row you may touch, and nothing
-- about what you may put in it, or whether the ids inside it are yours.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 95. A salon cannot walk into the catalogue by inserting itself verified.
--
--     THE CRITICAL ONE. 0004 stopped an owner *updating* those two columns;
--     INSERT was column-blind, so one request created a published salon with
--     no commercial registration ever seen. Registering normally must still
--     work, or the fix would have closed the front door of the vendor side.
-- ---------------------------------------------------------------------------

do $$
declare
  cust   uuid := '22222222-2222-2222-2222-222222222222';
  made   uuid;
  v      boolean;
  p      boolean;
begin
  perform auth.login_as(cust);
  set local role authenticated;

  begin
    insert into salons (owner_id, slug, name_en, name_ar, is_verified, is_published)
    values (cust, 'walk-in-live', 'Walked In', 'دخل', true, true);
    raise exception 'FAIL 95a: a new account published a salon with no verification';
  exception
    when insufficient_privilege then null;
  end;

  -- Even one flag on its own.
  begin
    insert into salons (owner_id, slug, name_en, name_ar, is_verified)
    values (cust, 'walk-in-verified', 'Half Way', 'نصف', true);
    raise exception 'FAIL 95b: a new account verified its own salon';
  exception
    when insufficient_privilege then null;
  end;

  -- Registering the honest way still works, and lands unverified.
  insert into salons (owner_id, slug, name_en, name_ar, cr_number)
  values (cust, 'honest-salon', 'Honest', 'صادق', '1010999999')
  returning id into made;

  select is_verified, is_published into v, p from salons where id = made;
  if v or p then
    raise exception 'FAIL 95c: a freshly registered salon was already live (% / %)', v, p;
  end if;
  reset role;

  delete from salons where id = made;

  raise notice 'PASS 95: a salon is registered unverified, and cannot insert itself otherwise';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 96. Verification is about a particular registration number. Changing it puts
--     the salon back in the queue rather than leaving a tick against a number
--     nobody checked.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner uuid := '33333333-3333-3333-3333-333333333333';
  v     boolean;
  p     boolean;
begin
  update salons set cr_number = '1010000001', is_verified = true, is_published = true
   where id = salon;

  perform auth.login_as(owner);
  set local role authenticated;
  update salons set cr_number = '9999999999' where id = salon;
  reset role;

  select is_verified, is_published into v, p from salons where id = salon;
  if v or p then
    raise exception 'FAIL 96: the number changed and the salon stayed verified (% / %)', v, p;
  end if;

  -- Put it back, since the assertions after this one need a live salon.
  update salons set is_verified = true, is_published = true where id = salon;

  raise notice 'PASS 96: changing the registration number sends a salon back for review';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 97. A booking's stylist must work at the booking's salon — whoever writes it.
--
--     The grant that let a customer move their own booking is gone (56i), and
--     this is the rule underneath it: even a path with the privilege cannot
--     put one salon's appointment in another salon's chair.
-- ---------------------------------------------------------------------------

do $$
declare
  salon_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  salon_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  theirs  uuid;
begin
  insert into staff (salon_id, name_en, name_ar, initials)
  values (salon_b, 'Rival', 'منافس', 'RV') returning id into theirs;

  -- As the database owner: no policy, no grant, nothing but the rule itself.
  begin
    insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                          status, subtotal_halalas, total_halalas)
    values ('SL-CROSS', '11111111-1111-1111-1111-111111111111', salon_a, theirs,
            '2026-12-01 10:00+03', '2026-12-01 11:00+03', 'confirmed', 100, 100);
    raise exception 'FAIL 97: a booking was written into another salon''s chair';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS 97: a booking can only occupy a chair at its own salon';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 98. Reassigning is the salon's, is bounded to its own team, and never leaves
--     an appointment without a chair — which is the state 0008 closed.
-- ---------------------------------------------------------------------------

do $$
declare
  salon_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  salon_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  owner_a uuid := '33333333-3333-3333-3333-333333333333';
  owner_b uuid := '44444444-4444-4444-4444-444444444444';
  layla   uuid := 'dddddddd-0000-0000-0000-000000000001';
  theirs  uuid;
  bk      uuid;
  got     uuid;
begin
  select id into theirs from staff where salon_id = salon_b limit 1;

  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-REASSIGN', '11111111-1111-1111-1111-111111111111', salon_a, layla,
          '2026-12-02 10:00+03', '2026-12-02 11:00+03', 'confirmed', 100, 100)
  returning id into bk;

  -- A rival salon cannot touch it.
  perform auth.login_as(owner_b);
  set local role authenticated;
  begin
    perform reassign_appointment(bk, theirs);
    raise exception 'FAIL 98a: a rival salon reassigned this salon''s appointment';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  perform auth.login_as(owner_a);
  set local role authenticated;

  -- Nor can its own owner hand it to somebody who does not work there. Either
  -- refusal counts: the function checks it, and assertion 97's trigger checks
  -- it again underneath — deliberately, so a path that forgets is still safe.
  begin
    perform reassign_appointment(bk, theirs);
    raise exception 'FAIL 98b: an appointment was handed to another salon''s stylist';
  exception
    when sqlstate 'SL003' or insufficient_privilege then null;
  end;

  -- "Anyone" assigns somebody rather than clearing the chair.
  select reassign_appointment(bk, null) into got;
  reset role;

  if got is null then
    raise exception 'FAIL 98c: reassigning to "anyone" left the appointment with no chair';
  end if;

  select staff_id into got from bookings where id = bk;
  if got is null then
    raise exception 'FAIL 98d: the booking ended up outside the no-double-booking constraint';
  end if;

  raise notice 'PASS 98: only the salon reassigns, only to its own team, and never to nobody';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 99. One salon cannot take another's stylist off sale.
--
--     time_off carried a salon_id and a staff_id and never compared them. The
--     row was accepted, available_slots() ignored it (it scopes by salon) and
--     create_booking() honoured it (it did not) — so customers were offered
--     times that were then refused, for as long as the row lasted.
-- ---------------------------------------------------------------------------

do $$
declare
  salon_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  owner_b uuid := '44444444-4444-4444-4444-444444444444';
  layla   uuid := 'dddddddd-0000-0000-0000-000000000001';
begin
  perform auth.login_as(owner_b);
  set local role authenticated;

  begin
    insert into time_off (salon_id, staff_id, starts_at, ends_at, reason)
    values (salon_b, layla, now(), now() + interval '30 days', 'sabotage');
    raise exception 'FAIL 99: one salon blocked out another salon''s stylist';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 99: time off can only name a stylist of its own salon';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 100. One salon cannot make another's services unbookable.
--
--      staff_services means "only these people may do this service". Its policy
--      asked whether you owned the *stylist*, never whether the *service* was
--      yours — so linking your own stylist to a rival's service left nobody at
--      that rival qualified to do it, and every booking failed with "nobody is
--      free".
-- ---------------------------------------------------------------------------

do $$
declare
  owner_b  uuid := '44444444-4444-4444-4444-444444444444';
  salon_b  uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  their_service uuid := 'cccccccc-0000-0000-0000-000000000001';
  mine     uuid;
begin
  select id into mine from staff where salon_id = salon_b limit 1;

  perform auth.login_as(owner_b);
  set local role authenticated;

  begin
    insert into staff_services (staff_id, service_id) values (mine, their_service);
    raise exception 'FAIL 100: one salon narrowed another salon''s service to its own staff';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 100: a stylist can only be linked to their own salon''s services';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 101. A review cannot arrive with the salon's answer already written in it.
--
--      0006 revoked UPDATE and 0007 made replying a function, so this looked
--      closed. INSERT was still column-blind: a one-star review could carry a
--      reply in the salon's name, and replied_at so it looked answered.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  cust  uuid := '11111111-1111-1111-1111-111111111111';
  bk    uuid;
begin
  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-REVIEWED', cust, salon, 'dddddddd-0000-0000-0000-000000000001',
          now() - interval '2 days', now() - interval '2 days' + interval '1 hour',
          'completed', 100, 100)
  returning id into bk;

  perform auth.login_as(cust);
  set local role authenticated;

  begin
    insert into reviews (booking_id, salon_id, customer_id, rating, body, reply, replied_at)
    values (bk, salon, cust, 1, 'awful', 'We agree, we are awful', now());
    raise exception 'FAIL 101a: a customer wrote the salon''s reply for it';
  exception
    when insufficient_privilege then null;
  end;

  -- Leaving an honest review still works.
  insert into reviews (booking_id, salon_id, customer_id, rating, body)
  values (bk, salon, cust, 4, 'good');
  reset role;

  raise notice 'PASS 101: a review carries the customer''s words only, and still can';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 102. A photograph row cannot point into another salon's folder. The storage
--      rules were already right (89); the row that names the file was not.
-- ---------------------------------------------------------------------------

do $$
declare
  salon_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  owner_b uuid := '44444444-4444-4444-4444-444444444444';
begin
  perform auth.login_as(owner_b);
  set local role authenticated;

  begin
    insert into salon_media (salon_id, storage_path, is_cover)
    values (salon_b, 'aaaaaaaa-0000-0000-0000-000000000001/cover/theirs.jpg', true);
    raise exception 'FAIL 102: a salon listed a rival''s photograph as its own cover';
  exception
    when check_violation then null;
  end;

  -- Its own folder is fine.
  insert into salon_media (salon_id, storage_path)
  values (salon_b, salon_b::text || '/gallery/mine.jpg');
  reset role;

  raise notice 'PASS 102: a photograph row can only name a file in its own salon''s folder';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 103. Nothing a person types is unbounded. The catalogue every visitor
--      downloads on the home screen is built out of these columns.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner uuid := '33333333-3333-3333-3333-333333333333';
  n     integer;
begin
  perform auth.login_as(owner);
  set local role authenticated;

  begin
    update salons set name_en = repeat('x', 100000) where id = salon;
    raise exception 'FAIL 103a: a one-hundred-thousand-character salon name was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update services set name_en = repeat('x', 5000)
     where salon_id = salon and id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL 103b: an unbounded service name was accepted';
  exception
    when check_violation then null;
  end;
  reset role;

  select length(name_en) into n from salons where id = salon;
  if n > 80 then
    raise exception 'FAIL 103c: the salon name grew anyway (% characters)', n;
  end if;

  raise notice 'PASS 103: free text is bounded, so one row cannot bloat the catalogue';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 104. One account cannot hold a salon's whole day.
--
--      Nothing is paid, so without a cap an account books every slot for free
--      and simply does not turn up. Deposits are the real answer and need
--      payments; this is what can be done before then.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  cust    uuid := '22222222-2222-2222-2222-222222222222';
  service uuid := 'cccccccc-0000-0000-0000-000000000001';
  day     date := test_day(600);
  made    integer := 0;
  t       time := '12:00';
begin
  perform auth.login_as(cust);
  set local role authenticated;

  for i in 1..5 loop
    begin
      perform create_booking(salon, null, array[service],
        ((day + t) at time zone 'Asia/Riyadh'));
      made := made + 1;
    exception
      when sqlstate 'SL006' then exit;
    end;
    t := t + interval '90 min';
  end loop;
  reset role;

  if made <> 3 then
    raise exception 'FAIL 104: one account made % bookings at one salon in a day, expected 3', made;
  end if;

  raise notice 'PASS 104: one account cannot book out a salon''s day';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 105. A salon still awaiting review answers nothing about its day.
--
--      available_slots() is open to anon on purpose — browsing is ungated — and
--      never asked whether the salon was published, so an unpublished salon's
--      opening hours and booking shape were readable by anyone holding its id.
-- ---------------------------------------------------------------------------

do $$
declare
  salon   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner   uuid := '33333333-3333-3333-3333-333333333333';
  seen    bigint;
begin
  update salons set is_published = false where id = salon;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into seen from available_slots(salon, test_day(601), 45, null);
  reset role;

  if seen <> 0 then
    raise exception 'FAIL 105a: a visitor read % slots of a salon under review', seen;
  end if;

  -- Its own owner still sees it, or the portal would go blank before approval.
  perform auth.login_as(owner);
  set local role authenticated;
  select count(*) into seen from available_slots(salon, test_day(601), 45, null);
  reset role;

  if seen = 0 then
    raise exception 'FAIL 105b: the owner cannot see their own salon''s availability';
  end if;

  update salons set is_published = true where id = salon;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into seen from available_slots(salon, test_day(601), 45, null);
  reset role;

  if seen = 0 then
    raise exception 'FAIL 105c: a published salon stopped offering times';
  end if;

  raise notice 'PASS 105: availability is answered for a public salon, or to its owner, and nobody else';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 106. A commercial registration number is not public.
--
--      SELECT is column-blind too, and the catalogue asked for `select *`, so
--      every signed-out visitor was handed each salon's CR number. Revoked from
--      signed-in accounts as well, because signup is open — "signed in" is not
--      a filter. The owner reads their own through a function.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner uuid := '33333333-3333-3333-3333-333333333333';
  other uuid := '22222222-2222-2222-2222-222222222222';
  got   text;
  n     bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select cr_number into got from salons where id = salon;
    raise exception 'FAIL 106a: a signed-out visitor read a commercial registration number';
  exception
    when insufficient_privilege then null;
  end;

  -- The catalogue itself must still load for that visitor.
  select count(*) into n from salons where is_published;
  if n = 0 then
    raise exception 'FAIL 106b: the catalogue stopped loading for signed-out visitors';
  end if;
  reset role;

  perform auth.login_as(other);
  set local role authenticated;
  begin
    select cr_number into got from salons where id = salon;
    raise exception 'FAIL 106c: any signed-in account read another salon''s registration number';
  exception
    when insufficient_privilege then null;
  end;

  -- And a stranger cannot get it through the function either.
  select my_salon_cr(salon) into got;
  if got is not null then
    raise exception 'FAIL 106d: the function handed a stranger the number (%)', got;
  end if;
  reset role;

  perform auth.login_as(owner);
  set local role authenticated;
  select my_salon_cr(salon) into got;
  reset role;

  if got is null then
    raise exception 'FAIL 106e: the owner cannot read their own registration number';
  end if;

  raise notice 'PASS 106: a registration number reaches its own salon''s owner and nobody else';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 107. Deleting an account removes the person and keeps the salon's record.
--
--      Required by both app stores, and the plainest reading of PDPL. The
--      difficulty is that these are two different things wearing one word: the
--      person is theirs to erase, the appointment is the salon's record of its
--      own day. 0014's nullable customer_id is what lets the second survive the
--      first.
-- ---------------------------------------------------------------------------

do $$
declare
  salon    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  layla    uuid := 'dddddddd-0000-0000-0000-000000000001';
  leaver   uuid := '66666666-6666-6666-6666-666666666666';
  past_b   uuid;
  future_b uuid;
  got      record;
  n        integer;
begin
  insert into auth.users (id, phone) values (leaver, '+966500000066');
  update profiles set full_name = 'Leaving Soon', phone = '+966500000066' where id = leaver;

  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-GONE1', leaver, salon, layla,
          now() - interval '9 days', now() - interval '9 days' + interval '1 hour',
          'completed', 20000, 23000)
  returning id into past_b;

  insert into bookings (reference, customer_id, salon_id, staff_id, starts_at, ends_at,
                        status, subtotal_halalas, total_halalas)
  values ('SL-GONE2', leaver, salon, layla,
          now() + interval '9 days', now() + interval '9 days' + interval '1 hour',
          'confirmed', 20000, 23000)
  returning id into future_b;

  insert into push_subscriptions (profile_id, endpoint, p256dh, auth)
  values (leaver, 'https://push.example/leaver', 'k', 'a');

  perform auth.login_as(leaver);
  set local role authenticated;
  perform delete_my_account();
  reset role;

  -- The account is gone, identity and all.
  select count(*) into n from auth.users where id = leaver;
  if n <> 0 then
    raise exception 'FAIL 107a: the sign-in identity survived the deletion';
  end if;
  select count(*) into n from profiles where id = leaver;
  if n <> 0 then
    raise exception 'FAIL 107b: the profile survived the deletion';
  end if;
  select count(*) into n from push_subscriptions where profile_id = leaver;
  if n <> 0 then
    raise exception 'FAIL 107c: their devices would still be sent notifications';
  end if;

  -- The salon keeps what it did, with nobody attached to it.
  select customer_id, guest_name, total_halalas, status, anonymised_at
    into got from bookings where id = past_b;
  if got is null then
    raise exception 'FAIL 107d: the salon lost its record of an appointment it kept';
  end if;
  if got.customer_id is not null or got.guest_name <> 'SL-GONE1' then
    raise exception 'FAIL 107e: the person is still on the booking (% / %)',
      got.customer_id, got.guest_name;
  end if;
  if got.total_halalas <> 23000 or got.status <> 'completed' then
    raise exception 'FAIL 107f: the salon''s own figures were rewritten';
  end if;
  if got.anonymised_at is null then
    raise exception 'FAIL 107g: nothing records that this was emptied, or when';
  end if;

  -- And what was still to come was called off, so the chair went back on sale.
  select status into got from bookings where id = future_b;
  if got.status <> 'cancelled' then
    raise exception 'FAIL 107h: an upcoming appointment was left standing (%)', got.status;
  end if;

  raise notice 'PASS 107: deleting an account removes the person and leaves the salon its record';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 108. A deleted customer's history is not mistaken for a walk-in, and the
--      salon still sees nothing about the person.
-- ---------------------------------------------------------------------------

do $$
declare
  salon uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner uuid := '33333333-3333-3333-3333-333333333333';
  row_  record;
  day_  date;
begin
  select (starts_at at time zone 'Asia/Riyadh')::date into day_
  from bookings where reference = 'SL-GONE1';

  perform auth.login_as(owner);
  set local role authenticated;
  select * into row_ from salon_day(salon, day_) where reference = 'SL-GONE1';
  reset role;

  if row_ is null then
    raise exception 'FAIL 108a: the appointment vanished from the salon''s own calendar';
  end if;
  if row_.is_walk_in then
    raise exception 'FAIL 108b: a departed customer''s booking is shown as a walk-in';
  end if;
  if row_.customer_phone is not null then
    raise exception 'FAIL 108c: a phone number survived the deletion: %', row_.customer_phone;
  end if;
  if row_.customer_name <> 'SL-GONE1' then
    raise exception 'FAIL 108d: the salon still sees a name (%)', row_.customer_name;
  end if;

  raise notice 'PASS 108: an emptied booking reads as history, not as a walk-in';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 109. An account that owns a salon is refused, and nothing is half-done.
--
--      A salon holds other people's appointments, its staff, its photographs
--      and a registration somebody checked. Deleting the owner would orphan all
--      of it. The refusal has to leave the account exactly as it was.
-- ---------------------------------------------------------------------------

do $$
declare
  owner uuid := '33333333-3333-3333-3333-333333333333';
  n     integer;
begin
  perform auth.login_as(owner);
  set local role authenticated;
  begin
    perform delete_my_account();
    raise exception 'FAIL 109a: a salon owner deleted their account, orphaning the salon';
  exception
    when sqlstate 'SL007' then null;
  end;
  reset role;

  select count(*) into n from profiles where id = owner;
  if n <> 1 then
    raise exception 'FAIL 109b: the refusal still removed the account';
  end if;
  select count(*) into n from salons where owner_id = owner;
  if n = 0 then
    raise exception 'FAIL 109c: the salon was lost anyway';
  end if;

  -- And a signed-out visitor cannot call it at all.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform delete_my_account();
    raise exception 'FAIL 109d: an anonymous caller reached the deletion function';
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'PASS 109: an owner is refused, the refusal changes nothing, and anon cannot call it';
end
$$;
reset role;

select 'ALL DATABASE TESTS PASSED' as result;
