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


