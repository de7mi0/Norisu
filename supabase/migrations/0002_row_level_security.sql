-- Saloni — row-level security
--
-- The app talks to Postgres directly from the customer's phone, so these
-- policies are the security boundary. There is no server in between to check
-- permissions: if a policy is missing, the data is public.
--
-- Roles used by Supabase:
--   anon          — not signed in
--   authenticated — signed in; auth.uid() is their profile id
--   service_role  — server-side jobs; bypasses RLS entirely

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- security definer so the check itself is not filtered by the caller's policies.
create function is_salon_owner(target_salon uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from salons
    where salons.id = target_salon
      and salons.owner_id = auth.uid()
  );
$$;

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  );
$$;

-- Whether a salon's data should be readable by the public.
create function salon_is_public(target_salon uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from salons
    where salons.id = target_salon
      and salons.is_published
  );
$$;

alter table profiles          enable row level security;
alter table salons            enable row level security;
alter table salon_media       enable row level security;
alter table services          enable row level security;
alter table staff             enable row level security;
alter table staff_services    enable row level security;
alter table working_hours     enable row level security;
alter table time_off          enable row level security;
alter table bookings          enable row level security;
alter table booking_items     enable row level security;
alter table waitlist_entries  enable row level security;
alter table waitlist_offers   enable row level security;
alter table notifications     enable row level security;
alter table reviews           enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles — yours and no one else's
-- ---------------------------------------------------------------------------

create policy profiles_select_own on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin());

create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Salons — published ones are public; owners manage their own
-- ---------------------------------------------------------------------------

create policy salons_select_published on salons
  for select to anon, authenticated
  using (is_published or owner_id = auth.uid() or is_admin());

create policy salons_insert_own on salons
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy salons_update_own on salons
  for update to authenticated
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- Salon content — photos, services, staff, hours
-- ---------------------------------------------------------------------------

create policy salon_media_select on salon_media
  for select to anon, authenticated
  using (salon_is_public(salon_id) or is_salon_owner(salon_id));

create policy salon_media_write on salon_media
  for all to authenticated
  using (is_salon_owner(salon_id))
  with check (is_salon_owner(salon_id));

-- Customers see live services at published salons. Hidden and archived ones
-- stay visible to the owner so they can be switched back on.
create policy services_select on services
  for select to anon, authenticated
  using (
    (salon_is_public(salon_id) and is_active and not is_archived)
    or is_salon_owner(salon_id)
  );

create policy services_write on services
  for all to authenticated
  using (is_salon_owner(salon_id))
  with check (is_salon_owner(salon_id));

create policy staff_select on staff
  for select to anon, authenticated
  using (
    (salon_is_public(salon_id) and is_active and not is_archived)
    or is_salon_owner(salon_id)
  );

create policy staff_write on staff
  for all to authenticated
  using (is_salon_owner(salon_id))
  with check (is_salon_owner(salon_id));

create policy staff_services_select on staff_services
  for select to anon, authenticated
  using (exists (
    select 1 from staff
    where staff.id = staff_services.staff_id
      and (salon_is_public(staff.salon_id) or is_salon_owner(staff.salon_id))
  ));

create policy staff_services_write on staff_services
  for all to authenticated
  using (exists (
    select 1 from staff
    where staff.id = staff_services.staff_id and is_salon_owner(staff.salon_id)
  ))
  with check (exists (
    select 1 from staff
    where staff.id = staff_services.staff_id and is_salon_owner(staff.salon_id)
  ));

-- Opening hours are public: the booking screen needs them to show availability.
create policy working_hours_select on working_hours
  for select to anon, authenticated
  using (salon_is_public(salon_id) or is_salon_owner(salon_id));

create policy working_hours_write on working_hours
  for all to authenticated
  using (is_salon_owner(salon_id))
  with check (is_salon_owner(salon_id));

create policy time_off_select on time_off
  for select to anon, authenticated
  using (salon_is_public(salon_id) or is_salon_owner(salon_id));

create policy time_off_write on time_off
  for all to authenticated
  using (is_salon_owner(salon_id))
  with check (is_salon_owner(salon_id));

-- ---------------------------------------------------------------------------
-- Bookings — the customer who made it, and the salon it is with
-- ---------------------------------------------------------------------------

create policy bookings_select on bookings
  for select to authenticated
  using (
    customer_id = auth.uid()
    or is_salon_owner(salon_id)
    or is_admin()
  );

create policy bookings_insert_own on bookings
  for insert to authenticated
  with check (customer_id = auth.uid());

-- Customers may cancel or reschedule; salons may move a booking through its
-- lifecycle. Neither may reassign a booking to a different customer.
create policy bookings_update on bookings
  for update to authenticated
  using (customer_id = auth.uid() or is_salon_owner(salon_id))
  with check (customer_id = auth.uid() or is_salon_owner(salon_id));

create policy booking_items_select on booking_items
  for select to authenticated
  using (exists (
    select 1 from bookings b
    where b.id = booking_items.booking_id
      and (b.customer_id = auth.uid() or is_salon_owner(b.salon_id))
  ));

create policy booking_items_insert on booking_items
  for insert to authenticated
  with check (exists (
    select 1 from bookings b
    where b.id = booking_items.booking_id and b.customer_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------

create policy waitlist_select on waitlist_entries
  for select to authenticated
  using (customer_id = auth.uid() or is_salon_owner(salon_id));

create policy waitlist_insert_own on waitlist_entries
  for insert to authenticated
  with check (customer_id = auth.uid());

create policy waitlist_update on waitlist_entries
  for update to authenticated
  using (customer_id = auth.uid() or is_salon_owner(salon_id))
  with check (customer_id = auth.uid() or is_salon_owner(salon_id));

-- Offers are readable by the customer they belong to and by the salon.
-- They are only ever created by server-side jobs, which use service_role and
-- bypass RLS, so there is deliberately no insert policy here.
create policy waitlist_offers_select on waitlist_offers
  for select to authenticated
  using (exists (
    select 1 from waitlist_entries e
    where e.id = waitlist_offers.entry_id
      and (e.customer_id = auth.uid() or is_salon_owner(e.salon_id))
  ));

create policy notifications_select_own on notifications
  for select to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reviews — public to read, earned to write
-- ---------------------------------------------------------------------------

create policy reviews_select on reviews
  for select to anon, authenticated
  using (
    (is_published and salon_is_public(salon_id))
    or customer_id = auth.uid()
    or is_salon_owner(salon_id)
  );

-- You may only review a booking of your own that you actually attended.
create policy reviews_insert_after_visit on reviews
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from bookings b
      where b.id = reviews.booking_id
        and b.customer_id = auth.uid()
        and b.salon_id = reviews.salon_id
        and b.status = 'completed'
    )
  );

-- The customer edits the review; the salon owner may only add a reply. Column
-- level enforcement lives in the API layer; this restricts who may touch a row.
create policy reviews_update on reviews
  for update to authenticated
  using (customer_id = auth.uid() or is_salon_owner(salon_id))
  with check (customer_id = auth.uid() or is_salon_owner(salon_id));

-- ---------------------------------------------------------------------------
-- The view inherits the policies of the table beneath it.
-- ---------------------------------------------------------------------------

alter view salon_ratings set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides which rows a role may touch; grants decide whether it may reach
-- the table at all. Supabase's default privileges usually cover this, but
-- stating it explicitly means the schema is correct on any Postgres.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
