-- Saloni — the second audit, and the shape it found
--
-- Thirteen findings, eleven of them one mistake wearing different clothes. A
-- row policy says *whose* row you may touch. It says nothing about *what you
-- may put in it*, and nothing about whether the ids inside it point at rows
-- that are yours.
--
-- 0004 and 0006 said this once already, for UPDATE on three tables. What was
-- never said:
--
--   INSERT is column-blind too.  0004 stopped an owner *updating* is_verified;
--                                nothing stopped them *inserting* a salon with
--                                it already true. The verification step — the
--                                one human check in the whole product — was
--                                skippable by anybody with an account.
--   Foreign keys point anywhere.  staff_services, time_off and bookings all
--                                carry a staff_id with nothing saying the
--                                stylist works at the salon on the same row.
--                                One salon could take another's stylist off
--                                sale, or make its services unbookable.
--   Old grants outlive their use. 0006 granted UPDATE on starts_at/ends_at/
--                                staff_id because that was how rescheduling
--                                worked. 0008 replaced that with a function
--                                and the grant stayed, so a customer could
--                                stretch a 45-minute booking across a whole
--                                day and hold the chair for nothing.
--
-- Every one of these was demonstrated against a throwaway database before it
-- was fixed, and each has an assertion (95-107) that fails if the protection
-- is removed.
--
-- Nothing an honest customer or owner does today changes.

-- ---------------------------------------------------------------------------
-- 1. A salon cannot publish itself — by any route, not just by UPDATE
-- ---------------------------------------------------------------------------

-- THE CRITICAL ONE. `grant insert ... on all tables` (0002) is column-blind,
-- and salons_insert_own only checks owner_id. So this was one request:
--
--   insert into salons (owner_id, slug, name_en, name_ar, is_verified, is_published)
--   values (auth.uid(), 'anything', 'Anything', 'أي شيء', true, true);
--
-- and the salon is in every customer's catalogue, with no commercial
-- registration ever seen by anybody. The published_salons_are_verified
-- constraint (0001) did not help: setting both at once satisfies it.
revoke insert on salons from authenticated;

-- Everything an owner legitimately fills in when registering. is_verified and
-- is_published are absent, exactly as they are absent from 0004's UPDATE grant,
-- and `id` is absent so the default generates it.
grant insert (
  owner_id,
  slug,
  name_en,
  name_ar,
  tags_en,
  tags_ar,
  category_en,
  category_ar,
  area_en,
  area_ar,
  city,
  latitude,
  longitude,
  phone,
  cr_number,
  waitlist_enabled,
  slot_step_minutes
) on salons to authenticated;

comment on column salons.is_verified is
  'Set only by an admin through the dashboard. authenticated can neither UPDATE it (0004) nor '
  'INSERT it (0015) — a new row always starts false, whatever the caller sends.';

-- ---------------------------------------------------------------------------
-- 2. Verification is about a particular registration number
-- ---------------------------------------------------------------------------

-- 0004 deliberately left cr_number writable, so an owner can correct a typo.
-- The consequence was not noticed: a salon could be verified against one
-- number and then quietly carry another, and nothing recorded that the thing
-- somebody checked had changed.
--
-- Changing it puts the salon back in the queue rather than banning it. That is
-- the honest outcome — the new number has not been checked — and it is
-- reversible by the same person who verified it the first time.
create function public.reverify_when_cr_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cr_number is distinct from old.cr_number and (old.is_verified or old.is_published) then
    new.is_verified  := false;
    new.is_published := false;
  end if;
  return new;
end;
$$;

comment on function public.reverify_when_cr_changes() is
  'A verified salon that changes its commercial registration number goes back into the queue. '
  'Verification is a statement about a particular number, not a permanent property of the row.';

-- A trigger fires without an execute check, so nothing needs this grant. Both
-- lines are required and neither is redundant: Postgres grants EXECUTE to
-- PUBLIC on every new function, and Supabase's default privileges grant it to
-- anon and authenticated *by name* — revoking one leaves the other, which is
-- the trap §10 of CLAUDE.md describes and assertion 84 exists to catch.
revoke all on function public.reverify_when_cr_changes() from public;
revoke execute on function public.reverify_when_cr_changes() from anon, authenticated;

create trigger salons_reverify_on_cr_change
  before update on salons
  for each row
  execute function public.reverify_when_cr_changes();

-- ---------------------------------------------------------------------------
-- 3. A booking's time and its chair stop being fields
-- ---------------------------------------------------------------------------

-- 0006 granted these three because rescheduling was an UPDATE from the browser.
-- 0008 made rescheduling a function and the grant was never taken back, which
-- left two things open to any customer with one booking:
--
--   * set ends_at to closing time. The no-double-booking constraint then works
--     for the attacker: nobody else can be booked with that stylist all day,
--     and since nothing is paid it costs them nothing.
--   * set staff_id to a stylist at a *different* salon, occupying a chair in a
--     business they have never dealt with.
--
-- Customers reschedule through reschedule_booking() and cancel through status,
-- both of which still work. The owner's reassign moves to its own function
-- below.
revoke update (staff_id, starts_at, ends_at) on bookings from authenticated;

comment on column bookings.starts_at is
  'Not writable by authenticated (0015). Customers move a booking with reschedule_booking() '
  '(0008), which re-checks opening hours and availability; a raw UPDATE re-checked neither.';

-- The owner's "give this to somebody else". Guarded, and it refuses the two
-- things the raw UPDATE allowed: another salon's stylist, and null.
--
-- Null mattered more than it looks. "Any professional" with no chair assigned
-- is precisely the state 0008 closed — outside the exclusion constraint, so the
-- salon can be oversold — and the reassign sheet offered it as an option. Here
-- it means "pick whoever is free", which is what the owner meant anyway.
create function public.reassign_appointment(
  p_booking_id uuid,
  p_staff_id   uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  b        record;
  v_wanted uuid[];
  v_staff  uuid;
begin
  select * into b from bookings where id = p_booking_id;

  if b.id is null or not is_salon_owner(b.salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  -- What the appointment is for, so a replacement has to be able to do it.
  select coalesce(array_agg(bi.service_id), '{}'::uuid[])
    into v_wanted
  from booking_items bi
  where bi.booking_id = b.id and bi.service_id is not null;

  if p_staff_id is not null then
    select st.id into v_staff
    from staff st
    where st.id = p_staff_id
      and st.salon_id = b.salon_id
      and not st.is_archived;

    if v_staff is null then
      raise exception 'that specialist does not work at this salon' using errcode = 'SL003';
    end if;
  else
    -- Least loaded first, then the salon's own order — the same rule
    -- create_booking() uses, so "anyone" means the same thing on both sides.
    select f.staff_id into v_staff
    from free_staff_for(b.salon_id, v_wanted, b.starts_at, b.ends_at, b.id) f
    order by f.load, f.sort_order, f.staff_id
    limit 1;

    if v_staff is null then
      raise exception 'nobody is free for that time' using errcode = 'SL003';
    end if;
  end if;

  -- 23P01 from here is the exclusion constraint: that chair is already taken.
  update bookings set staff_id = v_staff, updated_at = now() where id = b.id;

  return v_staff;
end;
$$;

comment on function public.reassign_appointment(uuid, uuid) is
  'Hands an appointment to another specialist at the same salon. Null means "whoever is free" '
  'and assigns one, rather than clearing the chair — an unassigned booking sits outside the '
  'no-double-booking constraint, which is what 0008 closed.';

revoke all on function public.reassign_appointment(uuid, uuid) from public;
revoke execute on function public.reassign_appointment(uuid, uuid) from anon;
grant execute on function public.reassign_appointment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A stylist belongs to one salon, and so does every row that names one
-- ---------------------------------------------------------------------------

-- Three tables carry a staff_id beside a salon_id and never compared them.
-- Written as triggers rather than check constraints because the answer lives in
-- another table, and as one function per table so the error says which.

create function public.staff_matches_salon()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.staff_id is not null
     and not exists (
       select 1 from staff st where st.id = new.staff_id and st.salon_id = new.salon_id
     )
  then
    raise exception 'that specialist does not work at this salon' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.staff_matches_salon() is
  'A row naming both a salon and a stylist must name a stylist of that salon. Without it one '
  'salon could write time_off against another salon''s staff, or book their chair.';

revoke all on function public.staff_matches_salon() from public;
revoke execute on function public.staff_matches_salon() from anon, authenticated;

-- time_off: salon B wrote "Layla is away for thirty days" against salon A's
-- Layla. available_slots() still offered her (it scopes by salon) but
-- create_booking() refused (it did not), so customers were offered times that
-- were then rejected — for a month, invisibly.
create trigger time_off_staff_matches_salon
  before insert or update on time_off
  for each row
  execute function public.staff_matches_salon();

-- bookings: belt and braces. create_booking() and create_walkin_booking() both
-- scope their staff lookup to the salon already, and section 3 took the column
-- away from the browser — this makes the rule true of every path, including
-- ones not written yet.
create trigger bookings_staff_matches_salon
  before insert or update on bookings
  for each row
  execute function public.staff_matches_salon();

-- staff_services says "this service may only be done by these people". Its
-- policy checked that you own the *stylist*, not that the *service* is yours,
-- so salon B could link its own stylist to salon A's haircut — after which
-- nobody at A was "qualified" and every booking failed with "nobody is free".
create function public.staff_service_same_salon()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from staff st
    join services sv on sv.id = new.service_id
    where st.id = new.staff_id and st.salon_id = sv.salon_id
  ) then
    raise exception 'a specialist can only be linked to their own salon''s services'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.staff_service_same_salon() from public;
revoke execute on function public.staff_service_same_salon() from anon, authenticated;

create trigger staff_services_same_salon
  before insert or update on staff_services
  for each row
  execute function public.staff_service_same_salon();

-- And the policy itself, which asked the wrong question. Both sides now.
drop policy if exists staff_services_write on staff_services;
create policy staff_services_write on staff_services
  for all to authenticated
  using (exists (
    select 1 from staff st join services sv on sv.id = staff_services.service_id
    where st.id = staff_services.staff_id
      and is_salon_owner(st.salon_id)
      and sv.salon_id = st.salon_id
  ))
  with check (exists (
    select 1 from staff st join services sv on sv.id = staff_services.service_id
    where st.id = staff_services.staff_id
      and is_salon_owner(st.salon_id)
      and sv.salon_id = st.salon_id
  ));

-- ---------------------------------------------------------------------------
-- 5. A review's reply is not the reviewer's to write
-- ---------------------------------------------------------------------------

-- 0006 revoked UPDATE on reviews and 0007 made replying a function, so the
-- salon's side of a review looked closed. INSERT was still column-blind: a
-- one-star review could arrive with `reply` already filled in — "We agree, we
-- are awful" — over the salon's name, and replied_at set so it looked answered.
--
-- Not reachable from the app today (writing a review is not built yet), which
-- is exactly why it was worth closing before it is.
revoke insert on reviews from authenticated;

grant insert (
  booking_id,
  salon_id,
  customer_id,
  rating,
  body
) on reviews to authenticated;

comment on column reviews.reply is
  'The salon''s answer. Written only by reply_to_review() (0007) — authenticated can neither '
  'UPDATE it (0006) nor INSERT it (0015).';

-- ---------------------------------------------------------------------------
-- 6. A photograph row cannot point into another salon's folder
-- ---------------------------------------------------------------------------

-- 0013's storage policies are sound: a salon can only write files inside its
-- own folder, and assertion 89 proves it. But salon_media — the row that says
-- "this is my cover" — was only checked for salon_id, and its storage_path
-- could name any object in the bucket. So a salon could display a rival's
-- photographs as its own without ever touching their folder.
--
-- The path is the permission (0013), so the row has to obey the same rule the
-- files do.
alter table salon_media
  add constraint media_path_inside_own_folder
  check (storage_path like salon_id::text || '/%');

comment on column salon_media.storage_path is
  'Always `<salon id>/<kind>/<file>`, and constrained to start with this row''s own salon id '
  '(0015). The path is the permission — see 0013 — so a row that points elsewhere would be a '
  'photograph displayed under a salon that never had the right to it.';

-- ---------------------------------------------------------------------------
-- 7. Nothing a person types is unbounded
-- ---------------------------------------------------------------------------

-- No free-text column had a maximum, and the catalogue every visitor downloads
-- on the home screen is built out of these. A one-megabyte salon name is one
-- request, and it is served to everybody.
--
-- The limits are generous — they are a backstop against abuse, not a style
-- guide — and the forms cap the same values so an honest owner is trimmed as
-- they type rather than refused on save.
alter table salons
  add constraint salon_text_lengths check (
    length(name_en) <= 80 and length(name_ar) <= 80
    and length(tags_en) <= 200 and length(tags_ar) <= 200
    and length(category_en) <= 60 and length(category_ar) <= 60
    and length(area_en) <= 80 and length(area_ar) <= 80
    and length(city) <= 60 and length(slug) <= 80
    and (cr_number is null or length(cr_number) <= 30)
    and (phone is null or length(phone) <= 20)
  );

alter table services
  add constraint service_text_lengths check (
    length(name_en) <= 80 and length(name_ar) <= 80
  );

alter table staff
  add constraint staff_text_lengths check (
    length(name_en) <= 60 and length(name_ar) <= 60
    and length(role_en) <= 60 and length(role_ar) <= 60
    and length(initials) <= 4
  );

alter table bookings
  add constraint booking_text_lengths check (
    length(notes) <= 500
    and (cancellation_reason is null or length(cancellation_reason) <= 200)
  );

alter table reviews
  add constraint review_text_lengths check (
    length(body) <= 1000 and length(reply) <= 1000
  );

alter table time_off
  add constraint time_off_reason_length check (length(reason) <= 200);

alter table salon_media
  add constraint media_alt_text_length check (length(alt_text) <= 200);

-- ---------------------------------------------------------------------------
-- 8. One account cannot hold a salon's whole day
-- ---------------------------------------------------------------------------

-- Nothing capped how many bookings an account could hold, and nothing is paid,
-- so one account could take every slot at a salon for a day and simply not turn
-- up. A trigger rather than a change to create_booking(), so the rule holds for
-- every path that writes a booking — including claim_waitlist_offer() and
-- anything added later.
--
-- Walk-ins are exempt: they have no customer_id, and a salon filling its own
-- day is a salon having a good day.
--
-- The real answer is a deposit, which needs payments. This is what can be done
-- before then.
create function public.enforce_booking_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_same_day integer;
  v_upcoming integer;
begin
  if new.customer_id is null or new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  select count(*) into v_same_day
  from bookings b
  where b.customer_id = new.customer_id
    and b.salon_id = new.salon_id
    and b.status in ('pending', 'confirmed')
    and b.id is distinct from new.id
    and (b.starts_at at time zone 'Asia/Riyadh')::date
        = (new.starts_at at time zone 'Asia/Riyadh')::date;

  if v_same_day >= 3 then
    raise exception 'that is already three appointments at this salon on one day'
      using errcode = 'SL006';
  end if;

  select count(*) into v_upcoming
  from bookings b
  where b.customer_id = new.customer_id
    and b.status in ('pending', 'confirmed')
    and b.id is distinct from new.id
    and b.starts_at > now();

  if v_upcoming >= 12 then
    raise exception 'too many appointments booked and not yet attended'
      using errcode = 'SL006';
  end if;

  return new;
end;
$$;

comment on function public.enforce_booking_cap() is
  'Caps how much of a salon''s day one account can hold: three at a salon on one day, twelve '
  'upcoming in total. Nothing is paid yet, so without this a day could be booked out for free.';

revoke all on function public.enforce_booking_cap() from public;
revoke execute on function public.enforce_booking_cap() from anon, authenticated;

create trigger bookings_cap_per_customer
  before insert on bookings
  for each row
  execute function public.enforce_booking_cap();

-- ---------------------------------------------------------------------------
-- 9. A salon that is not public does not answer questions about its day
-- ---------------------------------------------------------------------------

-- available_slots() is open to anon on purpose — browsing is ungated, and the
-- booking screen needs it before anybody signs in. It never asked whether the
-- salon was published, so a salon still awaiting review would answer with its
-- opening hours and the shape of its bookings to anyone holding its id.
--
-- Renamed and wrapped rather than rewritten: the body is 150 lines of
-- availability arithmetic and copying it to add one guard is how the two copies
-- start disagreeing.
alter function public.available_slots(uuid, date, integer, uuid, uuid[], uuid)
  rename to available_slots_for_open_salon;

revoke execute on function
  public.available_slots_for_open_salon(uuid, date, integer, uuid, uuid[], uuid)
  from anon, authenticated;

create function public.available_slots(
  p_salon_id           uuid,
  p_day                date,
  p_duration_minutes   integer,
  p_staff_id           uuid default null,
  p_service_ids        uuid[] default null,
  p_exclude_booking_id uuid default null
)
returns table (slot_at timestamptz, is_free boolean, staff_free integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- No rows rather than an error: the screen already knows how to say "not
  -- open", and a salon under review is not the visitor's business either way.
  if not (salon_is_public(p_salon_id) or is_salon_owner(p_salon_id)) then
    return;
  end if;

  return query
  select *
  from available_slots_for_open_salon(
    p_salon_id, p_day, p_duration_minutes, p_staff_id, p_service_ids, p_exclude_booking_id
  );
end;
$$;

comment on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid) is
  'Free times at a published salon, or at your own. Anonymous visitors may ask, because browsing '
  'is ungated; a salon still awaiting review answers nothing to anybody but its owner.';

revoke all on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid) from public;
grant execute on function public.available_slots(uuid, date, integer, uuid, uuid[], uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. The photograph bucket stops being listable
-- ---------------------------------------------------------------------------

-- A public bucket serves its files without consulting row-level security, so
-- this policy never made photographs load. What it did was make the bucket
-- *listable*: an anonymous visitor could enumerate every object in it, and the
-- folder names are salon ids — unpublished salons included.
--
-- Dropping it changes nothing about what customers see. Photographs are fetched
-- by public URL, which does not come through here.
drop policy if exists salon_photos_read on storage.objects;

-- An owner still lists their own folder, which is what the Gallery screen does
-- after an upload.
create policy salon_photos_list_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 11. A commercial registration number is not public
-- ---------------------------------------------------------------------------

-- SELECT is column-blind like the rest, and the catalogue asked for `select *`,
-- so every visitor — signed out — was handed each salon's CR number and the
-- account id of its owner. The phone number is meant to be public. Those two
-- are not.
--
-- Revoked from authenticated as well, not just anon: signup is open, so
-- "signed in" is not a meaningful filter. The owner reads their own through the
-- function below, the same pattern as the 0005 vendor functions.
-- Revoking a column from a table-wide grant does nothing — `grant select on
-- salons` means every column, including ones added later. The table grant has
-- to go and the columns be named. That is also why this lists them all: leaving
-- one out here silently breaks a screen rather than failing loudly.
revoke select on salons from anon, authenticated;

grant select (
  id, slug, name_en, name_ar, tags_en, tags_ar, category_en, category_ar,
  area_en, area_ar, city, latitude, longitude, phone,
  is_verified, is_published, waitlist_enabled, slot_step_minutes,
  created_at, updated_at
) on salons to anon;

-- Signed in, plus owner_id: `data/owner.ts` finds the salon you own by
-- filtering on it, and filtering needs the privilege. It identifies an account
-- that cannot itself be read, so it gives away nothing on its own.
grant select (
  id, owner_id, slug, name_en, name_ar, tags_en, tags_ar, category_en, category_ar,
  area_en, area_ar, city, latitude, longitude, phone,
  is_verified, is_published, waitlist_enabled, slot_step_minutes,
  created_at, updated_at
) on salons to authenticated;

create function public.my_salon_cr(p_salon_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.cr_number
  from salons s
  where s.id = p_salon_id
    and s.owner_id = auth.uid();
$$;

comment on function public.my_salon_cr(uuid) is
  'The commercial registration number of a salon you own, and null for one you do not. Exists '
  'because SELECT on that column is revoked from everybody (0015) — it identifies a business to '
  'the government, and the catalogue was handing it to anonymous visitors.';

revoke all on function public.my_salon_cr(uuid) from public;
revoke execute on function public.my_salon_cr(uuid) from anon;
grant execute on function public.my_salon_cr(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   Rate limiting on sign-in.  Supabase's own setting, not a schema change.
--   Deposits.                  Needs payments. Section 8 is the interim.
--   Photo moderation.          A product decision, not a permission.
--   Deleting an account.       Its own migration, and a store requirement
--                              rather than a breach.
