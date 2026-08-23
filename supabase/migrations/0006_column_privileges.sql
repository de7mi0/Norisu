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
