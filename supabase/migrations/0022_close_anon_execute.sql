-- Saloni — closing the last of the anonymous EXECUTE grants
--
-- Prompted by Supabase's Security Advisor, which reported sixty warnings and
-- zero errors. Most of them are shape rather than substance, and the work here
-- was deciding which. Written down because the next person to read that screen
-- deserves the answer rather than the panic.
--
-- WHAT WAS NOT WRONG. "Public Can Execute SECURITY DEFINER Function" was raised
-- against most of this schema's functions. Every one of them was called as an
-- anonymous visitor before this migration was written, and every one refused:
-- salon_stats, salon_reviews and salon_waitlist answer 42501 from the
-- is_salon_owner() guard on their first line, my_waitlist answers "sign in to
-- see your waitlist", and the trigger functions cannot be called at all —
-- Postgres answers 0A000, "trigger functions can only be called as triggers".
-- Nothing leaked. The guard inside the body is the boundary and it holds, which
-- is what §10 of CLAUDE.md has said since 0010.
--
-- WHAT WAS WRONG IS THINNER AND STILL WORTH FIXING. Those functions all need a
-- session to do anything, so an anonymous caller should not reach the guard at
-- all. Defence in depth: the day somebody adds a function here and forgets its
-- guard, the grant is the thing that decides whether that is a bug or an
-- incident.
--
-- AND THE REASON THEY WERE REACHABLE IS THE LESSON. 0005 ended each function
-- with `revoke all on function ... from public` and nothing else. §10 records
-- half of why that is not enough — Supabase grants EXECUTE to anon and
-- authenticated BY NAME, so revoking from PUBLIC leaves the named grants. The
-- other half was found here, by trying the opposite and watching it fail:
-- revoking from `anon` by name leaves the PUBLIC grant, and `proacl` still
-- reads `{=X/postgres,...}` — that leading `=X` IS public, and anon inherits
-- through it.
--
--   Neither revoke works alone. Both are required, every time:
--     revoke all     on function f from public;
--     revoke execute on function f from anon;
--     grant  execute on function f to authenticated;
--
-- The functions written from 0014 onward already do this, which is exactly why
-- salon_day() was out of anon's reach and salon_stats() — its neighbour, from
-- the same migration, doing the same kind of work — was not.

-- ---------------------------------------------------------------------------
-- 1. Functions that need a session
-- ---------------------------------------------------------------------------

revoke all on function public.salon_stats(uuid, date) from public;
revoke execute on function public.salon_stats(uuid, date) from anon;
grant execute on function public.salon_stats(uuid, date) to authenticated;

revoke all on function public.salon_reviews(uuid) from public;
revoke execute on function public.salon_reviews(uuid) from anon;
grant execute on function public.salon_reviews(uuid) to authenticated;

revoke all on function public.salon_waitlist(uuid) from public;
revoke execute on function public.salon_waitlist(uuid) from anon;
grant execute on function public.salon_waitlist(uuid) to authenticated;

revoke all on function public.my_waitlist() from public;
revoke execute on function public.my_waitlist() from anon;
grant execute on function public.my_waitlist() to authenticated;

revoke all on function public.join_waitlist(uuid, uuid[], date, time, time) from public;
revoke execute on function public.join_waitlist(uuid, uuid[], date, time, time) from anon;
grant execute on function public.join_waitlist(uuid, uuid[], date, time, time) to authenticated;

revoke all on function public.leave_waitlist(uuid) from public;
revoke execute on function public.leave_waitlist(uuid) from anon;
grant execute on function public.leave_waitlist(uuid) to authenticated;

revoke all on function public.claim_waitlist_offer(uuid) from public;
revoke execute on function public.claim_waitlist_offer(uuid) from anon;
grant execute on function public.claim_waitlist_offer(uuid) to authenticated;

revoke all on function public.extend_waitlist_offer(uuid, integer) from public;
revoke execute on function public.extend_waitlist_offer(uuid, integer) from anon;
grant execute on function public.extend_waitlist_offer(uuid, integer) to authenticated;

revoke all on function public.reoffer_waitlist_slot(uuid) from public;
revoke execute on function public.reoffer_waitlist_slot(uuid) from anon;
grant execute on function public.reoffer_waitlist_slot(uuid) to authenticated;

revoke all on function public.reply_to_review(uuid, text) from public;
revoke execute on function public.reply_to_review(uuid, text) from anon;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

revoke all on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) from public;
revoke execute on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) from anon;
grant execute on function public.create_booking(uuid, uuid, uuid[], timestamptz, text) to authenticated;

revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
revoke execute on function public.reschedule_booking(uuid, timestamptz) from anon;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions, which nobody should be able to call at all
-- ---------------------------------------------------------------------------
--
-- A trigger fires without an execute check, so removing every grant costs
-- nothing and the triggers keep working. Calling one directly already fails
-- with 0A000 whatever the grants say, so this is tidiness rather than a hole
-- being closed — but a function nobody may call is easier to reason about than
-- one that everybody may call and that happens to refuse.

revoke all on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;

revoke all on function public.offer_cancelled_slot() from public;
revoke execute on function public.offer_cancelled_slot() from anon, authenticated;

revoke all on function public.enforce_booking_status_transition() from public;
revoke execute on function public.enforce_booking_status_transition() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What deliberately STAYS reachable by an anonymous visitor
-- ---------------------------------------------------------------------------
--
-- DO NOT "FIX" THESE. The advisor flags them too, and following it here takes
-- the customer side of the app down — proven rather than assumed: revoking
-- is_admin() from anon and then reading the catalogue as anon answers
--
--     42501  permission denied for function is_admin
--
-- and the salon list goes blank for every signed-out visitor. Row-level
-- security policies are evaluated AS THE QUERYING ROLE, so `anon` must be able
-- to execute every function a policy calls. `salons_select_published` is
-- `using (is_published or owner_id = auth.uid() or is_admin())`, and an
-- unpublished salon — which production always has, because every registration
-- starts unverified — forces that last branch to be evaluated.
--
--   is_admin()              policy helper, and it answers about the CALLER
--   is_salon_owner(uuid)    policy helper, answers about the caller
--   salon_is_public(uuid)   policy helper
--   available_slots(...)    browsing is ungated on purpose, so anon needs it
--
-- None of the three helpers leaks: each answers a question about whoever is
-- asking, so an anonymous caller learns only that they are not an admin and own
-- no salon, which they knew.

-- ---------------------------------------------------------------------------
-- 4. The two functions the advisor called "Function Search Path Mutable"
-- ---------------------------------------------------------------------------
--
-- Every `security definer` function in this schema already sets search_path —
-- checked, not assumed. These two are the only ones that did not, and both are
-- security INVOKER, which is why this is housekeeping rather than a hole: an
-- invoker function runs with the caller's own privileges, so hijacking its
-- search_path buys an attacker nothing they did not already have. Setting it
-- costs nothing and silences a warning that would otherwise sit there forever,
-- hiding the next one that matters.

alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.waitlist_hold_minutes() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- What is deliberately NOT here: btree_gist in the public schema
-- ---------------------------------------------------------------------------
--
-- "Extension in Public" is the advisor's remaining complaint, and it is also
-- the source of most of its function-count noise: btree_gist installs ~190
-- support functions of its own, none of which this project wrote.
--
-- It stays where it is. The exclusion constraint that makes double-booking
-- impossible — guarantee 1, the one guarantee the UI cannot make — depends on
-- it, and moving an extension that an index depends on means dropping and
-- rebuilding that constraint on a live database. The risk of that is real and
-- the benefit is a tidier schema. Not worth it, and worth saying so here so
-- nobody talks themselves into it later.
