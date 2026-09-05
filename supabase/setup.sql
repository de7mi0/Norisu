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


-- ===========================================================================
-- 0003_availability.sql
-- ===========================================================================

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


-- ===========================================================================
-- 0004_owner_cannot_self_verify.sql
-- ===========================================================================

-- Saloni — an owner may edit their salon, but not approve it
--
-- salons_update_own lets an owner update their own row, and the blanket
-- `grant update on all tables ... to authenticated` in 0002 meant that covered
-- *every* column — including is_verified and is_published.
--
-- So any salon owner could run
--
--   update salons set is_verified = true, is_published = true where id = <mine>
--
-- and appear in the customer catalogue immediately, with nobody having checked
-- their commercial registration. published_salons_are_verified enforces the
-- *order* of those two flags, not who is allowed to set them, so it did not
-- help: setting both at once satisfies it.
--
-- Row-level security cannot express "this column is off limits" — a policy sees
-- whole rows. Column-level privileges can, and are the right tool here.
--
-- Approval stays a human act performed in the Supabase dashboard, which
-- connects as service_role and is unaffected by this. See supabase/README.md.

revoke update on salons from authenticated;

-- Everything an owner legitimately maintains about their own salon. Deliberately
-- enumerated rather than "all except": a column added later is not writable
-- until someone decides it should be, which is the safer way round for a
-- privilege boundary.
--
-- Left out on purpose:
--   id, created_at   — not the owner's to change
--   owner_id         — a salon is not transferable in the app
--   is_verified      — the approval itself
--   is_published     — going live follows approval, not the owner's say-so
grant update (
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
  updated_at,
  slot_step_minutes
) on salons to authenticated;

comment on column salons.is_verified is
  'Set only by an admin through the dashboard. authenticated has no UPDATE privilege on this column — see 0004.';

comment on column salons.is_published is
  'Follows verification, and like it is not writable by the salon owner. See 0004.';


-- ===========================================================================
-- 0005_vendor_day.sql
-- ===========================================================================

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
  is_open            boolean,
  -- Null until somebody reviews the salon. The dashboard says "New" rather
  -- than 0.0, the same way the customer-facing card already does.
  rating             numeric,
  review_count       integer
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
    (v_open_minutes > 0),
    -- salon_ratings is a view over published reviews only, and has no row at
    -- all for a salon nobody has reviewed. Read through it rather than
    -- averaging here, so the owner's tile and the customer's card can never
    -- disagree about the same salon.
    (select sr.rating from salon_ratings sr where sr.salon_id = p_salon_id),
    (select sr.review_count::integer from salon_ratings sr where sr.salon_id = p_salon_id);
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


-- ===========================================================================
-- 0006_column_privileges.sql
-- ===========================================================================

-- Saloni — who may write which column
--
-- 0002 grants `insert, update, delete on all tables to authenticated`, which is
-- column-blind, and row-level policies see whole rows. Between them, every
-- policy that says "you may edit your own X" has until now meant "you may edit
-- *every field* of your own X".
--
-- 0004 already met this once: an owner could set is_verified on their own salon
-- and walk into the customer catalogue unchecked. That fixed one table. An
-- audit found the same shape on three more, each confirmed by carrying the
-- attack out against a real database rather than by reading the policies:
--
--   profiles  A signed-in customer ran `update profiles set role = 'admin'`
--             on their own row. is_admin() reads exactly that column, so they
--             then read every profile, every booking at every salon, and every
--             unpublished salon — and could write any salon's row. One
--             statement from a browser console to the whole customer database.
--
--   reviews   A salon owner rewrote a customer's review of them: 1.0 "Terrible.
--             Rude staff and dirty tools." became 5.0 "Wonderful, best salon in
--             Riyadh!", still in the customer's name. salon_ratings averages
--             that column, so it fabricates the score people choose a salon on.
--
--   bookings  The customer set their own booking's subtotal and total to zero;
--             the salon owner set paid_at on a booking nobody had paid for.
--
-- Column privileges are the only thing in Postgres that can express "not this
-- column", so that is what this migration is. Lists are enumerated rather than
-- written as "all except": a column added later is then unwritable until
-- somebody decides it should be, which is the safer way round for a privilege
-- boundary.

-- ---------------------------------------------------------------------------
-- profiles — the critical one
-- ---------------------------------------------------------------------------

revoke update on profiles from authenticated;

-- What is genuinely the account holder's own to set. Left out:
--   role        the escalation above; only an admin may move anyone's role
--   id          the identity itself, and the thing every policy matches on
--   created_at  not the user's to rewrite
grant update (
  full_name,
  phone,
  locale,
  allow_push,
  allow_whatsapp,
  updated_at
) on profiles to authenticated;

comment on column profiles.role is
  'Set only by an admin. authenticated has no UPDATE privilege on this column — see 0006. '
  'is_admin() reads it, so a self-settable role was a full privilege escalation.';

-- ---------------------------------------------------------------------------
-- reviews — revoked outright, with nothing granted back
-- ---------------------------------------------------------------------------

-- reviews_update lets both the customer and the salon owner touch the row, but
-- they need *different* columns of it: the customer owns rating and body, the
-- salon owns reply. Grants apply per role, not per row, so they cannot draw
-- that line and nothing is granted back here.
--
-- Nothing in the app writes reviews today — submitting one and replying to one
-- are both unbuilt — so this costs no behaviour. When replying is built it
-- should arrive as a narrow `security definer` function guarded the way the
-- 0005 functions are, rather than as a column grant that cannot say who.
revoke update on reviews from authenticated;

comment on policy reviews_update on reviews is
  'Row-level permission only. authenticated has no UPDATE privilege on this table at all (0006), '
  'because the customer and the salon own different columns and a grant cannot express that. '
  'Editing and replying belong in security definer functions.';

-- ---------------------------------------------------------------------------
-- bookings — the money columns stop being writable
-- ---------------------------------------------------------------------------

revoke update on bookings from authenticated;

-- What moving, cancelling and running an appointment actually needs. Left out:
--   the five money columns and vat_rate  what was agreed is history, like the
--                                        booking_items snapshot beside it
--   payment_method, paid_at              set when money moves, and only then
--   reference                            what the customer reads out on the phone
--   customer_id, salon_id, id            a booking is not transferable
--   created_at                           not anyone's to rewrite
grant update (
  staff_id,
  starts_at,
  ends_at,
  status,
  cancelled_at,
  cancellation_reason,
  notes,
  updated_at
) on bookings to authenticated;

-- KNOWN GAP, recorded here rather than only in a conversation: this stops the
-- price being *edited*, not *stated*. createBooking() in src/data/bookings.ts
-- still sends subtotal_halalas, vat_halalas and total_halalas from the browser,
-- so a customer can create a booking priced at zero. Only computing the total
-- in Postgres closes that, which is the create_booking() function already
-- planned — the same one that will make the booking and its items atomic.
-- Today the damage is a wrong "Booked today" figure; the day money moves it is
-- a payment bypass, so it must land before payments do.
comment on column bookings.total_halalas is
  'Snapshotted at booking time. Not writable by authenticated after creation (0006). '
  'Still supplied by the client *at* creation — see create_booking() on the roadmap.';

-- ---------------------------------------------------------------------------
-- Which status changes each side may make
-- ---------------------------------------------------------------------------

-- A grant can say which columns you may write, not which values you may write
-- into them, and status needs the second: reviews_insert_after_visit (0002)
-- decides who has earned the right to review by reading `status = 'completed'`.
-- A customer who can set that on their own booking can review a salon they
-- never visited, which is guarantee 5 of the schema quietly failing.
create function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Reschedule and the other ordinary edits never touch status.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- No JWT means service_role: the Supabase dashboard and the migrations
  -- themselves. 0004 left that path working and so does this.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  -- The salon runs the appointment, so it owns the lifecycle. This grants them
  -- nothing they could abuse: a review still has to be written by the
  -- customer's own account, which the salon does not have.
  if is_salon_owner(old.salon_id) then
    return new;
  end if;

  -- The customer may call it off, and that is all. Cancelling something already
  -- finished or already cancelled is rejected too, so the record of what
  -- happened cannot be rewritten after the fact.
  if old.customer_id = auth.uid() then
    if new.status = 'cancelled' and old.status in ('pending', 'confirmed') then
      return new;
    end if;
    raise exception 'a customer may only cancel a pending or confirmed booking'
      using errcode = '42501';
  end if;

  raise exception 'not entitled to change this booking''s status'
    using errcode = '42501';
end;
$$;

comment on function public.enforce_booking_status_transition() is
  'Who may move a booking to which status. Exists because reviews_insert_after_visit trusts '
  'status = ''completed'', and a grant can restrict columns but not values.';

create trigger bookings_status_transition
  before update on bookings
  for each row
  execute function public.enforce_booking_status_transition();


-- ===========================================================================
-- 0007_review_reply.sql
-- ===========================================================================

-- Saloni — a salon answers a review
--
-- 0006 revoked UPDATE on reviews from authenticated outright, and granted
-- nothing back. That was deliberate rather than lazy: the customer owns the
-- rating and the body, the salon owns the reply, and a grant applies per role
-- rather than per row — so there is no column list that describes both. Before
-- it, a salon could rewrite a 1.0 "Terrible" into a 5.0 rave in the customer's
-- own name.
--
-- So replying arrives the way that migration said it would have to: as one
-- narrow security definer function that can write exactly two columns and
-- nothing else, guarded like the 0005 functions are.

-- The longest reply the salon may leave. Long enough to answer a complaint
-- properly, short enough that the review list stays readable and a paste of
-- something else cannot take over the page.
create function public.reply_to_review(
  p_review_id uuid,
  p_reply     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salon uuid;
  v_reply text := left(coalesce(p_reply, ''), 1000);
begin
  select salon_id into v_salon from reviews where id = p_review_id;

  -- A missing review and someone else's review answer identically on purpose:
  -- probing this function must not reveal which reviews exist.
  if v_salon is null or not is_salon_owner(v_salon) then
    raise exception 'not the owner of the salon this review is about'
      using errcode = '42501';
  end if;

  -- Only these two columns. The rating and the body belong to the customer and
  -- this function cannot reach them, which is the whole point of it existing.
  update reviews
     set reply      = btrim(v_reply),
         -- Clearing the reply clears the timestamp too, so "replied" and "has
         -- a reply" can never disagree.
         replied_at = case when btrim(v_reply) = '' then null else now() end
   where id = p_review_id;
end;
$$;

comment on function public.reply_to_review(uuid, text) is
  'Lets a salon answer a review of itself. security definer because 0006 revoked UPDATE on reviews '
  'from authenticated — the customer owns rating and body, the salon owns reply, and a column grant '
  'cannot express that split. Writes reply and replied_at only.';

revoke all on function public.reply_to_review(uuid, text) from public;
grant execute on function public.reply_to_review(uuid, text) to authenticated;


-- ===========================================================================
-- 0008_create_booking.sql
-- ===========================================================================

-- Saloni — making a booking becomes one atomic, server-priced act
--
-- Three gaps have been waiting on the same fix, and they close together because
-- they are all consequences of the browser doing work the database should:
--
--   1. The client stated the price. createBooking sent subtotal, VAT and total
--      itself, so a customer could book at zero from the console. 0006 stopped
--      anyone *editing* a price; nothing stopped them *stating* one.
--
--   2. "Any professional" sat outside the no-double-booking constraint. With
--      staff_id null there is nobody for the exclusion constraint to compare
--      against, so two people racing the last chair could both be written.
--      available_slots() capacity-checks when times are *offered*, which
--      narrows that window without closing it. Open since 0001.
--
--   3. The booking and its items were two round trips with a compensating
--      delete between them, and the compensation could itself fail.
--
-- One function call is one transaction. It prices the booking from the salon's
-- own services, assigns a chair before inserting, and writes both rows or
-- neither.

-- ---------------------------------------------------------------------------
-- Remembering what the customer actually asked for
-- ---------------------------------------------------------------------------

-- Assigning a chair destroys information unless this is recorded: afterwards an
-- "any professional" booking and a "Layla, please" booking look identical, and
-- rescheduling cannot tell whether moving someone to a different chair is
-- helpful or a betrayal. Not writable by authenticated — it is a record of what
-- was asked for at the time, not a field.
alter table bookings
  add column staff_requested boolean not null default false;

comment on column bookings.staff_requested is
  'True when the customer named a specialist rather than taking anyone. reschedule_booking() '
  'keeps that person; an unrequested booking is re-assigned to whoever is free. Set by '
  'create_booking() and not writable afterwards — see 0006 and 0008.';

-- ---------------------------------------------------------------------------
-- Creating a booking stops being something the browser can do
-- ---------------------------------------------------------------------------

-- This is the half that actually closes gap 1. Revoking UPDATE (0006) stopped
-- a price being edited; only revoking INSERT stops one being stated. From here
-- the single way a booking comes into existence is create_booking(), which
-- reads the price out of the services table.
--
-- bookings_insert_own stays in place. The grant means it is never reached now,
-- but it still documents that a booking belongs to the person who made it, and
-- it would matter again if the grant were ever restored.
revoke insert on bookings from authenticated;
revoke insert on booking_items from authenticated;

-- ---------------------------------------------------------------------------
-- Shared assignment logic
-- ---------------------------------------------------------------------------

-- Who could take this appointment, and is free for it.
--
-- Eligibility mirrors available_slots() (0003) deliberately and exactly: a
-- service with no staff_services rows is performable by anyone, and one with
-- them is performable only by the named staff. If these two ever disagree the
-- app offers times it then refuses, which is worse than offering none.
create function public.free_staff_for(
  p_salon_id   uuid,
  p_service_ids uuid[],
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_exclude_booking_id uuid default null
)
returns table (staff_id uuid, sort_order integer, load integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    st.id,
    st.sort_order,
    -- How much that person already has on, in the salon's own day. The caller
    -- orders by this so an unnamed booking spreads across the team instead of
    -- always landing on whoever happens to sort first.
    (
      select count(*)::integer
      from bookings b
      where b.staff_id = st.id
        and b.status in ('pending', 'confirmed', 'in_progress')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and (b.starts_at at time zone 'Asia/Riyadh')::date
            = (p_starts_at at time zone 'Asia/Riyadh')::date
    )
  from staff st
  where st.salon_id = p_salon_id
    and st.is_active
    and not st.is_archived
    -- Qualified for every service asked for.
    and not exists (
      select 1
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) as wanted(service_id)
      where exists (select 1 from staff_services ss where ss.service_id = wanted.service_id)
        and not exists (
          select 1 from staff_services ss2
          where ss2.service_id = wanted.service_id and ss2.staff_id = st.id
        )
    )
    -- Not already in a chair for any of it.
    and not exists (
      select 1 from bookings b
      where b.staff_id = st.id
        and b.status in ('pending', 'confirmed', 'in_progress')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and b.starts_at < p_ends_at
        and b.ends_at   > p_starts_at
    )
    -- Not on leave, and the salon is not closed for the day.
    and not exists (
      select 1 from time_off t
      where (t.staff_id = st.id or (t.staff_id is null and t.salon_id = p_salon_id))
        and t.starts_at < p_ends_at
        and t.ends_at   > p_starts_at
    );
$$;

comment on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid) is
  'Staff who may and can take an appointment, with how much each already has that day. '
  'Eligibility mirrors available_slots() so what is offered and what is accepted agree.';

revoke all on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid) from public;

-- Is the salon open for the whole appointment? Mirrors the window
-- available_slots() steps across, including the per-staff hours override.
create function public.salon_is_open_for(
  p_salon_id  uuid,
  p_staff_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from working_hours wh
    cross join lateral (
      select (p_starts_at at time zone 'Asia/Riyadh')::date as day
    ) d
    where wh.salon_id = p_salon_id
      and wh.day_of_week = extract(dow from d.day)::smallint
      and case
            when p_staff_id is not null
              and exists (
                select 1 from working_hours w2
                where w2.salon_id = p_salon_id and w2.staff_id = p_staff_id
              )
            then wh.staff_id = p_staff_id
            else wh.staff_id is null
          end
      and p_starts_at >= (d.day + wh.opens_at)  at time zone 'Asia/Riyadh'
      and p_ends_at   <= (d.day + wh.closes_at) at time zone 'Asia/Riyadh'
  );
$$;

revoke all on function public.salon_is_open_for(uuid, uuid, timestamptz, timestamptz) from public;

-- A reference a human can read out over the phone. Retried on the unique index
-- rather than trusted to be collision-free.
create function public.new_booking_reference()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  for _ in 1..10 loop
    candidate := 'SL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    if not exists (select 1 from bookings where reference = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'could not allocate a booking reference';
end;
$$;

revoke all on function public.new_booking_reference() from public;

-- ---------------------------------------------------------------------------
-- create_booking()
-- ---------------------------------------------------------------------------

-- There is no customer parameter: the booking belongs to auth.uid(). "A
-- customer cannot book in someone else's name" stops being a rule to police and
-- becomes impossible to express.
--
-- Failure codes the app words for itself:
--   SL001  a service is not bookable at this salon
--   SL002  the salon is not open then
--   SL003  nobody is free
--   23P01  somebody took the chair in between (the exclusion constraint)
create function public.create_booking(
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
  v_reference := new_booking_reference();

  insert into bookings (
    reference, customer_id, salon_id, staff_id, staff_requested,
    starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    payment_method, paid_at
  ) values (
    v_reference, v_customer, p_salon_id, v_staff, p_staff_id is not null,
    p_starts_at, v_ends_at, 'confirmed',
    v_subtotal, v_subtotal - v_net, v_vat, v_net + v_vat, v_vat_rate,
    p_payment_method,
    -- Never set: checkout is simulated and no money has moved. Claiming
    -- otherwise would put a lie in the invoice.
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

  return query select v_booking, v_reference, v_staff, (v_net + v_vat);
end;
$$;

comment on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) is
  'The only way a booking comes into existence. Prices it from the salon''s own services, assigns '
  'a staff member so the no-double-booking constraint applies, and writes the booking and its '
  'items in one transaction. Books for auth.uid() only.';

revoke all on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) from public;
grant execute on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_booking()
-- ---------------------------------------------------------------------------

-- A plain UPDATE cannot re-assign, because it has no idea who is free. Now that
-- every booking has a chair, an unrequested one would otherwise be narrowed to
-- a single diary the customer never asked for.
create function public.reschedule_booking(
  p_booking_id uuid,
  p_starts_at  timestamptz
)
returns table (staff_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  b         bookings%rowtype;
  v_wanted  uuid[];
  v_ends_at timestamptz;
  v_staff   uuid;
begin
  select * into b from bookings where id = p_booking_id;

  -- A booking that is not yours and one that does not exist are refused
  -- identically, so this cannot be used to find out which references are real.
  if b.id is null or b.customer_id is distinct from auth.uid() then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'that appointment can no longer be moved' using errcode = 'SL002';
  end if;

  -- Its own length, kept: the customer agreed to these services at this price.
  v_ends_at := p_starts_at + (b.ends_at - b.starts_at);

  if p_starts_at <= now() then
    raise exception 'that time has already passed' using errcode = 'SL002';
  end if;

  select coalesce(array_agg(service_id) filter (where service_id is not null), '{}'::uuid[])
    into v_wanted
  from booking_items where booking_id = b.id;

  if not salon_is_open_for(b.salon_id,
                           case when b.staff_requested then b.staff_id else null end,
                           p_starts_at, v_ends_at) then
    raise exception 'the salon is not open then' using errcode = 'SL002';
  end if;

  if b.staff_requested then
    -- They asked for this person. Moving them to somebody else would be a
    -- betrayal of that, so the move simply fails if the person is busy.
    select f.staff_id into v_staff
    from free_staff_for(b.salon_id, v_wanted, p_starts_at, v_ends_at, b.id) f
    where f.staff_id = b.staff_id;
  else
    select f.staff_id into v_staff
    from free_staff_for(b.salon_id, v_wanted, p_starts_at, v_ends_at, b.id) f
    order by f.load, f.sort_order, f.staff_id
    limit 1;
  end if;

  if v_staff is null then
    raise exception 'nobody is free for that time' using errcode = 'SL003';
  end if;

  -- Prices are untouched on purpose: this is the same appointment at a new
  -- time, not a new one.
  update bookings
     set starts_at = p_starts_at,
         ends_at   = v_ends_at,
         staff_id  = v_staff
   where id = b.id;

  return query select v_staff;
end;
$$;

comment on function public.reschedule_booking(uuid, timestamptz) is
  'Moves a booking, keeping its length and its price snapshot. Re-assigns the chair when the '
  'customer did not name anyone, and keeps the person when they did.';

revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;


-- ===========================================================================
-- 0009_waitlist.sql
-- ===========================================================================

-- Saloni — the waitlist stops being theatre
--
-- waitlist_entries and waitlist_offers have existed since 0001, with policies, a
-- first-come queue index and a one-entry-per-day constraint, and nothing has
-- ever written a row to either. Joining dispatched a reducer action, a 3.2
-- second timer pretended a seat had opened, and the salon's "Notify" button
-- showed a toast on the owner's own screen.
--
-- How it works now:
--
--   A booking is cancelled -> the freed slot is offered to the person who has
--   been waiting longest -> they hold it for 15 minutes -> if they do not claim
--   it, it passes to the next -> once everybody has had a turn it opens to all
--   of them, first to claim wins.
--
-- Two things about that are worth being straight about.
--
-- There is no push, no SMS and no WhatsApp yet, so an offer reaches a customer
-- only when they next open the app. The queue, the holds and the claim are all
-- genuine; the tap on the shoulder is what is missing, and until it exists most
-- 15-minute holds will lapse unseen. Nothing here changes when notifications
-- land except that people find out in time.
--
-- And nothing can advance on a timer, for the same reason — there is no job
-- runner. Expiry is therefore swept lazily: both read functions sweep before
-- they return, so the queue moves whenever anybody looks at it.

-- ---------------------------------------------------------------------------
-- A waitlist entry is for a basket, not a single service
-- ---------------------------------------------------------------------------

-- service_id has been singular since 0001, but a customer waits with the whole
-- cart they were about to book — and claiming has to reproduce it, priced. The
-- array is what claiming books; service_id keeps the first of them so the
-- foreign key and anything reporting on it still mean something.
alter table waitlist_entries
  add column service_ids uuid[] not null default '{}';

comment on column waitlist_entries.service_ids is
  'Everything the customer was about to book. claim_waitlist_offer() passes these to '
  'create_booking(), so the claimed appointment is the one they actually wanted.';

-- ---------------------------------------------------------------------------
-- Joining is not something a browser gets to do directly
-- ---------------------------------------------------------------------------

-- The same hole 0006 and 0008 closed, and here it is not cosmetic: created_at
-- decides queue position, so an account that can insert its own row can insert
-- itself at the front of the queue. status is writable too, so it could mark
-- itself 'offered' and hold a seat nobody gave it.
revoke insert, update on waitlist_entries from authenticated;

-- waitlist_insert_own and waitlist_update stay as the record of who a row
-- belongs to. The grant means they are no longer reached.

-- How long one person holds a freed seat before it passes on.
create function public.waitlist_hold_minutes()
returns integer
language sql
immutable
as $$ select 15 $$;

-- ---------------------------------------------------------------------------
-- Joining and leaving
-- ---------------------------------------------------------------------------

--   SL010  this salon does not take a waitlist
--   SL011  already waiting for that salon on that day
create function public.join_waitlist(
  p_salon_id       uuid,
  p_service_ids    uuid[],
  p_requested_date date,
  p_earliest_time  time default null,
  p_latest_time    time default null
)
returns table (entry_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer uuid := auth.uid();
  v_wanted   uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_entry    uuid;
begin
  if v_customer is null then
    raise exception 'sign in to join the waitlist' using errcode = '42501';
  end if;

  if not exists (
    select 1 from salons s
    where s.id = p_salon_id and s.is_published and s.waitlist_enabled
  ) then
    raise exception 'this salon is not taking a waitlist' using errcode = 'SL010';
  end if;

  -- Same check create_booking() makes, for the same reason: the services have
  -- to be this salon's and still on its menu, or the claim could not be priced.
  if (select count(*) from services s
      where s.id = any (v_wanted) and s.salon_id = p_salon_id
        and s.is_active and not s.is_archived)
     <> (select count(distinct u.id) from unnest(v_wanted) as u(id))
     or coalesce(array_length(v_wanted, 1), 0) = 0
  then
    raise exception 'one of those services cannot be booked at this salon'
      using errcode = 'SL001';
  end if;

  begin
    insert into waitlist_entries (
      customer_id, salon_id, service_id, service_ids,
      requested_date, earliest_time, latest_time
    ) values (
      v_customer, p_salon_id, v_wanted[1], v_wanted,
      p_requested_date, p_earliest_time, p_latest_time
    )
    returning id into v_entry;
  exception
    -- waitlist_one_active_per_day_idx: one live request per salon per day.
    when unique_violation then
      raise exception 'already on the waitlist for that day' using errcode = 'SL011';
  end;

  return query select v_entry;
end;
$$;

revoke all on function public.join_waitlist(uuid, uuid[], date, time, time) from public;
grant execute on function public.join_waitlist(uuid, uuid[], date, time, time) to authenticated;

create function public.leave_waitlist(p_entry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- Somebody else's entry and one that does not exist are refused identically.
  if not exists (
    select 1 from waitlist_entries
    where id = p_entry_id and customer_id = auth.uid()
  ) then
    raise exception 'not your waitlist entry' using errcode = '42501';
  end if;

  update waitlist_entries set status = 'cancelled' where id = p_entry_id;
end;
$$;

revoke all on function public.leave_waitlist(uuid) from public;
grant execute on function public.leave_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is waiting for a particular freed slot
-- ---------------------------------------------------------------------------

-- Matching is on **time**, not on service. A freed slot is an hour of somebody's
-- day; a customer waiting for a haircut can perfectly well take an hour freed by
-- a colour, and refusing that would leave seats empty for no reason. What the
-- entry's own services decide is the length and the price of what gets booked,
-- and create_booking() settles both at claim time.
--
-- Order is created_at — first come, first served, which is exactly the
-- waitlist_queue_idx that has been sitting in 0001 unused.
create function public.waitlist_matches(
  p_salon_id  uuid,
  p_starts_at timestamptz
)
returns table (entry_id uuid, customer_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.customer_id, e.created_at
  from waitlist_entries e
  cross join lateral (
    select (p_starts_at at time zone 'Asia/Riyadh')::date as day,
           (p_starts_at at time zone 'Asia/Riyadh')::time as at
  ) w
  where e.salon_id = p_salon_id
    and e.requested_date = w.day
    and e.status in ('waiting', 'offered')
    and (e.earliest_time is null or w.at >= e.earliest_time)
    and (e.latest_time  is null or w.at <= e.latest_time)
  order by e.created_at, e.id;
$$;

revoke all on function public.waitlist_matches(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- Offering a freed slot, and passing it on when a hold lapses
-- ---------------------------------------------------------------------------

-- Offers the slot to the longest-waiting person who has not already had a turn
-- at it. Silent when there is nobody left to ask, or when the time has since
-- been taken by an ordinary booking — a waitlist that offers seats that are
-- gone is worse than one that says nothing.
create function public.offer_next_for_slot(
  p_salon_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_released_booking_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry uuid;
begin
  -- Somebody already holds it.
  if exists (
    select 1 from waitlist_offers o
    join waitlist_entries e on e.id = o.entry_id
    where e.salon_id = p_salon_id and o.starts_at = p_starts_at
      and o.claimed_at is null and o.expires_at > now()
  ) then
    return null;
  end if;

  -- Or somebody already took it, through the waitlist or the ordinary route.
  if not exists (
    select 1 from free_staff_for(p_salon_id, '{}'::uuid[], p_starts_at, p_ends_at)
  ) then
    return null;
  end if;

  select m.entry_id into v_entry
  from waitlist_matches(p_salon_id, p_starts_at) m
  join waitlist_entries e on e.id = m.entry_id
  where e.status = 'waiting'
    -- Never the same slot twice to the same person.
    and not exists (
      select 1 from waitlist_offers o
      where o.entry_id = m.entry_id and o.starts_at = p_starts_at
    )
  limit 1;

  if v_entry is null then
    return null;
  end if;

  insert into waitlist_offers (entry_id, released_booking_id, starts_at, ends_at, expires_at)
  values (v_entry, p_released_booking_id, p_starts_at, p_ends_at,
          now() + make_interval(mins => waitlist_hold_minutes()));

  update waitlist_entries set status = 'offered' where id = v_entry;
  return v_entry;
end;
$$;

revoke all on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid) from public;

-- Nothing runs on a schedule here, so lapsed holds are cleared whenever anybody
-- reads the waitlist. Both read functions call this first, which is why they are
-- volatile rather than stable.
create function public.sweep_waitlist(p_salon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  slot record;
begin
  -- A hold that ran out puts its owner back in the queue. The entry keeps its
  -- created_at, so it keeps its place; it simply will not be offered this
  -- particular slot again.
  update waitlist_entries e
     set status = 'waiting'
   where e.salon_id = p_salon_id
     and e.status = 'offered'
     and not exists (
       select 1 from waitlist_offers o
       where o.entry_id = e.id and o.claimed_at is null and o.expires_at > now()
     );

  -- Then pass each lapsed slot to whoever is next.
  for slot in
    select distinct o.starts_at, o.ends_at, o.released_booking_id
    from waitlist_offers o
    join waitlist_entries e on e.id = o.entry_id
    where e.salon_id = p_salon_id
      and o.claimed_at is null
      and o.expires_at <= now()
      and o.starts_at > now()
  loop
    perform offer_next_for_slot(p_salon_id, slot.starts_at, slot.ends_at,
                                slot.released_booking_id);
  end loop;
end;
$$;

revoke all on function public.sweep_waitlist(uuid) from public;

-- ---------------------------------------------------------------------------
-- The trigger: a cancellation is what frees a seat
-- ---------------------------------------------------------------------------

-- Both sides already cancel — the customer from "My bookings", the salon from
-- the appointment sheet — and neither needs to know the waitlist exists.
create function public.offer_cancelled_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.starts_at > now() then
    perform offer_next_for_slot(new.salon_id, new.starts_at, new.ends_at, new.id);
  end if;
  return null;
end;
$$;

create trigger bookings_offer_cancelled_slot
  after update on bookings
  for each row
  execute function public.offer_cancelled_slot();

-- ---------------------------------------------------------------------------
-- Reading the waitlist
-- ---------------------------------------------------------------------------

-- The caller's own entries, with whatever is being held for them. `claimable`
-- is the whole rule in one boolean, computed rather than stored:
--
--   * they hold an unexpired offer, or
--   * everybody matching has had a turn and nobody claimed it, so the slot is
--     open to all of them and the fastest wins.
--
-- Deriving the second case beats recording it — there is no second copy of the
-- truth to fall out of step with the offers themselves.
create function public.my_waitlist()
returns table (
  entry_id      uuid,
  salon_id      uuid,
  salon_name_en text,
  salon_name_ar text,
  requested_date date,
  earliest_time time,
  latest_time   time,
  status        waitlist_status,
  offer_id      uuid,
  offer_starts_at timestamptz,
  offer_expires_at timestamptz,
  claimable     boolean,
  service_names_en text[],
  service_names_ar text[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer uuid := auth.uid();
  s uuid;
begin
  if v_customer is null then
    raise exception 'sign in to see your waitlist' using errcode = '42501';
  end if;

  for s in select distinct e.salon_id from waitlist_entries e
           where e.customer_id = v_customer and e.status in ('waiting', 'offered')
  loop
    perform sweep_waitlist(s);
  end loop;

  return query
  select
    e.id, e.salon_id, sa.name_en, sa.name_ar,
    e.requested_date, e.earliest_time, e.latest_time, e.status,
    o.id, o.starts_at, o.expires_at,
    (
      o.id is not null
      and o.claimed_at is null
      and o.starts_at > now()
      and (
        o.expires_at > now()
        -- Everybody has had their turn: the slot is open to all of them.
        or not exists (
          select 1 from waitlist_matches(e.salon_id, o.starts_at) m
          where not exists (
            select 1 from waitlist_offers x
            where x.entry_id = m.entry_id and x.starts_at = o.starts_at
          )
        )
      )
    ),
    coalesce(names.en, '{}'), coalesce(names.ar, '{}')
  from waitlist_entries e
  join salons sa on sa.id = e.salon_id
  left join lateral (
    select * from waitlist_offers w
    where w.entry_id = e.id and w.claimed_at is null
    order by w.offered_at desc limit 1
  ) o on true
  cross join lateral (
    select array_agg(sv.name_en order by sv.sort_order) as en,
           array_agg(sv.name_ar order by sv.sort_order) as ar
    from services sv where sv.id = any (e.service_ids)
  ) names
  where e.customer_id = v_customer
    and e.status in ('waiting', 'offered')
  order by e.requested_date, e.created_at;
end;
$$;

revoke all on function public.my_waitlist() from public;
grant execute on function public.my_waitlist() to authenticated;

-- The salon's own queue. Same narrowness as salon_day(): the customer's display
-- name and nothing else about them.
create function public.salon_waitlist(p_salon_id uuid)
returns table (
  entry_id      uuid,
  customer_name text,
  requested_date date,
  earliest_time time,
  latest_time   time,
  status        waitlist_status,
  waiting_since timestamptz,
  offer_id      uuid,
  offer_starts_at timestamptz,
  offer_expires_at timestamptz,
  can_extend    boolean,
  service_names_en text[],
  service_names_ar text[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  perform sweep_waitlist(p_salon_id);

  return query
  select
    e.id, nullif(p.full_name, ''),
    e.requested_date, e.earliest_time, e.latest_time, e.status, e.created_at,
    o.id, o.starts_at, o.expires_at,
    (
      o.id is not null
      and o.claimed_at is null
      and o.expires_at > now()
      -- Extending is offered only when nobody is queued behind them. With a
      -- queue, holding the seat longer just makes everyone else wait for
      -- nothing, so it passes on instead.
      and not exists (
        select 1 from waitlist_matches(p_salon_id, o.starts_at) m
        where m.entry_id <> e.id
          and not exists (
            select 1 from waitlist_offers x
            where x.entry_id = m.entry_id and x.starts_at = o.starts_at
          )
      )
    ),
    coalesce(names.en, '{}'), coalesce(names.ar, '{}')
  from waitlist_entries e
  join profiles p on p.id = e.customer_id
  left join lateral (
    select * from waitlist_offers w
    where w.entry_id = e.id and w.claimed_at is null
    order by w.offered_at desc limit 1
  ) o on true
  cross join lateral (
    select array_agg(sv.name_en order by sv.sort_order) as en,
           array_agg(sv.name_ar order by sv.sort_order) as ar
    from services sv where sv.id = any (e.service_ids)
  ) names
  where e.salon_id = p_salon_id
    and e.status in ('waiting', 'offered')
  order by e.requested_date, e.created_at;
end;
$$;

revoke all on function public.salon_waitlist(uuid) from public;
grant execute on function public.salon_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Acting on an offer
-- ---------------------------------------------------------------------------

--   SL012  that offer is no longer yours to take
create function public.claim_waitlist_offer(p_offer_id uuid)
returns table (booking_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
  made record;
  open_to_all boolean;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is not null then
    select * into e from waitlist_entries where id = o.entry_id;
  end if;

  -- An offer that is not yours and one that does not exist are refused
  -- identically, so this cannot be used to discover other people's offers.
  if o.id is null or e.customer_id is distinct from auth.uid() then
    raise exception 'that offer is not yours' using errcode = '42501';
  end if;
  if o.claimed_at is not null or o.starts_at <= now() then
    raise exception 'that offer is no longer open' using errcode = 'SL012';
  end if;

  select not exists (
    select 1 from waitlist_matches(e.salon_id, o.starts_at) m
    where not exists (
      select 1 from waitlist_offers x
      where x.entry_id = m.entry_id and x.starts_at = o.starts_at
    )
  ) into open_to_all;

  -- Either the hold is still theirs, or everybody has had a turn and the slot
  -- is open to all of them.
  if o.expires_at <= now() and not open_to_all then
    raise exception 'someone else is holding that slot' using errcode = 'SL012';
  end if;

  -- The booking is made the ordinary way: priced from the salon's own services,
  -- given a chair, written with its items in one transaction. A slot claimed
  -- off the waitlist is not a lesser kind of appointment.
  select * into made from create_booking(
    e.salon_id, null, e.service_ids, o.starts_at, null);

  update waitlist_offers
     set claimed_at = now(), claimed_booking_id = made.booking_id
   where id = o.id;
  update waitlist_entries set status = 'claimed' where id = e.id;

  return query select made.booking_id, made.reference;
end;
$$;

revoke all on function public.claim_waitlist_offer(uuid) from public;
grant execute on function public.claim_waitlist_offer(uuid) to authenticated;

--   SL013  somebody is queued behind them, so it passes on instead
create function public.extend_waitlist_offer(
  p_offer_id uuid,
  p_minutes  integer default 15
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
  v_until timestamptz;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is not null then
    select * into e from waitlist_entries where id = o.entry_id;
  end if;
  if o.id is null or not is_salon_owner(e.salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;
  if o.claimed_at is not null then
    raise exception 'that offer has already been taken' using errcode = 'SL012';
  end if;

  -- Only when nobody is queued behind. Holding a seat longer for one person
  -- while others wait costs them their turn for nothing.
  if exists (
    select 1 from waitlist_matches(e.salon_id, o.starts_at) m
    where m.entry_id <> e.id
      and not exists (
        select 1 from waitlist_offers x
        where x.entry_id = m.entry_id and x.starts_at = o.starts_at
      )
  ) then
    raise exception 'somebody else is waiting for that slot' using errcode = 'SL013';
  end if;

  v_until := greatest(now(), o.expires_at)
             + make_interval(mins => greatest(coalesce(p_minutes, 15), 1));

  update waitlist_offers set expires_at = v_until where id = o.id;
  -- The hold is live again, so the entry goes back to holding it.
  update waitlist_entries set status = 'offered' where id = e.id;

  return v_until;
end;
$$;

revoke all on function public.extend_waitlist_offer(uuid, integer) from public;
grant execute on function public.extend_waitlist_offer(uuid, integer) to authenticated;

-- The salon's "Notify" button: offer the freed slot again, to whoever is next.
-- Useful when a hold lapsed and nobody has looked since, which without push
-- notifications is most of the time.
create function public.reoffer_waitlist_slot(p_entry_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e waitlist_entries%rowtype;
  o waitlist_offers%rowtype;
begin
  select * into e from waitlist_entries where id = p_entry_id;
  if e.id is null or not is_salon_owner(e.salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  select * into o from waitlist_offers
   where entry_id = e.id order by offered_at desc limit 1;
  if o.id is null then
    raise exception 'nothing has been offered to this customer yet' using errcode = 'SL012';
  end if;

  perform sweep_waitlist(e.salon_id);
  return offer_next_for_slot(e.salon_id, o.starts_at, o.ends_at, o.released_booking_id);
end;
$$;

revoke all on function public.reoffer_waitlist_slot(uuid) from public;
grant execute on function public.reoffer_waitlist_slot(uuid) to authenticated;


-- ===========================================================================
-- 0010_notifications.sql
-- ===========================================================================

-- Saloni — somebody is finally told
--
-- 0009 made the waitlist real: a queue, 15-minute holds, a lapsed hold passing
-- to the next person, and claiming that books a real priced appointment. It
-- said plainly what was still missing, and this is that:
--
--   "There is no push, no SMS and no WhatsApp yet, so an offer reaches a
--    customer only when they next open the app. The queue, the holds and the
--    claim are all genuine; the tap on the shoulder is what is missing."
--
-- The notifications table has existed since 0001 — profile, channel, template,
-- payload, sent_at / delivered_at / failed_at — with a policy letting an account
-- read its own. Nothing has ever written a row to it. It is an outbox that has
-- never had anything put in it.
--
-- What changes here: every waitlist offer now queues a message. What does NOT
-- change: nothing sends one. Draining the outbox needs a worker holding a
-- WhatsApp provider's credentials, and an approved Meta template, neither of
-- which exists yet — docs/whatsapp-waitlist-template.md is the submission that
-- starts that clock. So after this migration the queue fills and stays full,
-- which is the honest half-step: when the sender arrives there is a backlog of
-- real messages for it to send, and the app's behaviour is unchanged until then.
--
-- Two decisions worth reading before changing anything here.
--
-- Only channels that could actually arrive are queued. WhatsApp needs
-- profiles.phone and profiles.allow_whatsapp; push needs a registered device,
-- and there is no device-token table because there is no native app yet. So
-- push is not queued at all rather than queued undeliverably. An outbox full of
-- rows nothing can ever send is worse than an empty one — it looks like
-- progress and hides the real gap.
--
-- And quiet hours ship switched off. The mechanism is built and tested both
-- ways, but a quiet window with no sender behind it would only stretch holds
-- overnight while nobody's phone buzzed, which costs the queue its turn-taking
-- and buys nothing. §6 below is the one line to change when sending starts.

-- ---------------------------------------------------------------------------
-- 1. What a queued message needs to carry
-- ---------------------------------------------------------------------------

alter table notifications
  -- Which offer this is about, so a re-offer cannot queue a second message for
  -- the same seat, and so the sender can check the hold has not already lapsed.
  add column offer_id uuid references waitlist_offers (id) on delete cascade,
  -- Which language to send in. profiles.locale at the moment of the offer, not
  -- at the moment of sending: the message is about a decision the customer made
  -- in a particular language, and a later change should not retranslate a
  -- message already queued.
  add column locale text not null default 'en' check (locale in ('en', 'ar')),
  -- The earliest this may go out. now() unless quiet hours push it later.
  add column send_after timestamptz not null default now(),
  -- Send attempts, so a permanently bad number stops being retried forever.
  add column attempts integer not null default 0;

comment on column notifications.offer_id is
  'The waitlist offer this message is about. Null for any future notification '
  'that is not about an offer.';

-- One message per offer per channel. This is the guard that makes the whole
-- thing safe to call from more than one place: offer_next_for_slot() is reached
-- from a cancellation trigger, from a lazy sweep and from the salon''s "Notify"
-- button, and none of them should be able to double-message anybody.
create unique index notifications_offer_channel_idx
  on notifications (offer_id, channel)
  where offer_id is not null;

-- What the sender scans: unsent, unfailed, due.
create index notifications_pending_idx
  on notifications (send_after)
  where sent_at is null and failed_at is null;

-- ---------------------------------------------------------------------------
-- 2. The outbox is not something a browser gets to write
-- ---------------------------------------------------------------------------

-- The same column-blind grant 0006, 0008 and 0009 each had to close. Here an
-- account that can write this table could queue a message to somebody else, or
-- mark its own as sent, or — worse — rewrite the payload of a queued message so
-- the salon's name is right and the link points somewhere else. Nothing about
-- this table should ever be reachable from the browser except reading your own.
revoke insert, update, delete on notifications from authenticated;
revoke insert, update, delete on notifications from anon;

-- notifications_select_own (0002) stays: an account reads its own messages,
-- which is what would let the app show a notification centre later.

-- ---------------------------------------------------------------------------
-- 3. Settings, in one row, so none of this is hardcoded in a function body
-- ---------------------------------------------------------------------------

create table notification_settings (
  -- One row, forever: the primary key can only hold true.
  id             boolean primary key default true check (id),
  -- Null disables quiet hours. Stored as local Asia/Riyadh clock time, the
  -- same timezone waitlist_matches() already reasons in.
  quiet_from     time,
  quiet_to       time,
  -- How many separate offers one person may be pinged about in a rolling hour.
  -- Counted per offer, not per message, so adding push later does not halve it.
  rate_per_hour  integer not null default 4 check (rate_per_hour > 0),
  -- Where the claim link points. Here rather than in a function body so moving
  -- the app to its own domain is one update, not a migration.
  app_base_url   text not null default 'https://de7mi0.github.io/Norisu/',
  updated_at     timestamptz not null default now()
);

-- Quiet hours off by default — see the header. To turn them on once messages
-- are really being sent:
--
--   update notification_settings set quiet_from = '22:00', quiet_to = '08:00';
--
insert into notification_settings (id) values (true);

alter table notification_settings enable row level security;

-- No policy, deliberately. Every reader below is security definer, and
-- service_role bypasses RLS, so nobody else reaches it at all.
revoke all on notification_settings from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Quiet hours
-- ---------------------------------------------------------------------------

-- Null when p_at is not inside the quiet window; otherwise the instant the
-- window ends. Handles a window that wraps midnight, which the useful ones do.
create function public.notification_quiet_until(p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s        notification_settings%rowtype;
  local_ts timestamp;
  local_t  time;
  local_d  date;
  is_quiet boolean;
  ends     timestamp;
begin
  select * into s from notification_settings where id;

  if s.quiet_from is null or s.quiet_to is null or s.quiet_from = s.quiet_to then
    return null;
  end if;

  local_ts := p_at at time zone 'Asia/Riyadh';
  local_t  := local_ts::time;
  local_d  := local_ts::date;

  if s.quiet_from < s.quiet_to then
    -- An ordinary window inside one day, e.g. 01:00 -> 06:00.
    is_quiet := local_t >= s.quiet_from and local_t < s.quiet_to;
    ends     := local_d + s.quiet_to;
  else
    -- Wraps midnight, e.g. 22:00 -> 08:00.
    is_quiet := local_t >= s.quiet_from or local_t < s.quiet_to;
    if local_t >= s.quiet_from then
      ends := (local_d + 1) + s.quiet_to;
    else
      ends := local_d + s.quiet_to;
    end if;
  end if;

  if not is_quiet then
    return null;
  end if;

  return ends at time zone 'Asia/Riyadh';
end;
$$;

revoke all on function public.notification_quiet_until(timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 5. Queueing the message for one offer
-- ---------------------------------------------------------------------------

-- Called by offer_next_for_slot() and by nothing else. Silent rather than
-- raising when there is nothing to send: an offer that cannot be messaged is
-- still a perfectly good offer, and the customer will see it in the app.
create function public.enqueue_offer_notification(p_offer_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o          waitlist_offers%rowtype;
  e          waitlist_entries%rowtype;
  p          profiles%rowtype;
  s          notification_settings%rowtype;
  v_salon_en text;
  v_salon_ar text;
  v_svc_en   text;
  v_svc_ar   text;
  v_payload  jsonb;
  v_queued   integer := 0;
  v_n        integer;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is null then
    return 0;
  end if;

  -- Never message about a seat that has already come and gone. A notification
  -- about a slot in the past is worse than none: it is the thing that teaches
  -- people to stop opening them.
  if o.starts_at <= now() then
    return 0;
  end if;

  select * into e from waitlist_entries where id = o.entry_id;
  select * into p from profiles where id = e.customer_id;
  select * into s from notification_settings where id;

  select sa.name_en, sa.name_ar into v_salon_en, v_salon_ar
  from salons sa where sa.id = e.salon_id;

  -- The basket they were waiting with, in both languages, so the sender does
  -- not have to join anything to fill the template in.
  select string_agg(sv.name_en, ' + ' order by sv.name_en),
         string_agg(sv.name_ar, ' + ' order by sv.name_en)
    into v_svc_en, v_svc_ar
  from services sv
  where sv.id = any (e.service_ids);

  -- The payload carries no phone number and no e-mail. The sender is
  -- service_role and can read the profile itself; copying contact details into
  -- a row the account can read back would put them somewhere they need not be.
  v_payload := jsonb_build_object(
    'kind',         'waitlist_offer',
    'offer_id',     o.id,
    'salon',        jsonb_build_object('en', v_salon_en, 'ar', v_salon_ar),
    'services',     jsonb_build_object('en', coalesce(v_svc_en, ''),
                                       'ar', coalesce(v_svc_ar, '')),
    'starts_at',    o.starts_at,
    'expires_at',   o.expires_at,
    'hold_minutes', greatest(1, (extract(epoch from (o.expires_at - now())) / 60)::integer),
    'claim_url',    s.app_base_url || '?claim=' || o.claim_token::text
  );

  -- WhatsApp: needs somewhere to send it and permission to send it.
  if p.allow_whatsapp and coalesce(p.phone, '') <> '' then
    insert into notifications (profile_id, channel, template, payload, locale,
                               offer_id, send_after)
    values (p.id, 'whatsapp', 'waitlist_seat_offer', v_payload, p.locale,
            o.id, coalesce(notification_quiet_until(now()), now()))
    on conflict (offer_id, channel) where offer_id is not null do nothing;
    get diagnostics v_n = row_count;
    v_queued := v_queued + v_n;
  end if;

  -- Push is deliberately not queued. There is no device-token table because
  -- there is no native app yet; a push row today could never be delivered, and
  -- an outbox that fills with undeliverable rows hides exactly the gap it
  -- should be showing. It arrives with the Capacitor wrap.

  return v_queued;
end;
$$;

revoke all on function public.enqueue_offer_notification(uuid) from public;

-- ---------------------------------------------------------------------------
-- 6. The offer itself, now that making one also tells somebody
-- ---------------------------------------------------------------------------

-- Unchanged from 0009 except at the end, plus two considerations that only make
-- sense once a message is actually going out:
--
--   * Somebody already pinged about several other seats this hour is skipped
--     and keeps their place in the queue. No offer row is written for them, so
--     they have not "had their turn" — they are simply not pestered. This is
--     the cap the backlog asks for, and it is counted per offer rather than per
--     message so that adding push later does not silently halve it.
--
--   * If quiet hours are on and it is the middle of the night, the hold is
--     stretched to cover the silence instead of the offer being suppressed.
--     Suppressing it would be unfair in a way that is easy to miss: the offer
--     row would still exist, the hold would lapse unseen, and "never the same
--     slot twice to the same person" would mean they could never be offered
--     that seat again. Stretching the hold costs nothing — an offer does not
--     lock the slot against an ordinary booking — and the customer wakes up
--     with the seat still theirs and a full hold to decide in.
create or replace function public.offer_next_for_slot(
  p_salon_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_released_booking_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry   uuid;
  v_offer   uuid;
  v_quiet   timestamptz;
  v_expires timestamptz;
  v_cap     integer;
begin
  -- Somebody already holds it.
  if exists (
    select 1 from waitlist_offers o
    join waitlist_entries e on e.id = o.entry_id
    where e.salon_id = p_salon_id and o.starts_at = p_starts_at
      and o.claimed_at is null and o.expires_at > now()
  ) then
    return null;
  end if;

  -- Or somebody already took it, through the waitlist or the ordinary route.
  if not exists (
    select 1 from free_staff_for(p_salon_id, '{}'::uuid[], p_starts_at, p_ends_at)
  ) then
    return null;
  end if;

  select rate_per_hour into v_cap from notification_settings where id;

  select m.entry_id into v_entry
  from waitlist_matches(p_salon_id, p_starts_at) m
  join waitlist_entries e on e.id = m.entry_id
  where e.status = 'waiting'
    -- Never the same slot twice to the same person.
    and not exists (
      select 1 from waitlist_offers o
      where o.entry_id = m.entry_id and o.starts_at = p_starts_at
    )
    -- Not somebody who has already been pinged enough this hour.
    and (
      select count(distinct n.offer_id)
      from notifications n
      where n.profile_id = e.customer_id
        and n.offer_id is not null
        and n.created_at > now() - interval '1 hour'
    ) < v_cap
  limit 1;

  if v_entry is null then
    return null;
  end if;

  v_quiet   := notification_quiet_until(now());
  v_expires := now() + make_interval(mins => waitlist_hold_minutes());

  if v_quiet is not null then
    -- Hold it until the quiet window ends, then the ordinary hold on top.
    v_expires := greatest(v_expires,
                          v_quiet + make_interval(mins => waitlist_hold_minutes()));
    -- But never past the appointment it is an offer for.
    if p_starts_at > now() then
      v_expires := least(v_expires, p_starts_at);
    end if;
  end if;

  insert into waitlist_offers (entry_id, released_booking_id, starts_at, ends_at, expires_at)
  values (v_entry, p_released_booking_id, p_starts_at, p_ends_at, v_expires)
  returning id into v_offer;

  update waitlist_entries set status = 'offered' where id = v_entry;

  perform enqueue_offer_notification(v_offer);

  return v_entry;
end;
$$;

revoke all on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. Draining the outbox — for the sender, and nobody else
-- ---------------------------------------------------------------------------

-- The three functions a worker needs. All granted to service_role only: this is
-- the one part of Saloni that legitimately runs with the secret key, because it
-- reads other people's phone numbers to message them. Granting any of it to
-- authenticated would hand every account a list of who is waiting for what and
-- how to reach them.

-- Claims up to p_limit due messages, counting an attempt against each so a
-- crashed worker cannot spin on the same row forever.
create function public.claim_pending_notifications(p_limit integer default 20)
returns table (
  id         uuid,
  channel    notify_channel,
  template   text,
  locale     text,
  payload    jsonb,
  attempts   integer,
  to_phone   text,
  to_name    text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select n.id
    from notifications n
    left join waitlist_offers o on o.id = n.offer_id
    where n.sent_at is null
      and n.failed_at is null
      and n.send_after <= now()
      and n.attempts < 5
      -- Never send about a hold that has already lapsed or been taken. Between
      -- queueing and sending, the seat may well have gone.
      and (n.offer_id is null
           or (o.claimed_at is null and o.expires_at > now() and o.starts_at > now()))
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update of n skip locked
  )
  update notifications n
     set attempts = n.attempts + 1
    from due, profiles p
   where n.id = due.id and p.id = n.profile_id
  returning n.id, n.channel, n.template, n.locale, n.payload, n.attempts,
            p.phone, nullif(p.full_name, '');
end;
$$;

revoke all on function public.claim_pending_notifications(integer) from public;
grant execute on function public.claim_pending_notifications(integer) to service_role;

create function public.mark_notification_sent(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update notifications set sent_at = now() where id = p_id and sent_at is null;
$$;

revoke all on function public.mark_notification_sent(uuid) from public;
grant execute on function public.mark_notification_sent(uuid) to service_role;

-- A failure is recorded rather than thrown away, and after five attempts
-- claim_pending_notifications() stops picking the row up at all.
create function public.mark_notification_failed(p_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update notifications
     set failed_at = case when attempts >= 5 then now() else null end,
         error     = left(coalesce(p_error, ''), 500),
         send_after = now() + interval '5 minutes'
   where id = p_id and sent_at is null;
$$;

revoke all on function public.mark_notification_failed(uuid, text) from public;
grant execute on function public.mark_notification_failed(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. "revoke from public" has never actually revoked anything
-- ---------------------------------------------------------------------------

-- Found while locking down the three functions above, and it is not confined to
-- them. Supabase ships this, and tests/00_local_shim.sql mirrors it:
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- So every function is granted to the API roles the moment it is created, by
-- name. "revoke all on function f from public" removes PUBLIC's grant and
-- leaves the named ones untouched — which means every `revoke ... from public`
-- written since 0003 has been decorative. Verified rather than assumed: before
-- this section, has_function_privilege('anon', ..., 'EXECUTE') was true for all
-- thirty security definer functions, including ones no browser should reach.
--
-- Most were harmless because the guard is inside the body — salon_day() checks
-- is_salon_owner() and does not care who may call it. Two were not:
--
--   waitlist_matches()   — no guard at all. Any visitor, signed in or not,
--                          could list the customer ids waiting at any salon.
--   offer_next_for_slot() — no guard at all. Any account could force offers,
--                          spending other people's one turn at a slot.
--
-- And claim_pending_notifications(), added above, would have been the worst of
-- them: it returns the phone number and name of everybody with a message
-- queued. That is what turned this from a tidy-up into part of the migration.
--
-- The rule this establishes, for anything added later: a function is reachable
-- from the browser unless you say otherwise, and saying otherwise means naming
-- anon and authenticated. Assertion 84 fails if a new one forgets.

revoke execute on function public.free_staff_for(uuid, uuid[], timestamptz, timestamptz, uuid)
  from anon, authenticated;
revoke execute on function public.salon_is_open_for(uuid, uuid, timestamptz, timestamptz)
  from anon, authenticated;
revoke execute on function public.offer_next_for_slot(uuid, timestamptz, timestamptz, uuid)
  from anon, authenticated;
revoke execute on function public.sweep_waitlist(uuid)
  from anon, authenticated;
revoke execute on function public.waitlist_matches(uuid, timestamptz)
  from anon, authenticated;

revoke execute on function public.notification_quiet_until(timestamptz)
  from anon, authenticated;
revoke execute on function public.enqueue_offer_notification(uuid)
  from anon, authenticated;
revoke execute on function public.claim_pending_notifications(integer)
  from anon, authenticated;
revoke execute on function public.mark_notification_sent(uuid)
  from anon, authenticated;
revoke execute on function public.mark_notification_failed(uuid, text)
  from anon, authenticated;

-- Every one of these is still called from inside a security definer function,
-- which executes as its owner rather than as the caller — so the app's own
-- paths are untouched. available_slots(), create_booking(), my_waitlist() and
-- the rest reach them exactly as before.
--
-- Deliberately NOT revoked:
--   is_admin(), is_salon_owner(), salon_is_public() — row policies call these,
--     and a policy is evaluated as the querying role. Revoking them would make
--     every ordinary select fail.
--   the trigger functions — a trigger fires without an execute check, and
--     calling one directly does nothing useful anyway.


-- ===========================================================================
-- 0011_push_devices.sql
-- ===========================================================================

-- Saloni — the message goes to the phone, not to WhatsApp
--
-- 0010 filled the outbox and queued WhatsApp, because WhatsApp was the only
-- channel reachable without a native app. That is no longer the plan: the
-- waitlist should tap the customer on the shoulder through Saloni itself.
--
-- Push is the better channel for this and always was. It is free, it is
-- instant, it needs no Meta approval and no template whose wording cannot
-- change without resubmitting, and the notification opens the app it came
-- from. 0010 did not queue it for one reason, stated there plainly: there was
-- nowhere to send it, because a push message goes to a *device* and nothing
-- recorded any. That is what this migration adds.
--
-- The device is a browser to begin with — Saloni becomes installable, and an
-- installed page can be pushed to even while it is closed. When the Capacitor
-- wrap lands, an iOS or Android device registers in the same table and only
-- the sender's last hop changes. Hence `platform` rather than an assumption,
-- and `endpoint` holding either a Web Push URL or, later, a native token.
--
-- WhatsApp is not deleted. It is switched off — notification_settings.channels
-- decides, and it now defaults to push alone. The code and its assertions stay
-- because a customer who never installs the app is still reachable that way,
-- and turning it back on should be one update rather than a rewrite.

-- ---------------------------------------------------------------------------
-- 1. A device to send to
-- ---------------------------------------------------------------------------

create type push_platform as enum ('web', 'ios', 'android');

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  platform    push_platform not null default 'web',

  -- Web Push: the URL the browser's push service gave us, and the two keys it
  -- issued with it. Native later: endpoint holds the FCM or APNs token and the
  -- key columns stay empty. One table, because the queueing and the retiring of
  -- dead devices are identical either way.
  endpoint    text not null unique,
  p256dh      text not null default '',
  auth        text not null default '',

  -- Only to tell one of your own devices from another when revoking.
  label       text not null default '',

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint web_push_needs_its_keys
    check (platform <> 'web' or (p256dh <> '' and auth <> ''))
);

create index push_subscriptions_profile_idx
  on push_subscriptions (profile_id);

comment on table push_subscriptions is
  'One row per browser or device that has agreed to be notified. Registered '
  'through register_push_device(); never written directly.';

alter table push_subscriptions enable row level security;

-- You can see and revoke your own devices, and nobody else's.
create policy push_subscriptions_select_own on push_subscriptions
  for select to authenticated
  using (profile_id = auth.uid());

create policy push_subscriptions_delete_own on push_subscriptions
  for delete to authenticated
  using (profile_id = auth.uid());

-- Writing goes through the function below, for the same reason joining the
-- waitlist does: an account that can insert its own row can insert somebody
-- else's endpoint against its own profile, or claim another person's device by
-- re-pointing an existing row. The unique constraint on endpoint is what makes
-- that a real risk rather than a theoretical one.
revoke insert, update on push_subscriptions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Registering and revoking
-- ---------------------------------------------------------------------------

-- Idempotent: a browser re-subscribes on its own schedule, and the push service
-- may hand back the same endpoint or a new one. Re-registering an endpoint that
-- already belongs to somebody else moves it, because it is the same physical
-- browser — two accounts on one phone is ordinary, and the person signed in now
-- is the one who should receive that phone's notifications.
create function public.register_push_device(
  p_endpoint text,
  p_p256dh   text default '',
  p_auth     text default '',
  p_platform push_platform default 'web',
  p_label    text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'sign in before registering a device' using errcode = '42501';
  end if;

  if coalesce(p_endpoint, '') = '' then
    raise exception 'a device needs an endpoint' using errcode = 'SL020';
  end if;

  if p_platform = 'web' and (coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '') then
    raise exception 'a web device needs both of its keys' using errcode = 'SL021';
  end if;

  insert into push_subscriptions (profile_id, platform, endpoint, p256dh, auth, label)
  values (v_me, p_platform, p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''),
          left(coalesce(p_label, ''), 80))
  on conflict (endpoint) do update
    set profile_id   = v_me,
        platform     = excluded.platform,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        label        = excluded.label,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;

-- Turning notifications off in the browser does not tell us, so the app calls
-- this when it notices. Deleting somebody else's device is a no-op rather than
-- an error, so it cannot be used to find out whether an endpoint exists.
create function public.forget_push_device(p_endpoint text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from push_subscriptions
   where endpoint = p_endpoint and profile_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.forget_push_device(text) from public;
revoke execute on function public.forget_push_device(text) from anon;
grant execute on function public.forget_push_device(text) to authenticated;

-- The sender's version, for when a push service answers "this endpoint is
-- gone". It deletes by endpoint alone, because at that point nobody is signed
-- in — auth.uid() is null inside the worker, so the function above would match
-- nothing. Kept separate rather than folded in with a null check: an ordinary
-- account must never reach a delete that ignores who owns the row.
create function public.retire_push_device(p_endpoint text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.retire_push_device(text) from public;
revoke execute on function public.retire_push_device(text) from anon, authenticated;
grant execute on function public.retire_push_device(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Which channels are switched on
-- ---------------------------------------------------------------------------

-- Push only. WhatsApp stays built and tested; it is simply not sent.
-- To send both:  update notification_settings set channels = '{push,whatsapp}';
alter table notification_settings
  add column channels notify_channel[] not null default '{push}';

comment on column notification_settings.channels is
  'Which channels an offer is queued on. Push alone by default; adding '
  '''whatsapp'' turns the 0010 path back on without any code change.';

-- ---------------------------------------------------------------------------
-- 4. Queueing, now that there is more than one way to reach somebody
-- ---------------------------------------------------------------------------

-- Same body as 0010 except for the channel loop at the end. Each channel is
-- queued only if it is switched on, the customer allows it, and there is
-- somewhere for it to go — no registered device means no push row, exactly as
-- no phone number means no WhatsApp row. A queued message that could never
-- arrive is worse than none: it makes the outbox lie about what is happening.
create or replace function public.enqueue_offer_notification(p_offer_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o          waitlist_offers%rowtype;
  e          waitlist_entries%rowtype;
  p          profiles%rowtype;
  s          notification_settings%rowtype;
  v_salon_en text;
  v_salon_ar text;
  v_svc_en   text;
  v_svc_ar   text;
  v_payload  jsonb;
  v_queued   integer := 0;
  v_n        integer;
  v_devices  integer;
begin
  select * into o from waitlist_offers where id = p_offer_id;
  if o.id is null then
    return 0;
  end if;

  -- Never message about a seat that has already come and gone.
  if o.starts_at <= now() then
    return 0;
  end if;

  select * into e from waitlist_entries where id = o.entry_id;
  select * into p from profiles where id = e.customer_id;
  select * into s from notification_settings where id;

  select sa.name_en, sa.name_ar into v_salon_en, v_salon_ar
  from salons sa where sa.id = e.salon_id;

  select string_agg(sv.name_en, ' + ' order by sv.name_en),
         string_agg(sv.name_ar, ' + ' order by sv.name_en)
    into v_svc_en, v_svc_ar
  from services sv
  where sv.id = any (e.service_ids);

  -- No phone number and no e-mail: the sender reads the profile and the
  -- devices itself, and copying contact details into a row the account can
  -- read back would put them somewhere they need not be.
  v_payload := jsonb_build_object(
    'kind',         'waitlist_offer',
    'offer_id',     o.id,
    'salon',        jsonb_build_object('en', v_salon_en, 'ar', v_salon_ar),
    'services',     jsonb_build_object('en', coalesce(v_svc_en, ''),
                                       'ar', coalesce(v_svc_ar, '')),
    'starts_at',    o.starts_at,
    'expires_at',   o.expires_at,
    'hold_minutes', greatest(1, (extract(epoch from (o.expires_at - now())) / 60)::integer),
    'claim_url',    s.app_base_url || '?claim=' || o.claim_token::text
  );

  -- Push: needs a device that agreed to be notified.
  if 'push' = any (s.channels) and p.allow_push then
    select count(*) into v_devices from push_subscriptions where profile_id = p.id;
    if v_devices > 0 then
      insert into notifications (profile_id, channel, template, payload, locale,
                                 offer_id, send_after)
      values (p.id, 'push', 'waitlist_seat_offer', v_payload, p.locale,
              o.id, coalesce(notification_quiet_until(now()), now()))
      on conflict (offer_id, channel) where offer_id is not null do nothing;
      get diagnostics v_n = row_count;
      v_queued := v_queued + v_n;
    end if;
  end if;

  -- WhatsApp: built, tested, and off by default. Needs somewhere to send it
  -- and permission to send it.
  if 'whatsapp' = any (s.channels)
     and p.allow_whatsapp and coalesce(p.phone, '') <> '' then
    insert into notifications (profile_id, channel, template, payload, locale,
                               offer_id, send_after)
    values (p.id, 'whatsapp', 'waitlist_seat_offer', v_payload, p.locale,
            o.id, coalesce(notification_quiet_until(now()), now()))
    on conflict (offer_id, channel) where offer_id is not null do nothing;
    get diagnostics v_n = row_count;
    v_queued := v_queued + v_n;
  end if;

  return v_queued;
end;
$$;

revoke all on function public.enqueue_offer_notification(uuid) from public;
revoke execute on function public.enqueue_offer_notification(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the sender gets handed
-- ---------------------------------------------------------------------------

-- Replaces 0010's version, which returned a phone number and nothing else. A
-- push row needs the devices instead, and there may be several — a phone and a
-- laptop — so they come back as an array to send to in turn.
drop function if exists public.claim_pending_notifications(integer);

create function public.claim_pending_notifications(p_limit integer default 20)
returns table (
  id         uuid,
  channel    notify_channel,
  template   text,
  locale     text,
  payload    jsonb,
  attempts   integer,
  to_phone   text,
  to_name    text,
  devices    jsonb
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select n.id
    from notifications n
    left join waitlist_offers o on o.id = n.offer_id
    where n.sent_at is null
      and n.failed_at is null
      and n.send_after <= now()
      and n.attempts < 5
      -- Never send about a hold that has already lapsed or been taken.
      and (n.offer_id is null
           or (o.claimed_at is null and o.expires_at > now() and o.starts_at > now()))
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update of n skip locked
  ),
  claimed as (
    update notifications n
       set attempts = n.attempts + 1
      from due
     where n.id = due.id
    returning n.id, n.channel, n.template, n.locale, n.payload, n.attempts,
              n.profile_id
  )
  select c.id, c.channel, c.template, c.locale, c.payload, c.attempts,
         p.phone, nullif(p.full_name, ''),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'endpoint', d.endpoint,
                     'p256dh',   d.p256dh,
                     'auth',     d.auth,
                     'platform', d.platform))
              from push_subscriptions d
             where d.profile_id = c.profile_id),
           '[]'::jsonb)
  from claimed c
  join profiles p on p.id = c.profile_id;
end;
$$;

revoke all on function public.claim_pending_notifications(integer) from public;
revoke execute on function public.claim_pending_notifications(integer) from anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;


-- ===========================================================================
-- 0012_claim_by_token.sql
-- ===========================================================================

-- Saloni — the notification's link lands on the seat, not on the front door
--
-- waitlist_offers.claim_token has existed since 0009, described there as the
-- "single-use secret in the notification's deep link", and 0010 has been
-- putting it into every queued message as `?claim=<token>`. Nothing has ever
-- read it back. Tapping a notification opened Saloni, and the held seat was one
-- more tap away on the Bookings screen.
--
-- Two taps is not a rounding error here: the hold is fifteen minutes, the
-- notification arrives while somebody is doing something else, and every extra
-- step is a chance for the seat to pass to the next person while they are still
-- looking for it.
--
-- The security shape is deliberately unchanged. The token identifies the offer;
-- it does not authorise anything by itself. claim_waitlist_offer() still checks
-- the offer belongs to whoever is signed in, so a link forwarded to a friend is
-- useless to them — which is exactly what makes it safe to put in a message
-- that could be screenshotted or shared.

create function public.claim_offer_by_token(p_token uuid)
returns table (booking_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer uuid;
begin
  select id into v_offer from waitlist_offers where claim_token = p_token;

  -- A token that does not exist and a token belonging to somebody else are
  -- refused identically, and with the same message claim_waitlist_offer() uses
  -- for the same case. Otherwise this becomes an oracle for guessing which
  -- tokens are real.
  if v_offer is null then
    raise exception 'that offer is not yours' using errcode = '42501';
  end if;

  -- Everything else — is it yours, is it still open, is the hold still yours or
  -- has the slot opened to everyone, and the pricing and chair assignment of
  -- the booking itself — is 0009's, unchanged. This function resolves a token
  -- and nothing more.
  return query select * from claim_waitlist_offer(v_offer);
end;
$$;

revoke all on function public.claim_offer_by_token(uuid) from public;
revoke execute on function public.claim_offer_by_token(uuid) from anon;
grant execute on function public.claim_offer_by_token(uuid) to authenticated;

comment on function public.claim_offer_by_token(uuid) is
  'Claims the seat a notification was about, from the claim_token in its link. '
  'Ownership is still checked, so a forwarded link claims nothing.';


-- ===========================================================================
-- 0013_salon_photos.sql
-- ===========================================================================

-- Saloni — somewhere to put a photograph
--
-- Every salon, service and stylist in the app is a coloured placeholder tile.
-- It is the most visible thing missing and the last TODO(roadmap) marker in the
-- code: the Gallery screen's upload button has never had a handler.
--
-- This migration is only the place the files go and the rules about who may put
-- them there. Resizing, size limits and stripping the GPS coordinates out of a
-- phone photo happen in the browser before the upload, because they have to
-- happen before the bytes leave the device to be worth anything.
--
-- THE PATH IS THE PERMISSION. Every object is stored as
--
--     <salon id>/<kind>/<file>          e.g. 3f9a…/cover/8c21….jpg
--
-- so `(storage.foldername(name))[1]` is the salon, and a policy can ask
-- is_salon_owner() about it. Get that layout wrong and the rules below stop
-- meaning anything, which is why the app builds the path in one place.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------

-- Public to read: these are photographs a salon wants customers to see, and
-- gating them behind a signed URL would mean the catalogue could not render for
-- somebody who is not signed in — which is most visitors.
--
-- The limits are enforced by the storage service itself, so they hold even if a
-- caller skips the app entirely. The browser also resizes well below them; this
-- is the backstop, not the mechanism.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'salon-photos',
  'salon-photos',
  true,
  3 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Who may write into it
-- ---------------------------------------------------------------------------

-- Anyone may look. The bucket is public, and this makes that explicit rather
-- than relying on the flag alone.
drop policy if exists salon_photos_read on storage.objects;
create policy salon_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'salon-photos');

-- An owner may add files, and only inside their own salon's folder. The path's
-- first segment has to be a salon they own, which is the whole rule.
drop policy if exists salon_photos_insert on storage.objects;
create policy salon_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

-- Replacing one is the same permission as adding one. Both sides are checked:
-- `using` for the file being overwritten, `with check` for what it becomes, so
-- a file cannot be moved out of its own salon's folder into somebody else's.
drop policy if exists salon_photos_update on storage.objects;
create policy salon_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists salon_photos_delete on storage.objects;
create policy salon_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. What is deliberately not here
-- ---------------------------------------------------------------------------
--
-- salon_media already carries everything needed to say which photograph is
-- which — storage_path, is_cover, sort_order, alt_text — with a unique index
-- enforcing one cover per salon and policies (0002) that let an owner write
-- only their own. It has simply never had a row. No change was needed, and
-- adding columns that duplicate what is there would have been the easiest way
-- to make this worse.
--
-- One real gap left standing: alt_text is a single string in an app that is
-- otherwise bilingual throughout. Worth an alt_ar beside it, but that is a
-- decision about editing rather than about storage, and this migration is
-- about where the bytes live.


-- ===========================================================================
-- 0014_walkin_bookings.sql
-- ===========================================================================

-- Saloni — the bookings a salon takes at the counter and on the phone
--
-- Every booking so far has belonged to auth.uid(). That is deliberate and stays
-- true for customers: create_booking() takes no customer parameter, so "a
-- customer cannot book in someone else's name" is impossible to express rather
-- than policed. Nothing below weakens that. A visitor still cannot create a
-- booking, signed in or not.
--
-- What it could not express is the other half of a real salon's day. Somebody
-- walks in, or rings up, and there is nowhere to put them: they have no
-- account, and there is no way for the owner to write one. Today the owner has
-- two options and both are bad.
--
--   Tell the app nothing.  available_slots() then offers that hour to a
--                          customer who arrives to find the chair occupied.
--   Block the time out.    The slot stops being sold — time_off has done that
--                          since 0003 — but nothing records who, what, or for
--                          how much, so "Booked today", the occupancy figure
--                          and the day list are all wrong.
--
-- Either way the salon keeps its paper book beside Saloni, and at that point
-- the app is extra work rather than the system. So: a booking may belong to a
-- customer account OR carry a name the salon typed, never neither, and never
-- both.
--
-- The person named here has no account, sees nothing, and can cancel nothing.
-- It is the salon's own diary entry, written by the owner, about an appointment
-- the salon has already agreed to.

-- ---------------------------------------------------------------------------
-- 1. A booking may name a guest instead of an account
-- ---------------------------------------------------------------------------

alter table bookings alter column customer_id drop not null;

alter table bookings
  add column guest_name  text,
  add column guest_phone text;

-- Either an account or a name, never neither — a booking with nobody attached
-- is not a record of anything. And never both: two names on one appointment is
-- a question about which is right, and the salon should not have to answer it.
--
-- The length caps match what the app allows for a customer's own name
-- (NAME_MAX_LENGTH, 60) so the two paths cannot disagree about what fits.
alter table bookings
  add constraint booking_belongs_to_somebody check (
    (customer_id is not null and guest_name is null and guest_phone is null)
    or (
      customer_id is null
      and guest_name is not null
      and length(btrim(guest_name)) between 1 and 60
      and (guest_phone is null or length(btrim(guest_phone)) between 1 and 20)
    )
  );

comment on column bookings.customer_id is
  'The account the booking belongs to. Null only for a booking the salon wrote itself for '
  'somebody with no account — see guest_name and create_walkin_booking().';

comment on column bookings.guest_name is
  'What the salon called this person when it took the booking at the counter or on the phone. '
  'Set only by create_walkin_booking(); not writable by authenticated, because the name on an '
  'appointment is part of the record rather than a field.';

comment on column bookings.guest_phone is
  'Optional, and typed by the salon itself — this is the salon''s own note of how to reach '
  'somebody it already spoke to, not a customer''s contact detail crossing a boundary. A '
  'profile''s phone number is still never handed to a salon; see salon_day() below.';

-- The guest columns are unwritable already — 0008 revoked INSERT on bookings
-- entirely, and 0006's UPDATE grant names its columns — so this adds nothing
-- and is here to be explicit about it. Adding either column to that grant would
-- let a salon rename somebody else's appointment after the fact.

-- ---------------------------------------------------------------------------
-- 2. Writing one
-- ---------------------------------------------------------------------------

-- The mirror of create_booking(), guarded the other way round: that one refuses
-- to book for anybody but the caller, this one refuses to write anywhere but
-- the caller's own salon.
--
-- Three deliberate differences from the customer's path, all of them because
-- this records something that has already happened rather than offering
-- something that has not:
--
--   * A time in the past is allowed. The walk-in most worth recording is the
--     one sitting in the chair right now, which started ten minutes ago.
--   * Opening hours are not checked. A salon that stayed late for somebody is
--     describing its own day; refusing the entry would not make the day
--     shorter, it would just keep it out of the app.
--   * Time off is not checked for a named staff member. If the owner says Layla
--     did it, Layla did it — blocking the hour out was the salon's own note,
--     and reality wins over it.
--
-- What is NOT relaxed is the one thing the database is actually for: the chair.
-- A staff member is assigned before the insert, so the exclusion constraint on
-- (staff_id, period) applies exactly as it does to a customer's booking, and
-- two appointments cannot occupy one person.
--
-- Failure codes the app words for itself:
--   42501  not this salon's owner
--   SL001  a service is not bookable at this salon
--   SL003  nobody free, or the named staff member is not this salon's
--   23P01  that chair is already taken (the exclusion constraint)
create function public.create_walkin_booking(
  p_salon_id    uuid,
  p_staff_id    uuid,
  p_service_ids uuid[],
  p_starts_at   timestamptz,
  p_guest_name  text,
  p_guest_phone text default null,
  p_notes       text default ''
)
returns table (booking_id uuid, reference text, staff_id uuid, total_halalas integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted    uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_name      text := btrim(coalesce(p_guest_name, ''));
  v_phone     text := nullif(btrim(coalesce(p_guest_phone, '')), '');
  v_found     integer;
  v_minutes   integer;
  v_ends_at   timestamptz;
  v_vat_rate  numeric(4,3) := 0.150;
  v_subtotal  integer;
  v_net       integer;
  v_vat       integer;
  v_staff     uuid;
  v_booking   uuid;
  v_reference text;
begin
  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'a walk-in needs a name to be filed under' using errcode = 'SL004';
  end if;

  -- Capped here as well as in the constraint, so a long name is trimmed to fit
  -- rather than refusing the booking in front of a waiting customer.
  v_name  := left(v_name, 60);
  v_phone := left(v_phone, 20);

  -- Priced from the salon's own rows, the same way create_booking() prices a
  -- customer's. The owner could be allowed to type their own figure — they are
  -- their prices — but a second pricing path is a second thing to keep in step
  -- with the receipt, and "Booked today" should mean the same thing whoever
  -- wrote the booking.
  --
  -- One difference: a hidden service (is_active false) is accepted here, where
  -- the customer's path takes only live ones. Hiding a service stops it being
  -- offered, and a salon that has stopped advertising something can still do it
  -- for somebody at the counter. Archived is the real "no longer exists", and
  -- that is refused on both paths, because bookings reference those rows.
  select
    count(*)::integer,
    sum(s.duration_minutes)::integer,
    sum(s.price_halalas)::integer,
    sum(round(s.price_halalas::numeric * (100 - s.discount_percent) / 100))::integer
  into v_found, v_minutes, v_subtotal, v_net
  from services s
  where s.id = any (v_wanted)
    and s.salon_id = p_salon_id
    and not s.is_archived;

  if coalesce(v_found, 0) = 0
     or v_found <> (select count(distinct u.id) from unnest(v_wanted) as u(id))
  then
    raise exception 'one of those services cannot be booked at this salon'
      using errcode = 'SL001';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_minutes);

  if p_staff_id is not null then
    -- Named: the only question is whether they are this salon's. Whether they
    -- are free is the exclusion constraint's to answer, and it will. Hidden
    -- staff are accepted for the same reason hidden services are; archived
    -- ones are not, because a booking points at the row.
    select st.id into v_staff
    from staff st
    where st.id = p_staff_id
      and st.salon_id = p_salon_id
      and not st.is_archived;
  else
    select f.staff_id into v_staff
    from free_staff_for(p_salon_id, v_wanted, p_starts_at, v_ends_at) f
    order by f.load, f.sort_order, f.staff_id
    limit 1;
  end if;

  if v_staff is null then
    raise exception 'nobody is free for that time' using errcode = 'SL003';
  end if;

  v_vat := round(v_net::numeric * v_vat_rate)::integer;
  v_reference := new_booking_reference();

  insert into bookings (
    reference, customer_id, guest_name, guest_phone,
    salon_id, staff_id, staff_requested,
    starts_at, ends_at, status,
    subtotal_halalas, discount_halalas, vat_halalas, total_halalas, vat_rate,
    notes
  ) values (
    v_reference, null, v_name, v_phone,
    p_salon_id, v_staff, p_staff_id is not null,
    p_starts_at, v_ends_at,
    -- Somebody is in the chair or has said they are coming; the salon does not
    -- need to confirm its own booking to itself.
    'confirmed',
    v_subtotal, v_subtotal - v_net, v_vat, v_net + v_vat, v_vat_rate,
    left(coalesce(p_notes, ''), 500)
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
    and not s.is_archived;

  return query select v_booking, v_reference, v_staff, (v_net + v_vat);
end;
$$;

comment on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) is
  'The salon writing its own diary: a booking for somebody with no account, filed under a name '
  'the owner typed. Guarded by is_salon_owner(), priced from the salon''s own services, and it '
  'assigns a chair before inserting so the no-double-booking constraint still applies.';

revoke all on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) from public;
revoke execute on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) from anon;
grant execute on function public.create_walkin_booking(uuid, uuid, uuid[], timestamptz, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The calendar has to show them
-- ---------------------------------------------------------------------------

-- salon_day() joined profiles on customer_id. An inner join drops every row
-- where that is null, so without this change a walk-in would be written
-- successfully, hold its chair, count towards the figures — and be invisible on
-- the calendar it was written from. Left join, and the name comes from whichever
-- side has one.
--
-- The phone number needs the same care in the other direction. Guarantee 9 is
-- that a customer's contact details never reach the salon, and it holds: this
-- returns guest_phone and nothing from profiles, so a salon sees only the
-- number it typed in itself. Coalescing p.phone in here would break that
-- silently, which is why assertion 92 checks it.
drop function if exists public.salon_day(uuid, date);

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
  customer_phone text,
  is_walk_in     boolean,
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
    -- only when they have filled it in; or, for the salon's own entry, the name
    -- the salon wrote. Null leaves the screen showing the booking reference.
    coalesce(nullif(p.full_name, ''), nullif(b.guest_name, '')),
    -- Never p.phone. See the note above.
    b.guest_phone,
    b.customer_id is null,
    items.names_en,
    items.names_ar,
    b.total_halalas
  from bookings b
  left join profiles p on p.id = b.customer_id
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
  'One salon-day''s appointments for its owner, walk-ins included. security definer so it can '
  'read the customer''s display name, which profiles_select_own otherwise hides; returns no '
  'other profile detail, and the only phone number it returns is one the salon typed itself.';

revoke all on function public.salon_day(uuid, date) from public;
revoke execute on function public.salon_day(uuid, date) from anon;
grant execute on function public.salon_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What is deliberately unchanged
-- ---------------------------------------------------------------------------
--
-- The row policies need no edit, and it is worth saying why rather than leaving
-- it to be rediscovered:
--
--   bookings_select      `customer_id = auth.uid() or is_salon_owner(salon_id)`.
--                        With customer_id null the first half is null, never
--                        true, so a walk-in is visible to its salon and to
--                        nobody else. Not even to the person it names.
--   booking_items_*      Reached through the booking, so they inherit that.
--   status transitions   The 0006 trigger lets the owner move any of their
--                        salon's bookings and lets a customer cancel their own.
--                        `old.customer_id = auth.uid()` is null for a walk-in,
--                        so the customer branch cannot be reached at all.
--   reviews              reviews_insert_after_visit wants a completed booking
--                        belonging to the reviewer. A walk-in belongs to no
--                        account, so it earns nobody a review — correct: there
--                        is no one to attribute it to.
--   reschedule_booking() Checks `customer_id is distinct from auth.uid()` and
--                        so refuses walk-ins to everyone, the owner included.
--                        The owner moves one from the calendar instead, which
--                        is a plain UPDATE of starts_at/ends_at they already
--                        have. Left alone rather than widened.


-- ===========================================================================
-- 0015_audit_column_privileges.sql
-- ===========================================================================

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


-- ===========================================================================
-- 0016_delete_my_account.sql
-- ===========================================================================

-- Saloni — deleting your account, from inside the app
--
-- Both app stores require this of any app with sign-in, and Saloni has had
-- sign-out only. It is also the plainest reading of Saudi PDPL: a person who
-- asks to be gone should not have to write to anybody.
--
-- The hard part is not deleting. It is that a salon's records are not the
-- customer's to erase. The appointment happened, the salon counted it in its
-- day and its figures, and a business needs to be able to say what it did last
-- Tuesday. So this separates two things that look like one:
--
--   the person   the account, the name, the phone, the devices, the queue
--                position, the messages queued for them, their reviews — gone.
--   the event    when, what, how long, how much, with whom — kept, with nobody
--                attached to it.
--
-- 0014 is what makes that possible: `customer_id` became nullable so a salon
-- could write down a walk-in, and the same shape holds a booking whose customer
-- has left. The booking reference stands in for the name, which is exactly what
-- the calendar already shows for a customer who never gave one.

-- ---------------------------------------------------------------------------
-- 1. Telling an emptied booking from a walk-in
-- ---------------------------------------------------------------------------

-- Both have no customer_id, and they are not the same thing: a walk-in is
-- somebody the salon wrote down, and this is somebody who used to be an
-- account. Without the distinction the calendar would badge every deleted
-- customer's history "Walk-in", which is a small lie told repeatedly.
--
-- It also records *when*, which is the thing a regulator asks for.
alter table bookings add column anonymised_at timestamptz;

comment on column bookings.anonymised_at is
  'Set when the customer deleted their account and this booking was emptied of them. The '
  'appointment stays because it is the salon''s record of its own day; the person does not.';

-- ---------------------------------------------------------------------------
-- 2. delete_my_account()
-- ---------------------------------------------------------------------------

-- Failure codes the app words for itself:
--   42501  nobody is signed in
--   SL007  this account owns a salon
create function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp, auth
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  -- A salon is a business with other people's appointments in it, staff rows,
  -- photographs and a commercial registration somebody checked. Deleting the
  -- person who owns it would either destroy all of that or orphan it, and
  -- neither is a decision this button should make on its own. Refused with a
  -- code the app turns into an explanation.
  if exists (select 1 from salons where owner_id = v_me) then
    raise exception 'this account owns a salon' using errcode = 'SL007';
  end if;

  -- Anything still to come is called off first, so the salon's diary is honest
  -- and the chair goes back on sale. This runs before the anonymising update
  -- because cancelling is what triggers the waitlist to offer the seat on
  -- (0009), and that wants a booking that still makes sense.
  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = 'account deleted'
   where customer_id = v_me
     and status in ('pending', 'confirmed')
     and starts_at > now();

  -- What is left is history. The reference takes the place of the name — the
  -- calendar already renders it that way when nobody gave one — and every
  -- other trace of the person goes.
  update bookings
     set customer_id   = null,
         guest_name    = reference,
         anonymised_at = now()
   where customer_id = v_me;

  -- The queue, and the offers hanging off it (those cascade).
  delete from waitlist_entries where customer_id = v_me;

  -- Messages queued for them, and the phones they were going to.
  delete from notifications      where profile_id = v_me;
  delete from push_subscriptions where profile_id = v_me;

  -- Reviews go with the person. They were this account's words about a salon,
  -- `reviews.customer_id` is not nullable, and a review nobody wrote is not a
  -- review. The salon's rating moves as a result, which is correct: the person
  -- who held that opinion is no longer a customer.
  delete from reviews where customer_id = v_me;

  -- And the account itself. profiles cascades from auth.users, so this is the
  -- one delete that removes the sign-in identity — the e-mail or phone number
  -- Supabase holds — rather than only the app's copy of it.
  delete from auth.users where id = v_me;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the caller''s account: profile, queue position, queued messages, devices and reviews, '
  'and the sign-in identity itself. Past bookings stay as the salon''s own record with the person '
  'removed from them. Refuses while the account owns a salon.';

revoke all on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The calendar tells the two apart
-- ---------------------------------------------------------------------------

-- salon_day() again, for the same reason 0014 rewrote it: the shape of what it
-- returns changed. Only `is_walk_in` differs — a booking emptied by an account
-- deletion is not one the salon wrote at the counter.
drop function if exists public.salon_day(uuid, date);

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
  customer_phone text,
  is_walk_in     boolean,
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
    st.name_en,
    st.name_ar,
    coalesce(nullif(p.full_name, ''), nullif(b.guest_name, '')),
    -- Never p.phone: guarantee 9, and assertion 92 fails if that changes.
    b.guest_phone,
    -- A walk-in the salon wrote, not a booking whose customer has left.
    b.customer_id is null and b.anonymised_at is null,
    items.names_en,
    items.names_ar,
    b.total_halalas
  from bookings b
  left join profiles p on p.id = b.customer_id
  left join staff st on st.id = b.staff_id
  cross join lateral (
    select
      coalesce(array_agg(bi.name_en order by bi.id), '{}') as names_en,
      coalesce(array_agg(bi.name_ar order by bi.id), '{}') as names_ar
    from booking_items bi
    where bi.booking_id = b.id
  ) items
  where b.salon_id = p_salon_id
    and (b.starts_at at time zone 'Asia/Riyadh')::date = p_day
  order by b.starts_at;
end;
$$;

comment on function public.salon_day(uuid, date) is
  'One salon-day''s appointments for its owner, walk-ins included. security definer so it can '
  'read the customer''s display name, which profiles_select_own otherwise hides; returns no '
  'other profile detail, and the only phone number it returns is one the salon typed itself.';

revoke all on function public.salon_day(uuid, date) from public;
revoke execute on function public.salon_day(uuid, date) from anon;
grant execute on function public.salon_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- What this deliberately does not do
-- ---------------------------------------------------------------------------
--
--   Delete the bookings.        They are the salon's record of its own day, and
--                               its figures are built from them. Emptied, not
--                               erased.
--   Delete a salon.             An owner is refused, with SL007. Handing a
--                               salon to somebody else, or closing one, is its
--                               own piece of work and its own decision.
--   Offer a grace period.       The stores want deletion to mean deletion. A
--                               "restore within 30 days" would need the account
--                               kept, which is the opposite of what was asked.


-- ===========================================================================
-- 0017_cap_and_device_takeover.sql
-- ===========================================================================

-- Saloni — two the second audit missed, found by attacking the parts it skipped
--
-- The 0015 audit went at the tables and their policies. It did not go at the
-- functions that move things around afterwards, and one of them walks straight
-- around a rule 0015 had just written. Both of these were demonstrated before
-- being fixed, and both have assertions that fail without them.
--
--   1. A cap on INSERT is not a cap.   0015 stopped an account booking more
--      than three of a salon's slots on one day — at the moment of booking.
--      reschedule_booking() then moves a booking to any day it likes, and
--      nothing counted again. Book three on Monday, three on other days, move
--      them all to Monday: six. The rule read as enforced and was not.
--   2. Knowing a push endpoint was enough to take it.  register_push_device()
--      upserts on the endpoint and sets profile_id to the caller. That is
--      deliberate — a browser shared by two people has one endpoint and it has
--      to follow whoever signed in last — but it asked for nothing but the URL,
--      so anybody holding one could point it at themselves. 0011's own comment
--      names this as the risk it was closing, and it did not close it.

-- ---------------------------------------------------------------------------
-- 1. The cap counts on the way in AND on the way across
-- ---------------------------------------------------------------------------

-- The trigger function itself needs no change: it already excludes the row
-- being written and counts the day the row is landing on. It was only ever
-- asked on INSERT.
--
-- The early return covers the cases this must not touch: a cancellation, a
-- completion, a no-show and a walk-in all leave without counting, so an owner
-- running their day never meets this.
drop trigger if exists bookings_cap_per_customer on bookings;

create trigger bookings_cap_per_customer
  before insert or update on bookings
  for each row
  execute function public.enforce_booking_cap();

comment on function public.enforce_booking_cap() is
  'Caps how much of a salon''s day one account can hold: three at a salon on one day, twelve '
  'upcoming in total. Fires on INSERT and UPDATE, because rescheduling moves a booking to '
  'another day and a cap that is only counted at the moment of booking is not a cap.';

-- ---------------------------------------------------------------------------
-- 2. A device is taken over by the device, not by whoever knows its address
-- ---------------------------------------------------------------------------

-- The takeover has to stay possible. One browser has one endpoint, so a phone
-- two people share hands the subscription to whoever signed in last, and
-- refusing that would leave the first person's account receiving the second
-- person's seat offers — which is worse than what this fixes.
--
-- What changes is what it costs. A real browser re-registering presents the
-- same endpoint AND the same keys: they belong to one subscription and are
-- generated together, so a different subscription would have a different
-- endpoint too. An attacker who has only overheard a URL has neither key.
--
-- So: your own row, you may rewrite freely. Somebody else's, only by proving
-- you hold the device the row is about.
create or replace function public.register_push_device(
  p_endpoint text,
  p_p256dh   text default '',
  p_auth     text default '',
  p_platform push_platform default 'web',
  p_label    text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_id      uuid;
  v_owner   uuid;
  v_p256dh  text;
  v_auth    text;
begin
  if v_me is null then
    raise exception 'sign in before registering a device' using errcode = '42501';
  end if;

  if coalesce(p_endpoint, '') = '' then
    raise exception 'a device needs an endpoint' using errcode = 'SL020';
  end if;

  if p_platform = 'web' and (coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '') then
    raise exception 'a web device needs both of its keys' using errcode = 'SL021';
  end if;

  select profile_id, p256dh, auth
    into v_owner, v_p256dh, v_auth
  from push_subscriptions
  where endpoint = p_endpoint;

  -- Somebody else's row. The keys are the proof, and they are checked before
  -- anything is written.
  if v_owner is not null and v_owner <> v_me then
    if coalesce(p_p256dh, '') <> coalesce(v_p256dh, '')
       or coalesce(p_auth, '') <> coalesce(v_auth, '')
    then
      raise exception 'that device belongs to another account' using errcode = '42501';
    end if;
  end if;

  insert into push_subscriptions (profile_id, platform, endpoint, p256dh, auth, label)
  values (v_me, p_platform, p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''),
          left(coalesce(p_label, ''), 80))
  on conflict (endpoint) do update
    set profile_id   = v_me,
        platform     = excluded.platform,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        label        = excluded.label,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.register_push_device(text, text, text, push_platform, text) is
  'Registers the calling account''s device, or moves an existing one to them — a browser two '
  'people share has one endpoint and must follow whoever signed in last. Moving somebody '
  'else''s requires the subscription''s keys, which only that browser holds: an endpoint URL on '
  'its own is an address, not a proof.';

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Noted, not changed
-- ---------------------------------------------------------------------------
--
-- reassign_appointment() will happily give a chair to a *cancelled* booking.
-- Nothing follows from it — the exclusion constraint ignores cancelled rows, so
-- it blocks nobody, and the appointment sheet offers no such button — but it is
-- untidy, and it is written down here rather than fixed so that finding it
-- again does not cost another afternoon.


