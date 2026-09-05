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
