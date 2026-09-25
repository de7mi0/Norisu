-- Saloni — the back office, moved into the app
--
-- Until now Saloni's own administration lived entirely in the Supabase
-- dashboard: approving a salon meant ticking `is_verified` then `is_published`
-- in the table editor, denying one meant doing nothing at all, and closing
-- somebody else's meant there was no way to do it. That was survivable while
-- one person ran the whole thing and knew every salon by name. It stops being
-- survivable the moment a second person shares the job, because the dashboard
-- records nothing about who looked at a registration, when, or what they
-- decided — so two people either duplicate the work or assume the other did it.
--
-- THE CONSTRAINT THAT SHAPES ALL OF THIS. An administrator signs in as
-- `authenticated`, exactly like a customer or a salon owner. Column privileges
-- are granted to database ROLES, not to people, so there is no grant that says
-- "authenticated may write is_verified, but only when their profile says
-- admin". 0004 revoked those columns from `authenticated` outright, and that
-- revocation is what makes guarantee 6 true — a salon cannot verify itself.
--
-- So the back office cannot write tables. Every action below is a
-- `security definer` function whose first line is `is_admin()`, the same shape
-- the vendor portal has used since 0005. The boundary is one guard per
-- function, in one file, and assertions fail if any of them is removed.
--
-- This also makes `profiles.role` load-bearing for the first time. It has
-- gated one thing until now (reading a commission statement), and it is about
-- to gate the whole administration of the platform. That raises the stakes on
-- guarantee 7 rather than changing it: `authenticated` has had no UPDATE on
-- `profiles.role` since 0006, because a self-settable role was a one-line
-- privilege escalation, and assertion 53 fails if anybody grants it back.
--
-- An administrator is made in the Supabase dashboard, by hand, once. There is
-- deliberately no function here that promotes one: the first admin could not
-- come from inside the app anyway, so building it would only cover the third
-- and fourth — and in exchange it would make one compromised admin account
-- able to mint more.

-- ---------------------------------------------------------------------------
-- 1. The review trail
-- ---------------------------------------------------------------------------

-- Who decided, when, and — when the answer was no — why. `rejection_reason` is
-- the part a salon owner reads, and the reason denial stops being a black hole
-- they have to telephone somebody about.
alter table salons
  add column reviewed_at      timestamptz,
  add column reviewed_by      uuid references profiles (id) on delete set null,
  add column rejected_at      timestamptz,
  add column rejection_reason text;

comment on column salons.reviewed_by is
  'The administrator who last decided on this salon. A record of an action, like closed_by '
  '(0020) — it grants nothing, and it is in no SELECT grant. Cleared when that person deletes '
  'their account.';

comment on column salons.rejection_reason is
  'Why this salon was turned down, written by an administrator and read by its owner through '
  'my_salon_review(). In no SELECT grant: the row policy would expose it to everybody once the '
  'salon was published, and a rejection is between Saloni and that business.';

-- A rejection has to say why. The screen caps the text as well, but a rule the
-- database does not state is a rule the next caller can walk around — and the
-- whole point of denying in the app rather than the dashboard is that the
-- owner learns something.
alter table salons add constraint rejections_give_a_reason
  check (
    rejected_at is null
    or (rejection_reason is not null and length(btrim(rejection_reason)) between 1 and 500)
  );

-- Approved and denied are not both true. This catches a function that forgets
-- to clear the other half rather than trusting it to remember.
alter table salons add constraint verified_salons_are_not_rejected
  check (not (is_verified and rejected_at is not null));

-- ---------------------------------------------------------------------------
-- 2. Closing: remembering whose salon it was
-- ---------------------------------------------------------------------------

-- 0020 added `closed_by` so the portal could say "you closed Maison Noir" to
-- the person who closed it. An administrator closing somebody else's salon
-- breaks that in exactly the way 0020 was written to fix: closed_by would name
-- the admin, owner_id is null, and the former owner comes back to "this
-- account doesn't own one yet" — the original complaint, reintroduced by a new
-- feature. So the owner at the time is recorded separately from the person who
-- performed the close, and my_closed_salon() answers to either.
alter table salons
  add column closed_owner_id uuid references profiles (id) on delete set null,
  add column closed_reason   text;

comment on column salons.closed_owner_id is
  'Who owned this salon when it was closed, as distinct from closed_by, who performed the '
  'closing. The same person for an owner closing their own; different when Saloni closed it. '
  'Grants nothing — owner_id stays null — and is in no SELECT grant.';

alter table salons add constraint closures_by_saloni_give_a_reason
  check (
    closed_reason is null
    or length(btrim(closed_reason)) between 1 and 500
  );

-- Every salon closed before this migration was closed by its own owner, which
-- is the only way it could have been. Without this the portal would stop
-- naming their salon the moment my_closed_salon() starts reading the new
-- column.
update salons
   set closed_owner_id = closed_by
 where closed_at is not null
   and closed_owner_id is null;

-- ---------------------------------------------------------------------------
-- 3. close_my_salon() records whose it was
-- ---------------------------------------------------------------------------

-- Reproduced from 0020 with one added assignment and nothing else changed. The
-- signature is identical: a different one would create a second overload
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
     set is_published    = false,
         closed_at       = now(),
         closed_by       = v_me,
         -- The owner and the closer are the same person here. Recorded anyway,
         -- so the portal reads one column whoever closed the salon.
         closed_owner_id = v_me,
         owner_id        = null,
         updated_at      = now()
   where id = p_salon_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. my_closed_salon() answers the former owner too
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: Postgres refuses to change a function's return
-- type in place, and `create or replace` with a different one fails outright
-- rather than quietly making an overload. The grant goes with it and is made
-- again below.
drop function public.my_closed_salon();

-- Still the narrowest answer that lets a screen say what happened: a name, a
-- date, whether Saloni did it, and what it said. No id that could be passed to
-- anything, no figures, and no route back in — there is nothing to go back to.
create function public.my_closed_salon()
returns table (
  name_en          text,
  name_ar          text,
  closed_at        timestamptz,
  closed_by_saloni boolean,
  reason           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.name_en,
         s.name_ar,
         s.closed_at,
         -- Saloni closed it if somebody other than the owner did.
         s.closed_by is distinct from s.closed_owner_id,
         s.closed_reason
  from salons s
  where s.closed_at is not null
    -- Either the person who closed it, or the person whose it was. They are
    -- the same account for an owner closing their own.
    and (s.closed_by = auth.uid() or s.closed_owner_id = auth.uid())
  order by s.closed_at desc
  limit 1;
$$;

comment on function public.my_closed_salon() is
  'The name, date and — when Saloni closed it — the reason for the most recent salon the caller '
  'closed or used to own. Answers for auth.uid() only, and returns nothing to anybody else.';

revoke all on function public.my_closed_salon() from public;
revoke execute on function public.my_closed_salon() from anon;
grant execute on function public.my_closed_salon() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The register
-- ---------------------------------------------------------------------------

-- Every salon on the platform, in the order somebody working through them
-- needs: the ones awaiting a decision first. This is also the only way to read
-- `cr_number`, which 0015 revoked from every role after the catalogue's
-- `select *` handed each salon's commercial registration to anonymous
-- visitors — checking that number is the whole point of the review, so an
-- administrator has to see it and nobody else does.
--
-- The owner's e-mail is the one place an address leaves `auth.users`. It is
-- here because a registration that is wrong needs a reply, and the alternative
-- is an administrator opening the Supabase dashboard to find it — which is the
-- habit this migration exists to end.
create function public.admin_salons()
returns table (
  id                uuid,
  name_en           text,
  name_ar           text,
  cr_number         text,
  status            text,
  owner_email       text,
  registered_at     timestamptz,
  reviewed_at       timestamptz,
  reviewed_by_email text,
  rejection_reason  text,
  closed_at         timestamptz,
  closed_reason     text,
  commission_bps    integer,
  services          integer,
  team              integer,
  upcoming          integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  return query
    select s.id,
           s.name_en,
           s.name_ar,
           s.cr_number,
           case
             when s.closed_at is not null  then 'closed'
             when s.rejected_at is not null then 'rejected'
             when s.is_published            then 'live'
             when s.is_verified             then 'verified'
             else 'awaiting'
           end::text,
           ou.email::text,
           s.created_at,
           s.reviewed_at,
           ru.email::text,
           s.rejection_reason,
           s.closed_at,
           s.closed_reason,
           s.commission_bps,
           (select count(*)::integer from services v
             where v.salon_id = s.id and not v.is_archived),
           (select count(*)::integer from staff t
             where t.salon_id = s.id and not t.is_archived),
           (select count(*)::integer from bookings b
             where b.salon_id = s.id
               and b.status in ('pending', 'confirmed')
               and b.starts_at > now())
    from salons s
    left join auth.users ou on ou.id = s.owner_id
    left join auth.users ru on ru.id = s.reviewed_by
    order by case
               when s.closed_at is not null   then 4
               when s.rejected_at is not null then 3
               when s.is_published            then 2
               when s.is_verified             then 1
               else 0
             end,
             s.created_at desc;
end;
$$;

comment on function public.admin_salons() is
  'Every salon on the platform with its review state, for Saloni''s own administrators. The only '
  'read of cr_number that is not the salon''s own owner (my_salon_cr, 0015), and the only place '
  'an owner''s e-mail address leaves auth.users. Refuses anybody whose profile is not admin.';

revoke all on function public.admin_salons() from public;
revoke execute on function public.admin_salons() from anon;
grant execute on function public.admin_salons() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Deciding
-- ---------------------------------------------------------------------------
--
-- Four verbs, and the difference between two of them is worth stating because
-- the screen offers both:
--
--   REJECT is reversible and is a message. The salon goes back to unverified
--   and unpublished, the owner reads why, and changing their commercial
--   registration number puts them straight back into the queue (section 8).
--   Nothing is cancelled and nobody's appointments move.
--
--   CLOSE is terminal. It cancels what is still to come, archives the team and
--   services, and detaches the owner so they can delete their account. It is
--   what an owner does to their own salon (0019), done to somebody else's.

create function public.admin_verify_salon(p_salon_id uuid, p_verified boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  if exists (select 1 from salons s where s.id = p_salon_id and s.closed_at is not null) then
    raise exception 'this salon is closed' using errcode = 'SL032';
  end if;

  update salons
     set is_verified = p_verified,
         -- Unverifying takes it out of the catalogue in the same statement, or
         -- published_salons_are_verified would refuse the change. Verifying
         -- does not publish: those are two decisions and the second is
         -- deliberate.
         is_published = case when p_verified then is_published else false end,
         -- Approving withdraws any previous refusal. The constraint
         -- verified_salons_are_not_rejected fails loudly if this is forgotten.
         rejected_at      = case when p_verified then null else rejected_at end,
         rejection_reason = case when p_verified then null else rejection_reason end,
         reviewed_at  = now(),
         reviewed_by  = v_me,
         updated_at   = now()
   where id = p_salon_id;

  if not found then
    raise exception 'no such salon' using errcode = 'SL006';
  end if;
end;
$$;

comment on function public.admin_verify_salon(uuid, boolean) is
  'Records that an administrator has checked (or withdrawn) a salon''s commercial registration. '
  'Verifying does not publish — that is a second, separate decision.';

create function public.admin_publish_salon(p_salon_id uuid, p_published boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_verified boolean;
  v_closed   timestamptz;
  v_owner    uuid;
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  select s.is_verified, s.closed_at, s.owner_id
    into v_verified, v_closed, v_owner
    from salons s where s.id = p_salon_id;

  if not found then
    raise exception 'no such salon' using errcode = 'SL006';
  end if;

  if p_published then
    if v_closed is not null or v_owner is null then
      raise exception 'this salon is closed' using errcode = 'SL032';
    end if;
    -- The constraint would refuse this anyway; saying so in words means the
    -- screen can show a sentence instead of a constraint name.
    if not v_verified then
      raise exception 'verify this salon before publishing it' using errcode = 'SL030';
    end if;
  end if;

  update salons
     set is_published = p_published,
         updated_at   = now()
   where id = p_salon_id;
end;
$$;

comment on function public.admin_publish_salon(uuid, boolean) is
  'Puts a verified salon into the customer catalogue, or takes it back out. Unpublishing stops '
  'new bookings and cancels none: the appointments a salon already has are its customers''.';

create function public.admin_reject_salon(p_salon_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  -- A refusal the owner cannot act on is the dashboard's silence with extra
  -- steps. The constraint states this too; this states it in a sentence.
  if v_reason = '' then
    raise exception 'say why this salon was turned down' using errcode = 'SL031';
  end if;

  update salons
     set is_verified      = false,
         is_published     = false,
         rejected_at      = now(),
         rejection_reason = left(v_reason, 500),
         reviewed_at      = now(),
         reviewed_by      = v_me,
         updated_at       = now()
   where id = p_salon_id
     and closed_at is null;

  if not found then
    raise exception 'no such open salon' using errcode = 'SL006';
  end if;
end;
$$;

comment on function public.admin_reject_salon(uuid, text) is
  'Turns a salon down and tells its owner why. Reversible: the owner reads the reason through '
  'my_salon_review(), and changing their registration number puts them back in the queue.';

create function public.admin_close_salon(p_salon_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_owner  uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  -- Closing somebody else's business cancels their customers' appointments.
  -- The one thing they are owed is a sentence saying why.
  if v_reason = '' then
    raise exception 'say why this salon is being closed' using errcode = 'SL031';
  end if;

  select s.owner_id into v_owner
    from salons s where s.id = p_salon_id and s.closed_at is null;

  if not found then
    raise exception 'no such open salon' using errcode = 'SL006';
  end if;

  -- Deliberately the same sequence as close_my_salon() (0019), because this is
  -- that function done to somebody else's salon. Keeping the bodies alike is
  -- what stops the two drifting into closing a salon two different ways.
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
     set is_published    = false,
         closed_at       = now(),
         -- The administrator performed it; the owner is who it happened to.
         -- my_closed_salon() answers to either, so the former owner comes back
         -- to their salon's name and this reason rather than to "this account
         -- doesn't own one yet".
         closed_by       = v_me,
         closed_owner_id = v_owner,
         closed_reason   = left(v_reason, 500),
         owner_id        = null,
         updated_at      = now()
   where id = p_salon_id;
end;
$$;

comment on function public.admin_close_salon(uuid, text) is
  'Closes somebody else''s salon: what close_my_salon() (0019) does, done by Saloni, with a '
  'reason its former owner reads. The salon keeps its record of the work it did; the owner is '
  'detached and can then delete their account.';

-- ---------------------------------------------------------------------------
-- 7. The rate
-- ---------------------------------------------------------------------------

-- salons.commission_bps is in no grant at all (0018) — not select, not insert,
-- not update — so an owner can neither read their rate nor set it to zero nor
-- learn a rival's. That left the Supabase dashboard as the only way to agree
-- different terms with one salon, which is the habit this migration ends.
--
-- It changes the rate from here on and nothing that has already happened:
-- every booking snapshots the rate it was made under, so a past invoice cannot
-- be re-priced by a deal struck today.
create function public.admin_set_commission(p_salon_id uuid, p_bps integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'not an administrator' using errcode = '42501';
  end if;

  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    raise exception 'a commission rate is between 0 and 100 per cent' using errcode = 'SL033';
  end if;

  update salons
     set commission_bps = p_bps,
         updated_at     = now()
   where id = p_salon_id;

  if not found then
    raise exception 'no such salon' using errcode = 'SL006';
  end if;
end;
$$;

comment on function public.admin_set_commission(uuid, integer) is
  'Sets what a salon owes Saloni, in basis points. Applies to bookings made from now on: each '
  'one snapshots its own rate (0018), so agreeing new terms never re-prices an old invoice.';

revoke all on function public.admin_verify_salon(uuid, boolean) from public;
revoke all on function public.admin_publish_salon(uuid, boolean) from public;
revoke all on function public.admin_reject_salon(uuid, text) from public;
revoke all on function public.admin_close_salon(uuid, text) from public;
revoke all on function public.admin_set_commission(uuid, integer) from public;

revoke execute on function public.admin_verify_salon(uuid, boolean) from anon;
revoke execute on function public.admin_publish_salon(uuid, boolean) from anon;
revoke execute on function public.admin_reject_salon(uuid, text) from anon;
revoke execute on function public.admin_close_salon(uuid, text) from anon;
revoke execute on function public.admin_set_commission(uuid, integer) from anon;

grant execute on function public.admin_verify_salon(uuid, boolean) to authenticated;
grant execute on function public.admin_publish_salon(uuid, boolean) to authenticated;
grant execute on function public.admin_reject_salon(uuid, text) to authenticated;
grant execute on function public.admin_close_salon(uuid, text) to authenticated;
grant execute on function public.admin_set_commission(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The owner's half
-- ---------------------------------------------------------------------------

-- A refusal the owner never sees is the Supabase dashboard's silence with more
-- machinery behind it. This is the read that makes denial mean something: the
-- salon's own owner, their own salon, and nobody else.
--
-- It is a function rather than a column grant for the reason 0015 spells out.
-- Grants are role-wide, so `grant select (rejection_reason) to authenticated`
-- would be bounded only by the row policy — and that policy lets anybody read
-- a PUBLISHED salon. A salon turned down, corrected and then published would
-- have carried its old refusal, readable by every visitor with an account.
create function public.my_salon_review(p_salon_id uuid)
returns table (
  reviewed_at      timestamptz,
  rejected_at      timestamptz,
  rejection_reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.reviewed_at, s.rejected_at, s.rejection_reason
  from salons s
  where s.id = p_salon_id
    and s.owner_id = auth.uid();
$$;

comment on function public.my_salon_review(uuid) is
  'Where a salon you own stands with Saloni, and — if it was turned down — what was said. '
  'Answers for your own salon and returns nothing for anybody else''s.';

revoke all on function public.my_salon_review(uuid) from public;
revoke execute on function public.my_salon_review(uuid) from anon;
grant execute on function public.my_salon_review(uuid) to authenticated;

-- Reproduced from 0015 with the rejection branch added. A salon that was
-- turned down over its commercial registration number and then changes that
-- number has answered the objection — so it goes back into the queue by the
-- same trigger that already sends a VERIFIED salon back when its number
-- changes. Without this the owner corrects the thing they were told to correct
-- and nothing happens, which is the black hole one layer further in.
create or replace function public.reverify_when_cr_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cr_number is distinct from old.cr_number then
    if old.is_verified or old.is_published then
      new.is_verified  := false;
      new.is_published := false;
    end if;

    if old.rejected_at is not null then
      new.rejected_at      := null;
      new.rejection_reason := null;
      -- Back to awaiting a decision, not "reviewed and refused".
      new.reviewed_at      := null;
      new.reviewed_by      := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.reverify_when_cr_changes() from public;
revoke execute on function public.reverify_when_cr_changes() from anon, authenticated;
