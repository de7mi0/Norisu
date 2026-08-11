-- Saloni — core schema
--
-- Conventions:
--   * Money is stored in halalas (integer), never floats. 150.00 SAR = 15000.
--   * All timestamps are timestamptz. The app displays them in Asia/Riyadh.
--   * Bilingual content is stored as paired *_en / *_ar columns, mirroring the
--     front end's dictionaries.

create extension if not exists "uuid-ossp";
-- Needed for the exclusion constraint that prevents double-booking.
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
  id            uuid primary key default uuid_generate_v4(),
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
  id           uuid primary key default uuid_generate_v4(),
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
  id               uuid primary key default uuid_generate_v4(),
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
  id          uuid primary key default uuid_generate_v4(),
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
  id          uuid primary key default uuid_generate_v4(),
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
  id         uuid primary key default uuid_generate_v4(),
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
  id             uuid primary key default uuid_generate_v4(),
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
  id          uuid primary key default uuid_generate_v4(),
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
  id            uuid primary key default uuid_generate_v4(),
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
  id           uuid primary key default uuid_generate_v4(),
  entry_id     uuid not null references waitlist_entries (id) on delete cascade,
  -- The booking that was cancelled, freeing this slot.
  released_booking_id uuid references bookings (id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  -- Single-use secret in the notification's deep link.
  claim_token  uuid not null unique default uuid_generate_v4(),
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
  id          uuid primary key default uuid_generate_v4(),
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
  id          uuid primary key default uuid_generate_v4(),
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
