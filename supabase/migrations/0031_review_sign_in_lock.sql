-- 0031: the lock on the app-store reviewers' sign-in.
--
-- supabase/functions/review-sign-in lets ONE account sign in with a fixed
-- six-digit code, because App Store and Google Play reviewers cannot read the
-- e-mail a normal code goes to. A fixed code is a guessable code unless the
-- guessing is limited, and an Edge Function keeps nothing between calls — so
-- the count lives here.
--
-- Five wrong attempts in an hour, from anybody, and it stops for the rest of
-- the hour. Counted for everybody rather than per address, because an address
-- is free to change and the attacker chooses it. The cost is that somebody
-- guessing can lock the reviewer out for an hour; the reviewer is told to try
-- again later, which is a better failure than a million guesses.
--
-- Nothing here is reachable from the browser: no grant to anon or
-- authenticated on the table or either function, only to service_role, which
-- the function runs as.

create table review_sign_in_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

alter table review_sign_in_failures enable row level security;
-- No policy, so no browser role reads a row even if a grant appeared later.
revoke all on review_sign_in_failures from anon, authenticated;

create function public.review_sign_in_allowed()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*) < 5
  from review_sign_in_failures
  where at > now() - interval '1 hour';
$$;

create function public.review_sign_in_failed()
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  -- A day of history is plenty to answer "why was the reviewer locked out?".
  delete from review_sign_in_failures where at < now() - interval '1 day';
  insert into review_sign_in_failures default values;
$$;

-- Both revokes, every time (CLAUDE.md §10): PUBLIC, and the named roles.
revoke all on function public.review_sign_in_allowed() from public;
revoke execute on function public.review_sign_in_allowed() from anon, authenticated;
grant execute on function public.review_sign_in_allowed() to service_role;

revoke all on function public.review_sign_in_failed() from public;
revoke execute on function public.review_sign_in_failed() from anon, authenticated;
grant execute on function public.review_sign_in_failed() to service_role;

grant select, insert, delete on review_sign_in_failures to service_role;
