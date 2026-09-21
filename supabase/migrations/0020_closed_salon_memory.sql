-- Saloni — remembering who closed a salon, so the portal can say so
--
-- 0019 did its job and created a new one, found by the owner closing a real
-- salon and coming back: the vendor portal showed a salon again. Not theirs —
-- the bundled sample one, which the portal falls back to for any account that
-- owns none. The notice above it read "Sample salon — this account doesn't own
-- one yet", and for somebody who had just deliberately shut their business,
-- every word of that is wrong. `yet` most of all.
--
-- The cause is 0019 working exactly as designed. Closing severs every link
-- between the person and the salon — that is the point, it is what releases
-- the account — so afterwards the app genuinely cannot tell "just closed one"
-- from "never had one". Both are `owner_id` matching nothing.
--
-- So the link has to come back, in a form that carries none of the old
-- meaning. `closed_by` is a record of an ACTION somebody took, not a claim on
-- the business:
--
--   * It grants nothing. Every policy and `is_salon_owner()` read `owner_id`,
--     which stays null, so a closed salon still has no owner and this person
--     still cannot manage, publish or reopen it.
--   * It is in no SELECT grant, exactly like `cr_number` (0015) and
--     `commission_bps` (0018), so nobody reads it from the browser — not even
--     the person named in it. `my_closed_salon()` below answers for yourself
--     and for nobody else.
--   * It goes when the person goes. `on delete set null` means deleting the
--     account clears it, which keeps guarantee 26 intact: the salon keeps its
--     record of the work it did, and the person is not the salon's to keep.

alter table salons
  add column closed_by uuid references profiles (id) on delete set null;

comment on column salons.closed_by is
  'Who closed this salon. A record of an action, not ownership — owner_id stays null and this '
  'grants nothing. Readable only through my_closed_salon(), and only by that person. Cleared '
  'when they delete their account, because the person is not the salon''s to keep.';

-- ---------------------------------------------------------------------------
-- 1. close_my_salon() signs its work
-- ---------------------------------------------------------------------------

-- Reproduced from 0019 with one added assignment and nothing else changed.
-- The signature is identical: a different one would create a second overload
-- rather than replace this function.
create or replace function public.close_my_salon(p_salon_id uuid)
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

  delete from waitlist_entries where salon_id = p_salon_id;

  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = 'salon closed'
   where salon_id = p_salon_id
     and status in ('pending', 'confirmed')
     and starts_at > now();

  update services set is_archived = true, is_active = false, updated_at = now()
   where salon_id = p_salon_id and not is_archived;

  update staff set is_archived = true, is_active = false, updated_at = now()
   where salon_id = p_salon_id and not is_archived;

  update salons
     set is_published = false,
         closed_at    = now(),
         -- Recorded in the same statement that clears owner_id, so there is no
         -- instant where a salon is closed and nobody knows who closed it.
         closed_by    = v_me,
         owner_id     = null,
         updated_at   = now()
   where id = p_salon_id;
end;
$$;

comment on function public.close_my_salon(uuid) is
  'Closes a salon the caller owns: clears its waitlist, cancels what is still to come, '
  'archives its services and team, takes it out of the catalogue, detaches its owner and '
  'records who closed it. The salon and its history stay — they are other people''s '
  'appointments and words. This is what lets a salon owner delete their account (0016).';

-- ---------------------------------------------------------------------------
-- 2. my_closed_salon()
-- ---------------------------------------------------------------------------

-- The narrowest possible answer: the name and the date, for a salon you closed
-- yourself. No id that could be passed to anything, no figures, no route back
-- in — there is nothing to go back to. It exists so a screen can say "you
-- closed Rose & Oud on 21 September" instead of "this account doesn't own one
-- yet", which is the wrong sentence for the one person it is shown to.
create function public.my_closed_salon()
returns table (name_en text, name_ar text, closed_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.name_en, s.name_ar, s.closed_at
  from salons s
  where s.closed_by = auth.uid()
    and s.closed_at is not null
  -- The most recent, for somebody who has opened and closed more than one.
  order by s.closed_at desc
  limit 1;
$$;

comment on function public.my_closed_salon() is
  'The name and date of the most recent salon the caller closed themselves, so the portal can '
  'say what happened rather than showing a sample salon and calling it "not owned yet". '
  'Answers for auth.uid() only, and returns nothing to anybody else.';

-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- default, so "revoke from public" revokes nothing (see 0010). Name the roles,
-- or assertion 84 fails.
revoke all on function public.my_closed_salon() from public;
revoke execute on function public.my_closed_salon() from anon;
grant execute on function public.my_closed_salon() to authenticated;
