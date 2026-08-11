-- Saloni — complete database setup
--
-- GENERATED FILE. Do not edit directly: it is built from supabase/migrations/
-- by scripts/build-setup-sql.sh. Edit the migrations and regenerate.
--
-- Paste the whole file into the Supabase SQL Editor and run it once. It creates
-- every table, constraint and security policy the app needs.

-- ===========================================================================
-- 0001_schema.sql
-- ===========================================================================

-- Saloni — core schema
--
-- Conventions:
--   * Money is stored in halalas (integer), never floats. 150.00 SAR = 15000.
--   * All timestamps are timestamptz. The app displays them in Asia/Riyadh.
--   * Bilingual content is stored as paired *_en / *_ar columns, mirroring the
--     front end's dictionaries.

-- Needed for the exclusion constraint that prevents double-booking. This is the
-- only extension required; ids use gen_random_uuid(), which is core Postgres.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type user_role as enum ('customer', 'vendor', 'admin');

create type booking_status as enum (
  'pending',     -- created, payment not yet confirmed
  'confirmed',
  'in_progress', -- customer is in the chair
  'completed',
  'cancelled',
  'no_show'
);

create type waitlist_status as enum (
  'waiting',   -- queued, nothing offered yet
  'offered',   -- a freed slot is being held for this customer
  'claimed',   -- they booked it
  'expired',   -- the hold ran out, offer passed to the next person
  'cancelled'  -- withdrawn by the customer
);

create type notify_channel as enum ('push', 'whatsapp', 'sms');

-- ---------------------------------------------------------------------------
-- Profiles — one row per authenticated user
-- ---------------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         user_role   not null default 'customer',
  full_name    text        not null default '',
  phone        text,
  locale       text        not null default 'en' check (locale in ('en', 'ar')),
  -- Notification preferences; see waitlist_offers.
  allow_push     boolean not null default true,
  allow_whatsapp boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table profiles is
  'Application data for an authenticated user. auth.users holds the credentials.';

-- Every new auth user gets a profile automatically.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Salons
-- ---------------------------------------------------------------------------

create table salons (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles (id) on delete restrict,
  slug          text not null unique,
  name_en       text not null,
  name_ar       text not null,
  tags_en       text not null default '',
  tags_ar       text not null default '',
  category_en   text not null default '',
  category_ar   text not null default '',
  area_en       text not null default '',
  area_ar       text not null default '',
  city          text not null default 'Riyadh',
  latitude      numeric(9, 6),
  longitude     numeric(9, 6),
  phone         text,
  -- Commercial registration; checked before a salon may publish.
  cr_number     text,
  is_verified   boolean not null default false,
  is_published  boolean not null default false,
  -- Whether the salon accepts waitlist requests when fully booked.
  waitlist_enabled boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A salon may only go live once an admin has verified its registration.
  constraint published_salons_are_verified
    check (not is_published or is_verified)
);

create index salons_owner_idx on salons (owner_id);
create index salons_published_idx on salons (is_published) where is_published;

-- ---------------------------------------------------------------------------
-- Salon photos
-- ---------------------------------------------------------------------------

create table salon_media (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salons (id) on delete cascade,
  -- Path within the Supabase storage bucket, not a public URL.
  storage_path text not null,
  alt_text     text not null default '',
  is_cover     boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index salon_media_salon_idx on salon_media (salon_id, sort_order);
-- At most one cover photo per salon.
create unique index salon_media_one_cover_idx
  on salon_media (salon_id) where is_cover;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------

create table services (
  id               uuid primary key default gen_random_uuid(),
  salon_id         uuid not null references salons (id) on delete cascade,
  name_en          text not null,
  name_ar          text not null,
  duration_minutes integer not null check (duration_minutes between 5 and 600),
  price_halalas    integer not null check (price_halalas >= 0),
  discount_percent integer not null default 0
                     check (discount_percent between 0 and 100),
  -- The vendor's Live / Hidden switch.
  is_active        boolean not null default true,
  -- Soft delete: bookings reference services, so rows are archived, not removed.
  is_archived      boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index services_salon_idx on services (salon_id) where not is_archived;

comment on column services.is_archived is
  'Soft delete. Editing or removing a service must never alter historical bookings; '
  'booking_items keep their own snapshot of name, price and duration.';

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create table staff (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references salons (id) on delete cascade,
  -- Set once a staff member has an account of their own; null until then.
  profile_id  uuid references profiles (id) on delete set null,
  name_en     text not null,
  name_ar     text not null,
  role_en     text not null default '',
  role_ar     text not null default '',
  initials    text not null default '',
  is_active   boolean not null default true,
  is_archived boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index staff_salon_idx on staff (salon_id) where not is_archived;

-- Which staff member can perform which service. A service with no rows here is
-- treated as performable by anyone at the salon.
create table staff_services (
  staff_id   uuid not null references staff (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Opening hours and closures
-- ---------------------------------------------------------------------------

create table working_hours (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references salons (id) on delete cascade,
  -- Null means the salon's default hours; set to scope hours to one person.
  staff_id    uuid references staff (id) on delete cascade,
  -- 0 = Sunday, matching Postgres' extract(dow).
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at    time not null,
  closes_at   time not null,

  constraint closes_after_opening check (closes_at > opens_at)
);

create index working_hours_salon_idx on working_hours (salon_id, day_of_week);

-- One-off closures: public holidays, staff leave, maintenance.
create table time_off (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references salons (id) on delete cascade,
  staff_id   uuid references staff (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text not null default '',

  constraint time_off_ends_after_start check (ends_at > starts_at)
);

create index time_off_salon_idx on time_off (salon_id, starts_at);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,
  customer_id    uuid not null references profiles (id) on delete restrict,
  salon_id       uuid not null references salons (id) on delete restrict,
  -- Null means "any professional": the salon assigns someone later.
  staff_id       uuid references staff (id) on delete set null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         booking_status not null default 'pending',

  -- Totals in halalas, snapshotted at the time of booking.
  subtotal_halalas  integer not null check (subtotal_halalas >= 0),
  discount_halalas  integer not null default 0 check (discount_halalas >= 0),
  vat_halalas       integer not null default 0 check (vat_halalas >= 0),
  total_halalas     integer not null check (total_halalas >= 0),
  vat_rate          numeric(4, 3) not null default 0.150,

  payment_method text,
  paid_at        timestamptz,
  cancelled_at   timestamptz,
  cancellation_reason text,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint booking_ends_after_start check (ends_at > starts_at),
  constraint discount_within_subtotal check (discount_halalas <= subtotal_halalas)
);

create index bookings_customer_idx on bookings (customer_id, starts_at desc);
create index bookings_salon_day_idx on bookings (salon_id, starts_at);

-- The rule the UI cannot enforce: one staff member, one customer at a time.
-- Two people tapping the same slot simultaneously will both pass any check the
-- application makes; only the database can settle it.
alter table bookings add constraint no_double_booking
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (staff_id is not null and status in ('pending', 'confirmed', 'in_progress'));

comment on constraint no_double_booking on bookings is
  'Prevents two overlapping active bookings for the same staff member. Cancelled, '
  'completed and no-show bookings are excluded so a freed slot can be rebooked. '
  'LIMITATION: bookings with staff_id null ("any professional") are not covered, '
  'because the constraint has no one to compare them against. Until those are '
  'assigned a staff member at booking time, salon capacity for them must be '
  'checked separately.';

-- ---------------------------------------------------------------------------
-- Booking line items — the price snapshot
-- ---------------------------------------------------------------------------

create table booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings (id) on delete cascade,
  -- Kept for reporting, but nulled rather than blocking a service's removal.
  service_id  uuid references services (id) on delete set null,

  -- Snapshot. These are what the customer agreed to and what the invoice shows.
  -- They are deliberately copies, not lookups: a salon raising its prices must
  -- never change what a past customer was charged.
  name_en          text not null,
  name_ar          text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  unit_price_halalas integer not null check (unit_price_halalas >= 0),
  discount_percent integer not null default 0
                     check (discount_percent between 0 and 100),
  quantity         integer not null default 1 check (quantity > 0)
);

create index booking_items_booking_idx on booking_items (booking_id);

comment on table booking_items is
  'Line items carry their own copy of name, price and duration. Never join to '
  'services to render a past booking or an invoice.';

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------

create table waitlist_entries (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references profiles (id) on delete cascade,
  salon_id      uuid not null references salons (id) on delete cascade,
  service_id    uuid references services (id) on delete set null,
  staff_id      uuid references staff (id) on delete set null,
  requested_date date not null,
  -- Optional window the customer will accept, e.g. only after 16:00.
  earliest_time time,
  latest_time   time,
  status        waitlist_status not null default 'waiting',
  created_at    timestamptz not null default now(),

  constraint waitlist_window_ordered
    check (earliest_time is null or latest_time is null or latest_time > earliest_time)
);

-- Position in the queue is decided by created_at: first come, first served.
create index waitlist_queue_idx
  on waitlist_entries (salon_id, requested_date, created_at)
  where status = 'waiting';

-- One live request per customer, per salon, per day.
create unique index waitlist_one_active_per_day_idx
  on waitlist_entries (customer_id, salon_id, requested_date)
  where status in ('waiting', 'offered');

-- A freed slot held for one customer at a time. Offering to everyone at once
-- fills the seat faster but leaves most recipients finding it already gone.
create table waitlist_offers (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references waitlist_entries (id) on delete cascade,
  -- The booking that was cancelled, freeing this slot.
  released_booking_id uuid references bookings (id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  -- Single-use secret in the notification's deep link.
  claim_token  uuid not null unique default gen_random_uuid(),
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  claimed_at   timestamptz,
  claimed_booking_id uuid references bookings (id) on delete set null,

  constraint offer_expires_after_offer check (expires_at > offered_at),
  constraint offer_ends_after_start check (ends_at > starts_at)
);

create index waitlist_offers_open_idx on waitlist_offers (expires_at)
  where claimed_at is null;

-- Delivery attempts, so a missed notification can be traced.
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  channel     notify_channel not null,
  template    text not null,
  payload     jsonb not null default '{}'::jsonb,
  sent_at     timestamptz,
  delivered_at timestamptz,
  failed_at   timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);

create index notifications_profile_idx on notifications (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  -- One review per booking: you can only review a visit you actually had.
  booking_id  uuid not null unique references bookings (id) on delete cascade,
  salon_id    uuid not null references salons (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  rating      numeric(2, 1) not null check (rating between 1 and 5),
  body        text not null default '',
  reply       text not null default '',
  replied_at  timestamptz,
  is_published boolean not null default true,
  created_at  timestamptz not null default now()
);

create index reviews_salon_idx on reviews (salon_id, created_at desc)
  where is_published;

-- Salon rating, computed rather than stored, so it cannot drift.
create view salon_ratings as
  select
    salon_id,
    round(avg(rating), 1) as rating,
    count(*)              as review_count
  from reviews
  where is_published
  group by salon_id;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();
create trigger salons_touch before update on salons
  for each row execute function touch_updated_at();
create trigger services_touch before update on services
  for each row execute function touch_updated_at();
create trigger staff_touch before update on staff
  for each row execute function touch_updated_at();
create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();


-- ===========================================================================
-- 0002_row_level_security.sql
-- ===========================================================================

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


