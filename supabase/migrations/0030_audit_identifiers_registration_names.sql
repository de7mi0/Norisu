-- 0030: the low-severity findings from the third audit that live in the database.
--
--   L1. Reviewers were traceable. public_reviews() (0024) promises "Nora A."
--       and nothing else, but the `reviews` table itself was readable by anon
--       table-wide, customer_id included, so one person's reviews could be
--       linked across every salon. salons.owner_id was readable by any
--       signed-in account and staff.profile_id by everybody, so the same ids
--       could be joined to "this reviewer owns a rival salon".
--
--   L2. Registration had no server-side limit. "One salon per owner" lived in
--       the app alone: 300 salons from one account went straight in, every one
--       with the same commercial registration number — a flooded review queue,
--       and a way to register under somebody else's CR.
--
--   L6. Names had no length limit in the database. The app caps them at 60;
--       a direct request, or the sign-up metadata handle_new_user() copies,
--       could store a megabyte that salon calendars and public reviews show.
--
-- **Apply this AFTER the app change that comes with it is live.** The old app
-- asks for `staff.*` and filters salons on `owner_id`; both are refused once
-- this runs, and the customer catalogue would fall back to sample data until
-- the new app arrived. The new app works against the database either side of
-- this migration — supabase/README.md has the order.

-- ---------------------------------------------------------------------------
-- L1. The ids that link people are not public
-- ---------------------------------------------------------------------------

-- A column revoke against a table-wide grant does nothing (CLAUDE.md §7), so
-- each table grant goes and the columns are named.
--
-- reviews: everything but customer_id. booking_id stays because the customer's
-- own booking list embeds `reviews (id)`, and that join reads booking_id; it is
-- a random id per visit and links nobody to anything. salon_ratings is
-- security_invoker, so anon needs salon_id, rating and is_published too.
revoke select on reviews from anon, authenticated;
grant select (id, booking_id, salon_id, rating, body, reply, replied_at, is_published, created_at)
  on reviews to anon, authenticated;

-- staff: everything but profile_id, which nothing in the app reads.
revoke select on staff from anon, authenticated;
grant select (id, salon_id, name_en, name_ar, role_en, role_ar, initials,
              is_active, is_archived, sort_order, created_at, updated_at)
  on staff to anon, authenticated;

-- salons: already granted column by column since 0015; owner_id comes out.
-- The row policy still compares owner_id = auth.uid() — a policy is not bound
-- by column privileges — so an owner still sees and edits their own salon.
revoke select (owner_id) on salons from authenticated;

-- What the owner's portal used owner_id for: "which salon is mine?"
create function public.my_salon_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id from salons s
  where s.owner_id = auth.uid()
  order by s.created_at
  limit 1;
$$;

comment on function public.my_salon_id() is
  'The calling account''s salon, if it owns one. salons.owner_id is in no SELECT grant (0030).';

revoke all on function public.my_salon_id() from public;
revoke execute on function public.my_salon_id() from anon, authenticated;
grant execute on function public.my_salon_id() to authenticated;

-- ---------------------------------------------------------------------------
-- L2. One salon per account, and one live salon per registration number
-- ---------------------------------------------------------------------------

-- A trigger rather than unique indexes, for two reasons. Existing data: the
-- demo salons from seed.sql all belong to one account, and an index would
-- refuse to build. And the dashboard: seeding, fixing and testing are done
-- there without a JWT, and they are not the thing being limited. So the rules
-- apply to the browser's role and nothing else — `role` is the setting
-- PostgREST sets, which a security definer function does not change.
--
-- A closed salon (owner_id null, 0019) holds no number: the business can
-- register again, which is the point of closing. A squatter holding somebody
-- else's number is resolved by Saloni closing the squatter's salon from the
-- back office, which frees it — and the refusal says to contact Saloni.
create function public.salons_registration_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), 'none') <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from salons s where s.owner_id = new.owner_id
  ) then
    raise exception 'this account already has a salon' using errcode = 'SL050';
  end if;

  if new.cr_number is not null and btrim(new.cr_number) <> '' and exists (
    select 1 from salons s
    where s.id <> new.id
      and s.owner_id is not null
      and btrim(s.cr_number) = btrim(new.cr_number)
  ) then
    raise exception 'that commercial registration number is already registered'
      using errcode = 'SL051';
  end if;

  return new;
end;
$$;

revoke all on function public.salons_registration_rules() from public;
revoke execute on function public.salons_registration_rules() from anon, authenticated;

create trigger salons_registration_rules
  before insert or update of cr_number on salons
  for each row
  execute function public.salons_registration_rules();

-- ---------------------------------------------------------------------------
-- 0029's device cap, corrected
-- ---------------------------------------------------------------------------

-- Found while writing this migration's tests: 0029 kept "the ten most recently
-- seen", and the device being registered was meant to be one of them because it
-- had just been touched. Inside one transaction every row has the same now(),
-- so the tie fell to the order of the ids and the new device could be the one
-- dropped. Rare on the live site, where each registration is its own request,
-- but a cap that sometimes drops the phone in your hand is not the rule it
-- says it is. Only the delete changes.
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

  if p_platform = 'web' and not is_push_service_endpoint(p_endpoint) then
    raise exception 'that is not a push service address' using errcode = 'SL022';
  end if;

  select profile_id, p256dh, auth
    into v_owner, v_p256dh, v_auth
  from push_subscriptions
  where endpoint = p_endpoint;

  -- Somebody else's row. The keys are the proof, and they are checked before
  -- anything is written (0017).
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

  -- Ten per account: the device registering now, and the nine others seen
  -- most recently. It is excluded by id rather than trusted to sort first —
  -- 0029 trusted the timestamp, and two registrations in one transaction
  -- share one now(), so which row went was down to the order of their ids.
  delete from push_subscriptions
   where profile_id = v_me
     and id <> v_id
     and id in (
       select id from push_subscriptions
        where profile_id = v_me and id <> v_id
        order by last_seen_at desc, created_at desc, id
        offset 9
     );

  return v_id;
end;
$$;

revoke all on function public.register_push_device(text, text, text, push_platform, text) from public;
revoke execute on function public.register_push_device(text, text, text, push_platform, text)
  from anon;
grant execute on function public.register_push_device(text, text, text, push_platform, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- L6. A name is at most 60 characters, wherever it comes from
-- ---------------------------------------------------------------------------

-- Same number as NAME_MAX_LENGTH in the app. Anything longer already stored
-- is cut to fit first, so the constraint can be checked against every row.
update profiles set full_name = left(full_name, 60) where char_length(full_name) > 60;

alter table profiles
  add constraint profiles_full_name_length check (char_length(full_name) <= 60);

-- The sign-up copy of the name comes from metadata the caller sends to Supabase
-- Auth, so it is cut here rather than refused: refusing would fail the sign-up
-- itself, over a field the person can fix afterwards.
create or replace function handle_new_user()
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
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 60)
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;
