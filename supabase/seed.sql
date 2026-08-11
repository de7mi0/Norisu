-- Saloni — demo data
--
-- The four salons, their services, staff and reviews that the prototype
-- currently hardcodes in src/data/. Running this gives a new Supabase project
-- something to show.
--
-- Prerequisite: at least one user must exist. Create one from the dashboard
-- under Authentication -> Users -> Add user. This script makes the OLDEST
-- account the owner of all four demo salons, which is what you want when it is
-- only you testing.
--
-- Safe to re-run: it removes the demo salons by slug first.

begin;

do $$
declare
  owner uuid;
  maison uuid;
  barber uuid;
  rose   uuid;
  kingdom uuid;
begin
  select id into owner from profiles order by created_at limit 1;

  if owner is null then
    raise exception
      'No accounts exist yet. Sign in to the app once, then run this script.';
  end if;

  update profiles set role = 'vendor' where id = owner;

  -- Clear any previous run.
  delete from salons
   where slug in ('maison-noir', 'the-barber-atelier', 'rose-oud', 'kingdom-cuts');

  -- -------------------------------------------------------------------------
  -- Salons
  -- -------------------------------------------------------------------------

  insert into salons (owner_id, slug, name_en, name_ar, tags_en, tags_ar,
                      category_en, category_ar, area_en, area_ar,
                      phone, is_verified, is_published)
  values
    (owner, 'maison-noir', 'Maison Noir', 'ميزون نوار',
     'Hair · Skin · Bridal', 'شعر · بشرة · عرائس',
     'Ladies salon', 'صالون سيدات', 'Al Olaya, Riyadh', 'العليا، الرياض',
     '+966 11 200 4477', true, true)
  returning id into maison;

  insert into salons (owner_id, slug, name_en, name_ar, tags_en, tags_ar,
                      category_en, category_ar, area_en, area_ar,
                      is_verified, is_published)
  values
    (owner, 'the-barber-atelier', 'The Barber Atelier', 'ذا باربر',
     'Barber · Beard', 'حلاقة · لحية',
     'Men salon', 'صالون رجال', 'King Fahd Rd, Riyadh', 'طريق الملك فهد، الرياض',
     true, true)
  returning id into barber;

  insert into salons (owner_id, slug, name_en, name_ar, tags_en, tags_ar,
                      category_en, category_ar, area_en, area_ar,
                      is_verified, is_published)
  values
    (owner, 'rose-oud', 'Rose & Oud', 'وردة وعود',
     'Ladies · Skin · Nails', 'سيدات · بشرة · أظافر',
     'Ladies salon', 'صالون سيدات', 'Al Nakheel, Riyadh', 'النخيل، الرياض',
     true, true)
  returning id into rose;

  insert into salons (owner_id, slug, name_en, name_ar, tags_en, tags_ar,
                      category_en, category_ar, area_en, area_ar,
                      is_verified, is_published)
  values
    (owner, 'kingdom-cuts', 'Kingdom Cuts', 'كينغدم كتس',
     'Men · Barber · Beard', 'رجال · حلاقة · لحية',
     'Men salon', 'صالون رجال', 'Al Malaz, Riyadh', 'الملز، الرياض',
     true, true)
  returning id into kingdom;

  -- -------------------------------------------------------------------------
  -- Services — prices in halalas (15000 = 150.00 SAR)
  -- -------------------------------------------------------------------------

  insert into services (salon_id, name_en, name_ar, duration_minutes,
                        price_halalas, discount_percent, sort_order)
  values
    (maison, 'Signature Haircut',   'قص شعر',              45,  15000, 20, 1),
    (maison, 'Hair Color & Gloss',  'صبغة وتلوين',          90,  32000,  0, 2),
    (maison, 'Luxury Facial',       'عناية فاخرة بالبشرة',  60,  26000, 15, 3),
    (maison, 'Manicure & Nail Art', 'مانيكير',              50,  12000,  0, 4),
    (maison, 'Bridal Makeup',       'مكياج عروس',          120,  60000,  0, 5),

    (barber, 'Signature Haircut',   'قص شعر',              45,   8000, 15, 1),
    (barber, 'Beard Trim',          'تهذيب لحية',           30,   5000,  0, 2),

    (rose,   'Luxury Facial',       'عناية فاخرة بالبشرة',  60,  26000, 25, 1),
    (rose,   'Manicure & Nail Art', 'مانيكير',              50,  12000,  0, 2),

    (kingdom,'Signature Haircut',   'قص شعر',              45,   8000,  0, 1),
    (kingdom,'Beard Trim',          'تهذيب لحية',           30,   5000,  0, 2);

  -- -------------------------------------------------------------------------
  -- Staff
  --
  -- "Any professional" is not seeded: in the schema that is simply a booking
  -- with staff_id left null.
  -- -------------------------------------------------------------------------

  insert into staff (salon_id, name_en, name_ar, role_en, role_ar, initials, sort_order)
  values
    (maison, 'Layla A.', 'ليلى ع.', 'Senior Stylist', 'مصفّفة أولى', 'LA', 1),
    (maison, 'Sara M.',  'سارة م.', 'Color & Skin Specialist', 'أخصائية صبغ وبشرة', 'SM', 2),
    (maison, 'Omar K.',  'عمر ك.',  'Master Barber', 'حلّاق محترف', 'OK', 3),
    (barber, 'Omar K.',  'عمر ك.',  'Master Barber', 'حلّاق محترف', 'OK', 1),
    (rose,   'Sara M.',  'سارة م.', 'Color & Skin Specialist', 'أخصائية صبغ وبشرة', 'SM', 1),
    (kingdom,'Layla A.', 'ليلى ع.', 'Senior Stylist', 'مصفّفة أولى', 'LA', 1);

  -- -------------------------------------------------------------------------
  -- Opening hours — 10:00 to 23:00, closed Friday morning
  -- -------------------------------------------------------------------------

  insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
  select s.id, d.dow, time '10:00', time '23:00'
  from (values (maison), (barber), (rose), (kingdom)) as s(id)
  cross join generate_series(0, 6) as d(dow)
  where d.dow <> 5;

  insert into working_hours (salon_id, day_of_week, opens_at, closes_at)
  select s.id, 5, time '14:00', time '23:00'
  from (values (maison), (barber), (rose), (kingdom)) as s(id);

  raise notice 'Seeded 4 salons owned by %', owner;
end
$$;

commit;

-- Confirmation. The Supabase SQL Editor displays returned rows but not notices,
-- so this reports the result in a form you can actually see.
-- Expect: 4 salons, 11 services, 6 staff, 28 working_hours.
select
  (select count(*) from salons)        as salons,
  (select count(*) from services)      as services,
  (select count(*) from staff)         as staff,
  (select count(*) from working_hours) as working_hours,
  (select count(*) from profiles)      as profiles;
