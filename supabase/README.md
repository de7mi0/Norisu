# Saloni — database

The Postgres schema behind Saloni, built for Supabase. The app reads its
catalogue from here, signs people in against it, books appointments against it
and shows a salon owner their own day out of it.

```
supabase/
  migrations/
    0001_schema.sql              tables, constraints, the rating view
    0002_row_level_security.sql  who can read and write what
    0003_availability.sql        which times a salon can actually take
    0004_owner_cannot_self_verify.sql  an owner may not approve their own salon
    0005_vendor_day.sql          the owner's own diary, figures and reviews
    0006_column_privileges.sql   which columns each side may write
    0007_review_reply.sql        the only way a salon can answer a review
    0008_create_booking.sql      the only way a booking is made, priced and staffed
    0009_waitlist.sql            the queue, the holds, and claiming a freed seat
    0010_notifications.sql       every offer queues a message
    0011_push_devices.sql        registered devices, and push instead of WhatsApp
  functions/send-notifications/  the worker that sends them. NEVER RUN
  seed.sql                       the four demo salons and their services
  tests/                         local-only harness and assertions
```

## What the schema guarantees

These are enforced by the database, not by application code, so they hold even if
the app has a bug or someone calls the API directly:

- **No double-booking.** A staff member cannot have two overlapping active
  bookings. Two customers tapping the same slot at the same instant is settled by
  Postgres — the second one gets an error.
- **Past bookings never change.** `booking_items` keeps its own copy of the name,
  price and duration. A salon raising its prices cannot alter what a previous
  customer was charged.
- **Salons are isolated from each other.** A vendor can only read and write their
  own salon's services, staff, photos and bookings.
- **Customers see only their own bookings**, and cannot create one in someone
  else's name.
- **Reviews must be earned** — only for a completed booking that is yours.
- **A salon must be verified before it can be published**, and cannot verify
  itself — approving a salon is a human decision, not something the owner can
  make on their own row.
- **A salon owner sees their own customers and nobody else's.** The vendor
  calendar reads through functions that check ownership first; another salon
  asking about your day gets an error, not a list.
- **A customer's contact details stay theirs.** The salon is given the name they
  chose to give and nothing more — never an e-mail address or a phone number.
- **Nobody can promote themselves.** Being an administrator is not something an
  account can grant itself, which it could before migration 0006.
- **What a booking cost cannot be changed after it is made**, by either side,
  and nobody can mark a booking paid that was not.
- **A salon cannot edit, hide or answer the reviews written about it** by writing
  to the database directly.
- **A booking cannot be made at a price the customer chose**, at a time the salon
  is closed, or without a real staff member to do the work — and one that cannot
  be completed leaves nothing behind.
- **The salon cannot be oversold.** "Any professional" used to leave nobody
  attached to the appointment, so the database could not tell it was full.
- **Nobody can jump the waitlist queue.** Position is decided by when somebody
  joined, and that is not a value the app is allowed to set.

All of the above are covered by assertions in `tests/01_policy_tests.sql`.

## Setting up a Supabase project

### Step 1 — Create the project

At [supabase.com](https://supabase.com) → **New project**. Pick the region
closest to Saudi Arabia (check the list — Frankfurt is usually the nearest
available). Save the database password it shows you; it is only shown once.

Wait until the project finishes provisioning — a minute or two.

### Step 2 — Run the setup script

**Everything the app needs is in one file: [`setup.sql`](setup.sql).** You paste
it once. You do not need the files in `migrations/` — `setup.sql` is built from
them.

1. Open **[setup.sql on GitHub](https://github.com/de7mi0/Norisu/blob/claude/saloni-prototype-dev-idl8tr/supabase/setup.sql)**.
2. Click the **copy icon** at the top right of the file (its tooltip says "Copy
   raw file"). That puts the whole file on your clipboard.
3. Back in Supabase, click **SQL Editor** in the left sidebar — the icon that
   looks like a database terminal.
4. Click **"+ New query"** at the top of the list. You get a large empty text
   area, which is where you were stuck: it starts blank and there is nothing to
   choose or upload. It is just a box you paste SQL into.
5. Click inside that box and paste (Ctrl+V, or Cmd+V on a Mac).
6. Click the green **Run** button at the bottom right — or press Ctrl+Enter
   (Cmd+Enter on a Mac).

It takes a couple of seconds. **Success looks underwhelming:** a message like
"Success. No rows returned". That is correct — the script creates tables, it
doesn't return data. Nothing else will appear to happen.

To confirm it worked, click **Table Editor** in the left sidebar. You should now
see `profiles`, `salons`, `services`, `staff`, `bookings` and the rest, all
empty. That's the real proof.

<details>
<summary>Prefer the command line?</summary>

With the [Supabase CLI](https://supabase.com/docs/guides/cli), the migrations
apply the same way:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
</details>

### Step 3 — Turn on sign-in

The app has a sign-in screen, and it is passcode-only: you type an e-mail
address or a mobile number, a six-digit code arrives, you type it back. There
are no passwords anywhere in Saloni.

**Authentication → Providers.**

- **Email** — enable it. This is what runs today.
- **Phone** is what Saloni will use in production, because an SMS code is the
  Saudi norm. It needs an SMS provider (Twilio, MessageBird or Vonage) with
  credentials entered there, which costs money and takes setup. Leave it off
  until you have one.

Two settings decide whether the codes actually arrive.

**3a — Make the e-mail carry a code, not just a link.**

Authentication → Emails → **Magic Link**. Supabase's stock template contains
only a link, and it is English-only. The app asks for a six-digit code, so
without the token there is nothing to type and sign-in cannot complete.

Replace the whole **Message body** with
[`email-templates/magic-link.html`](email-templates/magic-link.html). It carries
the code *and* keeps the link, so a customer who taps instead of typing still
gets in — and it says everything in both English and Arabic, because Supabase
sends one template to everybody and cannot know which language the recipient
chose in the app.

**3b — Allow the app's address to be redirected back to.**

Authentication → URL Configuration → **Redirect URLs**. Add the addresses the
app is served from, otherwise tapping the link in the e-mail goes nowhere:

```
https://de7mi0.github.io/Norisu/
http://localhost:5173/
```

**Switching to SMS later.** Enable the Phone provider, then set
`VITE_AUTH_PHONE_OTP=true` in [`.env`](../.env) and redeploy. That is the whole
change on the app's side — the two steps are identical for both channels, so
the screen simply starts offering the mobile-number option. The database does
not care which method created an account.

> **Rate limits will bite you while testing.** Supabase allows one passcode per
> minute per address, and the built-in e-mail service is capped at a handful of
> messages per hour — the exact number is under Authentication → **Rate Limits**,
> and Supabase has lowered it over time, so read it there rather than trusting a
> number written down here. The app shows a countdown before it will let you ask
> again; "Too many attempts" is this limit, not a bug. The built-in service is
> for testing only — for real use, add your own SMTP under Authentication →
> Emails → SMTP Settings.

### Step 4 — Create the first app user

> **Two different accounts, easily confused.** The account you log into
> supabase.com with is *yours*, and the database knows nothing about it. What
> the app needs is a **user of Saloni** — a row in your project's own
> `auth.users` table, which starts out empty. Salons have to belong to one of
> those.

After step 2 the `profiles` table exists but is **empty**, which is correct — a
row appears only once a user exists. Creating that user is this step.

You can now sign in from the app itself, and the first account will be created
for you the first time you do. But `seed.sql` in step 5 needs an account to
exist *before* it runs, so that it has an owner to hand the demo salons to —
which is why this step comes first. Creating it from the dashboard happens
under Authentication, not the Table Editor:

1. Go to **[Authentication → Users](https://supabase.com/dashboard/project/_/auth/users)**
   (or press **Ctrl+K** and type "Users").
2. **Add user** (top right) → **Create new user**.
3. **Use an e-mail address you can actually read.** The app signs in by sending
   a code to it, so `owner@saloni.test` would lock you out of your own vendor
   account. A password is required by this form but Saloni never uses it.
4. Tick **Auto Confirm User** so it's usable immediately.
5. **Create user**.

Now open **Table Editor → profiles**. A row should have appeared, matching the
user you just made. You did not create it — the trigger from step 2 did. That is
the best confirmation that the schema is working.

The `profiles` row starts with `role = 'customer'`. If this account is the salon
owner, set it to `vendor` — the app shows the role on the profile screen, so you
will see the change:

```sql
update profiles set role = 'vendor', full_name = 'Your Name'
where id = (select id from auth.users order by created_at limit 1);
```

If the Users list has a row but `profiles` is still empty, the trigger did not
fire; tell me and I'll look into it.

### Step 5 — Add the demo salons

**What it's for:** your database is currently empty — no salons, no services. The
app would show a blank screen. This puts the four demo salons from the prototype
(Maison Noir, The Barber Atelier, Rose & Oud, Kingdom Cuts) into it, with their
services and staff, so there's something to see once the app is connected. It
also makes the account from step 4 their owner, so you can use the vendor portal.

Same as step 2, with **[`seed.sql`](seed.sql)**: copy it, SQL Editor → New
query, paste, Run. Safe to run more than once.

This one ends with a count, so you get a table back rather than "No rows
returned":

| salons | services | staff | working_hours | profiles |
| --- | --- | --- | --- | --- |
| 4 | 11 | 6 | 28 | 1 |

If it stops with *"No accounts exist yet"*, step 4 didn't complete — create the
user first, then run it again.

### Step 6 — Collect the keys

**What they're for:** these are how the app finds your project. Supabase hosts
millions of databases; the URL says which one is yours, and the anon key is the
credential the app presents when it connects. Without them the app has no idea
your database exists. You send them to me and I put them in the app's config.

You need two things: the **Project URL** and the **publishable key**.

**The Project URL** is easiest to read off your browser's address bar. Any
dashboard page looks like:

```
https://supabase.com/dashboard/project/abcdefghijklmnop/editor
                                       ^^^^^^^^^^^^^^^^ your project ref
```

The Project URL is that ref plus `.supabase.co`:
`https://abcdefghijklmnop.supabase.co`. The green **Connect** button in the top
bar shows it too, ready to copy.

**The keys** are under Settings → API. Supabase has two generations of key names
and which you see depends on when the project was created — they do the same
jobs:

| Public key (safe in the app) | Secret key (never in the app) |
| --- | --- |
| `sb_publishable_…` | `sb_secret_…` |
| `anon` `eyJ…` *(older projects)* | `service_role` `eyJ…` *(older projects)* |

The public key is designed to be public: it ships inside the browser bundle no
matter what you do, and the row-level security in `0002` is what actually
protects the data. The secret key **bypasses every one of those policies** —
treat it like the database password, and never put it in the app or in git.

## Approving a salon that has registered

A salon owner registers themselves in the app (**I own a salon → Register your salon**). Their
salon is created straight away, and they can set up their opening hours, services and team
immediately — but **customers cannot see or book it until you approve it.** The database enforces
that: a salon cannot be published unless it has been verified first.

**Only you can do this.** Migration 0004 revokes the salon owner's permission to write
`is_verified` and `is_published`, so an owner cannot approve their own salon however they reach the
database. The dashboard connects with a key that bypasses that, which is why these steps work here
and nowhere else.

Approving is a two-part act, and the order matters.

1. Open your project at **https://supabase.com/dashboard**.
2. In the left sidebar click **Table Editor**.
3. Choose the **salons** table from the list.
4. Find the new row. `is_verified` and `is_published` will both be unticked, and `cr_number`
   holds the commercial registration number they typed in.
5. **Check that CR number is genuine** before going further — this is the whole point of the step.
   You can look it up on the Ministry of Commerce site.
6. Click the `is_verified` cell for that row and set it to **true**.
7. Click the `is_published` cell and set it to **true**.
8. Press **Save** if the editor asks.

The salon appears in the customer app on their next load. No deploy is needed.

**To take a salon back down,** untick `is_published`. Leave `is_verified` ticked — you have still
checked them, and unticking both is what you do only if the verification itself was wrong. Their
existing bookings are untouched either way; hiding a salon stops new bookings, it does not cancel
old ones.

**If you set `is_published` before `is_verified`,** the database refuses the change with a message
about `published_salons_are_verified`. That is the constraint doing its job — tick `is_verified`
first and try again.

## If something goes wrong

The SQL Editor shows errors in red beneath the query. The likely ones:

**First, a note on what "nothing happened" means.** The Supabase SQL Editor
displays returned rows, but **not** Postgres notices. A script that only creates
things therefore reports `Success. No rows returned` — which is what success
looks like, not a warning. If something had actually failed you would get a red
error instead.

| Message | What it means |
| --- | --- |
| `type "user_role" already exists` | `setup.sql` has already been run. The database is fine — carry on. Re-running it always stops here, because the first thing it creates is already there. |
| `relation "profiles" already exists` | Same: an earlier partial run. See "starting over" below. |
| `extension "btree_gist" is not available` | Rare on hosted Supabase. Tell me and I'll rework the double-booking constraint to avoid it. |
| `permission denied for schema auth` | You're running as a restricted role. Use the dashboard SQL Editor, which runs with the right privileges. |
| `No accounts exist yet` (from `seed.sql`) | Step 4 hasn't happened — create your account first. |

**Starting over.** Nothing here is precious while you're setting up. Run this in
the SQL Editor to wipe the schema, then re-run `setup.sql`:

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
```

This deletes every table and all data in `public`. It leaves your account and
the Supabase project itself alone.

## Adding a later migration to a project you already set up

`setup.sql` is for a fresh project. It creates everything from scratch, so
re-pasting it into a database that already has tables stops at the first line
with `type "user_role" already exists` — harmless, but it means nothing new gets
applied either.

When a new migration is added after your project is running, paste **just that
file**. Nothing already in the database is touched, and no data is lost.

**Right now the one you need is [`0006_column_privileges.sql`](https://github.com/de7mi0/Norisu/blob/claude/saloni-prototype-dev-idl8tr/supabase/migrations/0006_column_privileges.sql).**
It closes three security holes, and unlike most changes it takes effect the moment
you run it — the website redeploying does nothing for it, because these are
database permissions rather than app code.

The steps are the same for any migration. Taking `0005_vendor_day.sql` as the
example, the one that made the vendor dashboard show the owner's real salon:

1. Open **[0005_vendor_day.sql on GitHub](https://github.com/de7mi0/Norisu/blob/claude/app-progress-review-a83m59/supabase/migrations/0005_vendor_day.sql)**.
   (That link points at the branch the file was written on. Once the branch is
   merged, the same file is on the default branch at the same path.)
2. Click the **copy icon** at the top right of the file.
3. In Supabase, **SQL Editor** → **"+ New query"**.
4. Paste into the box and click **Run** (or Ctrl+Enter / Cmd+Enter).
5. `Success. No rows returned` is what success looks like — see the note under
   "If something goes wrong".

If you get `function "salon_day" already exists`, it has been applied before and
there is nothing to do. (0006 is grants and a trigger rather than functions, so
the equivalent there is `trigger "bookings_status_transition" ... already exists`.)

Migrations are numbered, and each one only ever needs applying once. If you are
unsure which your project has, the quickest check is to run this in the SQL
Editor — it lists the ones that leave a function behind:

```sql
select proname from pg_proc
where pronamespace = 'public'::regnamespace
order by proname;
```

`available_slots` means 0003 is in. `salon_day`, `salon_stats` and
`salon_reviews` mean 0005 is in. `reply_to_review` means 0007 is in, and
`create_booking` means 0008 is, and `join_waitlist` means 0009 is.
`claim_pending_notifications` means 0010 is, and `register_push_device`
means 0011 is.

**0008 is the one migration that must not be skipped once the site is
redeployed.** From that version the app books by calling `create_booking()`, so
until the function exists booking fails outright rather than falling back.

For 0006, which leaves grants and a trigger rather than functions, this is the
check — it should come back `applied`:

```sql
select case
  when has_column_privilege('authenticated','public.profiles','role','UPDATE')
    then 'NOT APPLIED — accounts can still promote themselves'
  else 'applied'
end as migration_0006;
```

## Turning on notifications

A freed seat is pushed to the customer's phone from Saloni itself. Three steps, and
until all three are done the outbox fills and nothing leaves it.

### 1. Generate a VAPID key pair

These are what a push service checks our messages against. One command, on your own
machine:

```bash
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Keep the terminal open.

### 2. Give the private half to Supabase, and the public half to the app

The private key must never be committed. In the Supabase dashboard, **Edge Functions →
Secrets** (or `supabase secrets set`), add:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | the public key from step 1 |
| `VAPID_PRIVATE_KEY` | the private key from step 1 |
| `VAPID_SUBJECT` | `mailto:` and your e-mail, e.g. `mailto:you@example.com` |

Then put the **public** key — only the public one — into `.env`:

```
VITE_VAPID_PUBLIC_KEY=<the public key>
```

That one is safe to commit, exactly like the Supabase publishable key: it is inlined
into the browser bundle by design. Until it is set, the app never asks anybody for
permission and never promises to notify them.

### 3. Deploy the worker

```bash
supabase functions deploy send-notifications
```

Then schedule it to run every minute or two. Holds last 15 minutes, so a worker that
runs every ten wastes most of them.

**It has never been run.** Watch the first real one: it returns
`{"claimed":n,"sent":n,"failed":n}`, and anything that failed leaves its reason in
`notifications.error`.

### What customers have to do

On **Android** and desktop, nothing — they are asked for permission the moment they join
a waitlist, and that is the only time Saloni asks.

On **iPhone**, Safari only allows notifications for a page added to the home screen. The
waitlist sheet says so in both languages when it detects an iPhone in an ordinary tab.
There is no way around that short of the native app.

### To see what is waiting to go out

```sql
select channel, locale, template, created_at, send_after, attempts,
       sent_at, failed_at, error
from notifications
order by created_at desc
limit 50;
```

And which devices are registered:

```sql
select p.full_name, d.platform, d.label, d.created_at
from push_subscriptions d join profiles p on p.id = d.profile_id
order by d.created_at desc;
```

To see what is waiting to go out:

```sql
select channel, locale, template, created_at, send_after, attempts,
       sent_at, failed_at, error
from notifications
order by created_at desc
limit 50;
```

**Quiet hours ship switched off**, because stretching holds overnight while nobody's
phone buzzes costs the queue its turn-taking for nothing. Turn them on when messages are
really being sent:

```sql
update notification_settings set quiet_from = '22:00', quiet_to = '08:00';
```

The same table holds `rate_per_hour` (how many separate offers one person may be pinged
about in an hour, default 4) and `app_base_url`, which is where the claim link points —
change that when the app moves off GitHub Pages.

## Running the tests

```bash
./scripts/test-db.sh
```

That is the whole thing. On a machine that has never run it, it creates a local
Postgres cluster in `/var/tmp/saloni-pg` and starts it first — Postgres does not
run by default, and a fresh container has no cluster to start. Both steps happen
once and are silent afterwards.

It then creates a throwaway database, applies the migrations, runs every assertion and
drops the database again. The cluster itself stays, so the next run is immediate.

The two helpers behind it can also be run on their own:

```bash
./scripts/pg-start.sh   # start the server (creating the cluster if needed)
./scripts/pg-stop.sh    # stop it again; the cluster's files stay put
```

`pg-start.sh` is worth running by hand when you want a database to look inside
rather than a pass/fail — it leaves the server up for `psql`:

```bash
psql -h /var/tmp -p 5433 -U postgres
```

The server listens on a Unix socket only, never on a network port, so nothing off
the machine can reach it. Nothing in `/var/tmp/saloni-pg` is worth keeping: every
run builds its own database and drops it, so losing the cluster on reboot costs
one `initdb`.

To run against a Postgres of your own instead, set `PGHOST`, `PGPORT` or
`PGUSER`. `test-db.sh` then leaves the starting to you and says so if nothing is
listening. It needs Postgres 16 — that is the version the assertions are written
against.

`tests/00_local_shim.sql` recreates the small part of
Supabase the migrations depend on (the `auth` schema, `auth.uid()`, and the
`anon` / `authenticated` roles) so the policies can be tested exactly as they
will run in production. That file is never applied to Supabase.

## Notes and known gaps

- **Money is stored in halalas** as integers — `15000` is 150.00 SAR. Never use
  floats for money.
- **"Any professional" bookings are not covered by the no-double-booking
  constraint at the moment they are written.** With `staff_id` null there is
  nobody to compare against. `available_slots()` (0003) does count the salon's
  free chairs when it offers times, so a full salon stops offering them — but
  two people racing the last chair can still both be accepted. Assigning a staff
  member as the booking is made is the real fix.
- **Storage buckets are not created here.** Photo upload (ROADMAP item A2) needs a
  bucket plus its own access policies.
- **VAT is stored per booking** (`vat_rate`, default 0.150) rather than assumed,
  so a rate change doesn't rewrite historical invoices.
