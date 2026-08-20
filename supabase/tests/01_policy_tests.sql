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
-- 7. A customer cannot create a booking in someone else's name.
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

insert into salon_media (salon_id, storage_path, is_cover)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'a/1.jpg', true);

do $$
begin
  insert into salon_media (salon_id, storage_path, is_cover)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'a/2.jpg', true);
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
-- 17. The booking write the app actually issues, as the customer making it.
--     Names every column src/data/bookings.ts sends, so renaming one here fails
--     the tests rather than the app in someone's browser.
-- ---------------------------------------------------------------------------

do $$
declare
  new_id uuid;
  readback record;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222"}',
    true
  );
  set local role authenticated;

  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    payment_method, paid_at
  ) values (
    'SL-APPTEST1', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    '2027-03-01 14:30+03', '2027-03-01 15:15+03', 'confirmed',
    15000, 3000, 1800, 13800, 0.150,
    -- Simulated checkout: a method is recorded, but no money moved.
    'applepay', null
  ) returning id into new_id;

  insert into booking_items (
    booking_id, service_id, name_en, name_ar, duration_minutes,
    unit_price_halalas, discount_percent, quantity
  ) values (
    new_id, 'cccccccc-0000-0000-0000-000000000001',
    'Signature Haircut', 'قص شعر', 45, 15000, 20, 1
  );

  -- Read it back exactly as loadMyBookings() does, joins included.
  select b.reference, b.total_halalas, b.status, i.name_ar, i.unit_price_halalas,
         s.name_en as salon_name, st.name_en as staff_name
    into readback
  from bookings b
  join booking_items i on i.booking_id = b.id
  join salons s on s.id = b.salon_id
  left join staff st on st.id = b.staff_id
  where b.id = new_id;

  if readback.reference <> 'SL-APPTEST1' or readback.total_halalas <> 13800 then
    raise exception 'FAIL 17a: booking read back as % / %',
      readback.reference, readback.total_halalas;
  end if;
  -- Arabic must survive the round trip byte for byte.
  if readback.name_ar <> 'قص شعر' then
    raise exception 'FAIL 17b: Arabic service name came back as %', readback.name_ar;
  end if;
  if readback.salon_name is null or readback.staff_name is null then
    raise exception 'FAIL 17c: the joins the app relies on returned nothing';
  end if;

  raise notice 'PASS 17: the app''s booking write and read-back work end to end';
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
  where b.reference = 'SL-APPTEST1';

  if charged <> 15000 then
    raise exception 'FAIL 18a: past booking now says %, expected 15000', charged;
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
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222"}',
    true
  );
  set local role authenticated;

  select count(*) into before_count from bookings
  where customer_id = '22222222-2222-2222-2222-222222222222';

  -- Exactly the update src/data/bookings.ts issues.
  update bookings
     set starts_at = '2027-03-05 16:00+03', ends_at = '2027-03-05 16:45+03'
   where reference = 'SL-APPTEST1';

  select count(*) into after_count from bookings
  where customer_id = '22222222-2222-2222-2222-222222222222';

  if after_count <> before_count then
    raise exception 'FAIL 19a: rescheduling changed the booking count from % to %',
      before_count, after_count;
  end if;

  select starts_at, reference, total_halalas into moved
  from bookings where reference = 'SL-APPTEST1';

  if moved.starts_at <> '2027-03-05 16:00+03'::timestamptz then
    raise exception 'FAIL 19b: booking did not move, starts_at is %', moved.starts_at;
  end if;
  -- The reference and the money must survive the move untouched.
  if moved.total_halalas <> 13800 then
    raise exception 'FAIL 19c: moving the booking changed its total to %', moved.total_halalas;
  end if;

  select count(*) into items_after from booking_items i
  join bookings b on b.id = i.booking_id where b.reference = 'SL-APPTEST1';
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
  where reference = 'SL-APPTEST1';

  select count(*) into still_there from bookings where reference = 'SL-APPTEST1';
  if still_there <> 1 then
    raise exception 'FAIL 20a: cancelling deleted the row instead of marking it';
  end if;

  -- The freed time is immediately bookable by the same staff member, because
  -- the exclusion constraint ignores cancelled rows.
  insert into bookings (
    reference, customer_id, salon_id, staff_id, starts_at, ends_at, status,
    subtotal_halalas, total_halalas
  ) values (
    'SL-AFTERCANCEL', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    '2027-03-05 16:00+03', '2027-03-05 16:45+03', 'confirmed', 15000, 17250
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

-- 10:00–23:00 every day but Friday, which opens at 14:00. Mirrors seed.sql.
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', d, time '10:00', time '23:00'
from generate_series(0, 6) d where d <> 5;
insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 5, time '14:00', time '23:00');

-- ---------------------------------------------------------------------------
-- 21. A booked staff member's time is offered but marked taken, and the same
--     time stays free for a colleague.
-- ---------------------------------------------------------------------------

do $$
declare
  day        date := current_date + 7;
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
  day   date := current_date + 7;
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
  day   date := current_date + 7;
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
  day   date := current_date + 7;
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
  ordinary date := current_date + 7;
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
  day    date := current_date + 7;
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
  day    date := current_date + 7;
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
  day   date := current_date + 7;
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
  day    date := current_date + 7;
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
  from available_slots(salon, current_date + 7, 45, null);

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
  day      date := current_date + 7;
  dow      smallint := extract(dow from current_date + 7)::smallint;
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
    ((current_date + 9) + time '15:00') at time zone 'Asia/Riyadh',
    ((current_date + 9) + time '15:20') at time zone 'Asia/Riyadh',
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

select 'ALL DATABASE TESTS PASSED' as result;
