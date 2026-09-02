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
    0012_claim_by_token.sql      the notification's link claims that seat
    0013_salon_photos.sql        the bucket photographs live in, and who may write it
    0014_walkin_bookings.sql     the salon's own diary: bookings for people with no account
  functions/send-notifications/  the worker that sends them; deployed, never delivered
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

### If photographs upload but never appear to a customer

The picture shows in the vendor Gallery, and the customer's side still shows a
striped tile. Four things have to line up, and each one fails silently, so check
them in this order — the first two are the common ones.

**1. Is the salon published?** An unpublished salon is not in the customer
catalogue *at all*, photographs or not, and its `salon_media` rows are hidden
from a signed-out visitor by the same rule. A salon that registered itself
starts unpublished on purpose — see "Approving a salon that has registered"
above.

```sql
select id, name_en, is_verified, is_published from salons;
```

**2. Is the bucket public?** Reading a photograph is an ordinary image request
with no key on it, so the bucket has to be public. Migration 0013 creates it
that way; a bucket made by hand in the dashboard is private unless the box was
ticked, and then uploading works fine while every picture 404s.

```sql
select id, public, file_size_limit from storage.buckets where id = 'salon-photos';
```

`public` must be `true`. If it is not:

```sql
update storage.buckets set public = true where id = 'salon-photos';
```

**3. Is there a row?** The file and the row are written separately, and the app
shows what the rows say.

```sql
select salon_id, storage_path, is_cover from salon_media order by salon_id, sort_order;
```

**4. Does the file itself load?** Take a `storage_path` from above and open

```
https://<your project ref>.supabase.co/storage/v1/object/public/salon-photos/<storage_path>
```

in a browser tab. If the photograph appears there but not in the app, the
problem is in the app. If that URL 404s or says the bucket was not found, it is
step 2 — the app is doing the right thing and falling back to the placeholder
tile rather than showing a broken image.

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
`claim_pending_notifications` means 0010 is, `register_push_device`
means 0011 is, and `claim_offer_by_token` means 0012 is, and `create_walkin_booking`
means 0014 is. 0013 leaves a bucket rather than a function —
`select id from storage.buckets where id = 'salon-photos';` should return one row.

**0014 is the one to run if the calendar's "Add a booking" button reports an error.**
Without it there is no function behind that button, and no `guest_name` column for the
name to go in.

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

A freed seat is pushed to the customer's phone from Saloni itself. Four steps, none of
which needs a terminal, and until all four are done the outbox fills and nothing leaves
it.

### 1. Generate a VAPID key pair

These are what a push service checks our messages against. The private half must never
leave your control, so generate them yourself rather than being sent a pair.

**If you have a terminal**, one command:

```bash
npx web-push generate-vapid-keys
```

**If you do not**, your browser can do it, and nothing leaves the machine. Open Saloni
(or any page), press **F12** for developer tools, click **Console**, paste this and press
Enter:

```js
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('PUBLIC :', b64(raw));
console.log('PRIVATE:', jwk.d);
```

Either way you get two strings: a **public** key of 87 characters and a **private** key
of 43. Keep them in front of you for the next two steps. Checked rather than assumed —
keys from that snippet were run through `web-push` and produce a valid signed request.

### 2. Give the private half to Supabase, and the public half to the app

The private key must never be committed. Go to the secrets page for your project —
the sidebar only shows it once you are inside Edge Functions, so the direct link is
easier:

**https://supabase.com/dashboard/project/nicdmspejrvruszlwhvm/functions/secrets**

Add each of these with **Add new secret**:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | the public key from step 1 |
| `VAPID_PRIVATE_KEY` | the private key from step 1 |
| `VAPID_SUBJECT` | `mailto:` and your e-mail, e.g. `mailto:you@example.com` |

`SUPABASE_URL` and the service key are injected automatically; you do not add those.
Secrets take effect immediately — there is no need to redeploy after changing one.

The same thing from the command line, if you prefer:

```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
supabase secrets list
```

**Then the public half goes into the app.** Open `.env` in this repository and put the
public key — only the public one — after the `=`:

```
VITE_VAPID_PUBLIC_KEY=BOK7N--_HNJktgn3427W5NwRsU-...
```

Commit and push that. It is safe to commit, exactly like the Supabase publishable key
above it: Vite inlines it into the browser bundle at build time, so it is public no
matter where it is kept. Pushing to the default branch redeploys the site, and until
that deploy finishes the app still asks nobody for permission and promises nothing.

### 3. Deploy the worker

**From the dashboard, with no tools installed.** `supabase/functions/send-notifications/`
is three files, which is awkward to recreate by hand, so
`scripts/build-function-bundle.sh` writes the whole worker as one file:
`supabase/functions/send-notifications/bundled.ts`.

1. Open **Edge Functions** in the left sidebar of your project.
2. Click **Deploy a new function** → **Via Editor**.
3. Name it exactly **`send-notifications`**.
4. Select everything in the editor, delete it, and paste the entire contents of
   `bundled.ts`.
5. Click **Deploy function**. It takes 10–30 seconds.

The dashboard editor keeps no version history, which is fine here: the repository is the
history, and `bundled.ts` is regenerated from the originals rather than edited.

**From the CLI, if you have it**, deploy the directory instead — `index.ts` and
`message.ts` are the originals:

```bash
supabase functions deploy send-notifications
```

### 4. Run it every minute

The worker does nothing until something calls it. Supabase has a scheduler with a UI:

1. Go to **Integrations → Cron** (or straight to
   `https://supabase.com/dashboard/project/nicdmspejrvruszlwhvm/integrations/cron/jobs`).
2. Click **Create job**.
3. Name it `send-notifications`.
4. Set the schedule to every minute — the form takes cron syntax (`* * * * *`, or
   `*/1 * * * *`, which means the same thing) or plain English.
5. **Two extensions have to be on first, and the form only tells you about one.**

   - **`pg_cron`** is the scheduler itself. Without it the form fails on save with
     `relation "cron.job" does not exist` — the extension is what creates the `cron`
     schema the dashboard is looking in.
   - **`pg_net`** lets Postgres make an HTTP call, which is what invoking an Edge
     Function is. Without it the *Supabase Edge Function* option is greyed out, saying
     `pg_net needs to be installed to use this type`. There is an **Install pg_net
     extension** button in that same panel.

   Both are enabled the same way if you prefer to do it up front — **Database →
   Extensions**, search the name, toggle it on — or in the SQL Editor:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   ```

   Both are standard on Supabase and this is the route their own dashboard is built
   around. `pg_net`'s documentation labels its API as beta and notes it caps out around
   200 requests a second and keeps responses for six hours; at one call a minute neither
   matters.
6. Choose **Supabase Edge Function** and pick `send-notifications`.
7. Save.

**Then check it is actually reaching the function**, because the dashboard's own
Edge Function job type has produced a call with no key on it, and the failure is
completely silent: `pg_cron` records "succeeded" every minute regardless, since `pg_net`
posts asynchronously and never waits for the reply. The real answer lands here:

```sql
select created, status_code, left(coalesce(error_msg, content), 200) as reply
from net._http_response order by created desc limit 5;
```

A `200` with `{"claimed":…}` is what you want. **`401 UNAUTHORIZED_NO_AUTH_HEADER`** means
the request arrived without a key and the gateway turned it away before the function ran.
A `NULL` status with "Timeout of 1000 ms reached" means the reply was discarded unread —
`pg_net` defaults to a one-second timeout, which the worker can exceed while it is talking
to a push service.

Both are fixed by scheduling the job in SQL instead:

```sql
select cron.unschedule(jobid) from cron.job where command like '%send-notifications%';

select cron.schedule('send-notifications', '* * * * *', $job$
  select net.http_post(
    url := 'https://nicdmspejrvruszlwhvm.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'sb_publishable_eRn58Oq07-aEww1zsw5ztA_chwPRXY_',
      'Authorization', 'Bearer sb_publishable_eRn58Oq07-aEww1zsw5ztA_chwPRXY_'
    ),
    body := jsonb_build_object('invoked_at', now()),
    timeout_milliseconds := 10000
  );
$job$);
```

That is the **publishable** key — already public, already in the browser bundle, and only
proving the request came from this project. The secret key stays in the function's own
environment and never appears in a cron job, which is stored as plain text in the database.

If you would rather not add the extension, the alternative is an external scheduler —
a GitHub Actions workflow on a cron that POSTs to the function's URL with the service
key in repository secrets. More moving parts, and nothing here needs it.

Every minute rather than every ten, because a hold lasts fifteen and a notification that
arrives after the seat has gone is worse than none.

**It has never delivered anything.** It runs, and returns `{"claimed":0,...}` while no
device is registered. Watch the first delivery: the function's **Logs** tab shows what it
returned — `{"claimed":n,"sent":n,"failed":n}` — and anything that failed leaves its
reason in `notifications.error`.

### Testing the whole chain yourself

The waitlist only appears when a time is **fully booked**, and a fresh database has no
bookings at all — so every slot is free and there is no way in. That is correct behaviour
and a trap when testing: nothing is broken, there is simply nothing to wait for.

Three of the four demo salons have **one chair** — The Barber Atelier, Rose & Oud and
Kingdom Cuts — so a single booking fills a slot. Maison Noir has three and would need
three. Use a one-chair salon and the whole thing can be tested from one phone, on one
account, without touching SQL:

1. Open the app and sign in.
2. Go to **Kingdom Cuts**, pick a service, choose **tomorrow**, and book a time — say
   16:00.
3. Go back into the same salon, service and day. That time now shows as taken.
4. **Tap the taken time.** This is the waitlist entry point. Join the list — the app asks
   permission to notify you at exactly this moment, so allow it.
5. Open **Bookings** and cancel the appointment you made in step 2.

Cancelling frees the chair, which offers it to the longest-waiting match — you — and
queues a push. The cron job sends it within a minute.

Yes, you are being offered a seat you freed yourself. That is fine: every step is the real
one, and it saves needing a second person and a second account.

To watch it happen from the database side:

```sql
-- The offer, and the message queued for it.
select n.channel, n.locale, n.created_at, n.sent_at, n.failed_at, n.error,
       n.payload ->> 'claim_url' as link
from notifications n order by n.created_at desc limit 5;
```

`sent_at` filled in means the worker delivered it. `failed_at` with an `error` means it
tried and could not — the reason is the useful part. Neither filled in means the worker
has not picked it up yet; give it a minute.

### What customers have to do

On **Android** and desktop, nothing — they are asked for permission the moment they join
a waitlist, and that is the only time Saloni asks. Chrome on Android delivers push to an
ordinary tab, so adding it to the home screen is optional there (worth doing anyway: an
installed app is less likely to have its service worker evicted).

On **iPhone**, Safari only allows notifications for a page added to the home screen. The
waitlist sheet says so in both languages when it detects an iPhone in an ordinary tab.
There is no way around that short of the native app.

### If no notification arrives at all

Work outwards from the database; each step rules out one place it can break.

**Is the worker even being called?** `select created, status_code, left(coalesce(error_msg,
content), 200) from net._http_response order by created desc limit 5;` — a `401` here means
the cron job is being rejected before the function runs, and the section above fixes it.
This one is worth checking first because every other symptom looks the same from the phone.

**Did the worker find anything?** A `200` whose body says `{"claimed":0,...}` means it ran
and the outbox was empty — so either no offer was made, or nobody has a device registered,
or the seat was claimed in the app before the worker's next run. That last one is deliberate:
a message about a seat you have already taken is worse than silence.

**Did the send fail?** `sent_at`, `failed_at` and `error` on the `notifications` row say so
directly. A `403` from the push service almost always means the `VAPID_PUBLIC_KEY` in Edge
Function secrets does not match the `VITE_VAPID_PUBLIC_KEY` the browser subscribed with.

### If a notification only arrives while the browser is open

That is not how push is meant to work — an installed service worker is woken by the push
service whether or not any tab is open — so it means something is holding the message
back. In order of likelihood:

1. **Urgency.** The sender asks for `urgency: 'high'`, which tells the push service to
   wake the device immediately. Without it the default is `normal`, and Android is free to
   hold the message until the phone next leaves Doze — usually when somebody unlocks it,
   which looks exactly like "it only works when I have the tab open". If you deployed the
   worker before this was added, **redeploy it**.
2. **Android battery optimisation.** Samsung, Xiaomi, Oppo and Huawei ship aggressive app
   killers that stop Chrome being woken in the background. Settings → Apps → Chrome →
   Battery → **Unrestricted**. This is the most common cause after urgency, and it is a
   device setting rather than anything the app can fix.
3. **Chrome swiped out of recents.** On some devices this stops it receiving anything until
   next opened.
4. **Data Saver or restricted background data** on Chrome.

To tell a delivery problem from a sending problem, check whether the server thinks it sent:

```sql
select created_at, sent_at, failed_at, error
from notifications order by created_at desc limit 5;
```

`sent_at` filled while your phone showed nothing means the push service accepted it and the
device did not display it — that is items 2 to 4. `failed_at` with an error means the send
itself failed, and the error says why.

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
- **"Any professional" bookings were outside the no-double-booking constraint
  until 0008**, because with `staff_id` null there was nobody to compare
  against. `create_booking()` now assigns a chair before it inserts, so the
  constraint applies and a salon cannot be oversold. Rows written before 0008
  are the only ones still unprotected.
- **The `salon-photos` bucket is created by 0013**, public to read and writable
  only inside a folder named after a salon you own. Nothing moderates what goes
  into it.
- **VAT is stored per booking** (`vat_rate`, default 0.150) rather than assumed,
  so a rate change doesn't rewrite historical invoices.
