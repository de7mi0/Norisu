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

select 'ALL DATABASE TESTS PASSED' as result;
