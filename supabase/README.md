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

**1. Create the project** at [supabase.com](https://supabase.com) → New project.
Pick the region closest to Saudi Arabia (check the region list — Frankfurt is
usually the nearest available). Save the database password it gives you; it is
shown once.

**2. Apply the migrations.** In the dashboard, open **SQL Editor** → New query,
paste the contents of `migrations/0001_schema.sql`, run it, then do the same for
`migrations/0002_row_level_security.sql`. Order matters.

Or, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**3. Turn on phone sign-in.** Authentication → Providers → Phone → enable. It
needs an SMS provider (Twilio, MessageBird or Vonage) with its credentials
entered there. While testing you can skip this and enable email sign-in instead —
the schema doesn't care which one creates the account.

**4. Create your account.** Sign in to the app once so a row exists in
`auth.users`. A trigger creates the matching profile automatically.

**5. Seed the demo data.** SQL Editor → paste `seed.sql` → run. It makes your
account the owner of all four demo salons. It's safe to run more than once.

**6. Collect the keys.** Settings → API:

| Key | Where it goes |
| --- | --- |
| Project URL | app config, safe to commit |
| `anon` public key | app config, safe to commit |
| `service_role` key | **server-side only — never in the app, never in git** |

The `anon` key is designed to be public; it ends up in the browser bundle no
matter what you do, and row-level security is what actually protects the data.
The `service_role` key bypasses every policy in `0002` — treat it like the
database password.

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
