# Saloni — database

The Postgres schema behind Saloni, built for Supabase. Nothing here is wired into
the app yet: the prototype still runs on its in-memory demo data. This is the
foundation that replaces it.

```
supabase/
  migrations/
    0001_schema.sql              tables, constraints, the rating view
    0002_row_level_security.sql  who can read and write what
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
- **A salon must be verified before it can be published.**

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

Authentication → Providers.

- **Phone** is what Saloni will use in production, but it needs an SMS provider
  (Twilio, MessageBird or Vonage) with credentials entered there, which costs
  money and takes setup.
- **For now, enable Email instead.** The schema does not care which method
  creates the account, and you can switch to phone later without changing
  anything in the database.

### Step 4 — Create your account

Sign up once through whichever provider you enabled. Authentication → Users
should then show one user. A trigger creates the matching row in `profiles`
automatically — you can check that in the Table Editor.

### Step 5 — Add the demo salons

Same as step 2, with **[`seed.sql`](seed.sql)**: copy it, SQL Editor → New
query, paste, Run.

This one **does** print something: a notice saying `Seeded 4 salons owned by …`.
It makes your account the owner of all four demo salons, and is safe to run more
than once.

If it stops with *"No accounts exist yet"*, step 4 didn't complete — sign in to
the app first, then run it again.

### Step 6 — Collect the keys

Settings → API:

| Key | Where it goes |
| --- | --- |
| Project URL | app config, safe to commit |
| `anon` public key | app config, safe to commit |
| `service_role` key | **server-side only — never in the app, never in git** |

The `anon` key is designed to be public; it ends up in the browser bundle no
matter what you do, and row-level security is what actually protects the data.
The `service_role` key bypasses every policy in `0002` — treat it like the
database password.

## If something goes wrong

The SQL Editor shows errors in red beneath the query. The likely ones:

| Message | What it means |
| --- | --- |
| `type "user_role" already exists` | The script has already been run. The database is fine — carry on to step 3. |
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

## Running the tests

Against any local Postgres 16:

```bash
./scripts/test-db.sh
```

It creates a throwaway database, applies the migrations, runs every assertion and
drops the database again. `tests/00_local_shim.sql` recreates the small part of
Supabase the migrations depend on (the `auth` schema, `auth.uid()`, and the
`anon` / `authenticated` roles) so the policies can be tested exactly as they
will run in production. That file is never applied to Supabase.

## Notes and known gaps

- **Money is stored in halalas** as integers — `15000` is 150.00 SAR. Never use
  floats for money.
- **"Any professional" bookings are not covered by the no-double-booking
  constraint.** With `staff_id` null there is nobody to compare against, so the
  database cannot catch an overlap. Either assign a staff member when the booking
  is made, or add a separate capacity check. This is recorded on the constraint
  itself.
- **Storage buckets are not created here.** Photo upload (ROADMAP item A2) needs a
  bucket plus its own access policies.
- **VAT is stored per booking** (`vat_rate`, default 0.150) rather than assumed,
  so a rate change doesn't rewrite historical invoices.
