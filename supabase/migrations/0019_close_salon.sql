-- Saloni — closing a salon, so its owner can leave
--
-- 0016 let a person delete their account and refused anybody who owned a salon
-- (`SL007`), because a salon holds other people's appointments, its team, its
-- photographs and a registration somebody checked. That refusal is correct and
-- stays. What was missing was any way *out* of it: the owner was told to hand
-- the salon over or close it, and neither existed.
--
-- **This is a store requirement, not a nicety.** Both stores demand account
-- deletion from inside the app. A reviewer who registers a salon — which the
-- vendor side invites on its first screen — and then tries to delete their
-- account hits a refusal with no way forward. That reads as the requirement
-- being missing, and it is the likeliest avoidable rejection in the project.
--
-- The shape is the one 0016 already established, one level up. There, the
-- person went and the booking stayed with nobody attached. Here, the owner
-- goes and the salon stays with nobody attached:
--
--   the person    their claim on this business — gone.
--   the business  what it did, who it served, what it was paid, the reviews
--                 written about it — kept, owned by nobody.
--
-- Deleting the salon is not an option and never was. Its bookings are other
-- people's records of their own appointments, its reviews are other people's
-- words, and its commission history is what an invoice was built from.
--
-- **Handover is deliberately NOT in this migration.** Transferring a salon
-- needs a second party, and doing it safely needs that party's consent:
-- looking an account up by e-mail would make this an enumeration oracle
-- ("does this address have an account?"), and transferring without acceptance
-- would let anybody drop a business — with its obligations — on somebody who
-- never agreed to it. That wants an invitation somebody accepts, which is a
-- feature, not a column. Closing needs nobody's consent but the owner's, and
-- it is the half that unblocks the store requirement, so it is the half that
-- ships first. ROADMAP.md carries the rest.

-- ---------------------------------------------------------------------------
-- 1. A salon may have no owner
-- ---------------------------------------------------------------------------

-- The exact move 0014 made for bookings.customer_id, and for the same reason:
-- a record whose subject has left is still a record. Every policy that reads
-- owner_id compares it to auth.uid(), and null never equals anything, so a
-- closed salon belongs to nobody automatically — `is_salon_owner()` (0002)
-- returns false for every caller, including an admin acting as a user.
alter table salons alter column owner_id drop not null;

alter table salons add column closed_at timestamptz;

comment on column salons.closed_at is
  'When the owner closed this salon. It stops trading and keeps its records — the bookings '
  'are other people''s appointments and the reviews are other people''s words. A closed salon '
  'has no owner_id, which is what lets that account be deleted.';

comment on column salons.owner_id is
  'Null once the salon is closed (0019). Nullable for the reason bookings.customer_id is: '
  'the business outlives whoever ran it, and the person is not the record''s to keep.';

-- Two things that must stay true, enforced rather than remembered.
--
-- A salon in the customer catalogue has somebody answerable for it. Without
-- this, closing a published salon would leave it bookable with no owner to run
-- the appointments — worse than not closing it at all.
alter table salons add constraint published_salons_have_an_owner
  check (not is_published or owner_id is not null);

-- And a closed salon is not in the catalogue. The two are set together in
-- close_my_salon() below; the constraint is what stops a later change setting
-- one without the other.
alter table salons add constraint closed_salons_are_not_published
  check (closed_at is null or not is_published);

-- ---------------------------------------------------------------------------
-- 2. close_my_salon()
-- ---------------------------------------------------------------------------

-- Failure codes the app words for itself:
--   42501  not signed in, or not this salon's owner
--   SL008  the salon is already closed
--
-- A note on the order, and on a claim that was made here and turned out to be
-- false — kept because getting it wrong is easy and the correction is the
-- useful part.
--
-- The queue is cleared before the bookings are cancelled. The reasoning WAS:
-- cancelling offers a freed seat to whoever is waiting (0009), so clearing the
-- queue first stops closing handing out appointments at a salon that is
-- shutting. That sounds right and is not. Both orders commit identical state,
-- for two reasons that were checked rather than assumed:
--
--   * `waitlist_offers.entry_id` and `notifications.offer_id` both cascade, so
--     deleting the entry afterwards erases the offer AND the queued push along
--     with it. Nothing is left behind to be sent.
--   * This is one function and therefore one transaction, so no worker and no
--     other session ever sees the intermediate state where the offer existed.
--
-- The order below is still the one to keep — not creating rows you are about
-- to delete is cheaper and reads more honestly — but it prevents nothing, and
-- an assertion was written claiming it did before anybody tried to break it.
-- That assertion could not fail and has been removed. See CLAUDE.md §12: a
-- security assertion that cannot fail is worse than none.
create function public.close_my_salon(p_salon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if not is_salon_owner(p_salon_id) then
    raise exception 'not the owner of this salon' using errcode = '42501';
  end if;

  if exists (select 1 from salons s where s.id = p_salon_id and s.closed_at is not null) then
    raise exception 'this salon is already closed' using errcode = 'SL008';
  end if;

  -- 1. The queue, and the offers and queued pushes that cascade from it.
  --    First rather than last only because it is cheaper — see the header for
  --    why it is not load-bearing.
  delete from waitlist_entries where salon_id = p_salon_id;

  -- 2. Everything still to come is called off. A customer holding an
  --    appointment at a salon that has stopped trading must not keep it, and
  --    a reason they can read beats a booking that silently stops meaning
  --    anything.
  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = 'salon closed'
   where salon_id = p_salon_id
     and status in ('pending', 'confirmed')
     and starts_at > now();

  -- 3. Off sale. Archiving rather than deleting, because booking_items point
  --    at these rows and a past booking has to keep meaning what it meant —
  --    the same reason removing a service has always archived it.
  update services set is_archived = true, is_active = false, updated_at = now()
   where salon_id = p_salon_id and not is_archived;

  update staff set is_archived = true, is_active = false, updated_at = now()
   where salon_id = p_salon_id and not is_archived;

  -- 4. And the salon itself: out of the catalogue, marked closed, owned by
  --    nobody. Setting owner_id to null last is what releases the account —
  --    from here delete_my_account() finds no salon and proceeds, with no
  --    change needed to 0016 at all.
  update salons
     set is_published = false,
         closed_at    = now(),
         owner_id     = null,
         updated_at   = now()
   where id = p_salon_id;
end;
$$;

comment on function public.close_my_salon(uuid) is
  'Closes a salon the caller owns: clears its waitlist, cancels what is still to come, '
  'archives its services and team, takes it out of the catalogue and detaches its owner. '
  'The salon and its history stay — they are other people''s appointments and words. This '
  'is what lets a salon owner delete their account (0016).';

-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- default, so "revoke from public" revokes nothing (see 0010). Name the roles,
-- or assertion 84 fails — which is what assertion 84 is for.
revoke all on function public.close_my_salon(uuid) from public;
revoke execute on function public.close_my_salon(uuid) from anon;
grant execute on function public.close_my_salon(uuid) to authenticated;
