# Saloni (صالوني) — project instructions

A bilingual salon-booking platform for Saudi Arabia. This document is the full brief: what
the app is, how it is built, what genuinely works, and what is still theatre. Read it before
proposing changes — several things that look unfinished are deliberate, and several things
that look finished are not.

**Repository:** `de7mi0/Norisu` · **Live:** https://de7mi0.github.io/Norisu/
**Default branch:** `claude/saloni-prototype-dev-idl8tr` — **not `main`; `main` does not exist.**
**Also in scope but empty:** `de7mi0/norisu-ai`, reserved for a future assistant service.

---

## 1. What it is

Two apps inside one shell, chosen on a first screen:

- **Customer** — find a salon, pick services, choose a specialist and a time, pay, manage bookings.
- **Vendor** — the salon owner's side: dashboard, calendar, services, staff, gallery, reviews, waitlist.

**Salons sign themselves up.** There is no back office typing them in, so registration is the front
door of the whole vendor side: until a salon can create its own row, every owner account owns
nothing and the portal has nobody to serve. A registered salon is **unverified and unpublished**
until a human checks its commercial registration — `supabase/README.md` has the click-by-click.

Fully bilingual English / Arabic with real right-to-left layout, not a translation layer bolted on.
It began as a Claude Design prototype (`Saloni Prototype.dc.html`, **not in the repo**) and was
built out as a real app. The implementation is the source of truth now.

**Target platform:** native apps on the App Store and Google Play, reached by wrapping this same
codebase with **Capacitor** — no rewrite. The web build is the development and testing surface.

**Scale:** 66 TypeScript files, ~13,800 lines. ~3,100 lines of migrations, ~7,400 including tests and seed.

---

## 2. Tech stack

| Layer | Choice | Version |
| --- | --- | --- |
| UI | React | 19.2 |
| Language | TypeScript | 6.0 |
| Build | Vite | 8.2 |
| Lint | oxlint | 1.75 |
| Backend | Supabase (Postgres + Auth + RLS) | client `@supabase/supabase-js` 2.112 |
| Hosting | GitHub Pages via GitHub Actions | Node 22 in CI |

**Deliberately absent: no CSS framework, no state library, no router.** Styling is inline styles
plus a small `global.css`. Navigation is a `switch` on a screen name held in state. Do not
introduce Tailwind, Redux, Zustand or React Router without asking — their absence is a decision,
not an oversight.

**Commands:** `npm run dev` · `npm run build` (runs `tsc -b` first, so a type error fails the
deploy) · `npm run lint` · `./scripts/test-db.sh` · the browser checks in
`scripts/browser-tests/` (see its README — Playwright is installed ad hoc, not a dependency) ·
`node --experimental-strip-types scripts/test-notification-text.mjs`

The hosted Postgres version is whatever Supabase provisioned for the project — check the
dashboard rather than assuming. The local test harness runs against Postgres 16, and
`test-db.sh` now brings that Postgres up itself — see §7.

---

## 3. Repository layout

```
.env                          Supabase URL + publishable key (committed on purpose — see §7)
.github/workflows/deploy.yml  builds and deploys to GitHub Pages on push to the default branch
index.html                    fonts, favicon, meta
scripts/
  test-db.sh                  applies migrations to a throwaway Postgres, runs assertions
  pg-start.sh                 starts that Postgres, creating the cluster on the first run
  pg-stop.sh                  stops it again; the cluster's files stay in /var/tmp
  build-setup-sql.sh          concatenates migrations into supabase/setup.sql
  build-function-bundle.sh    inlines the worker into one pasteable file
  browser-tests/              145 Chromium checks in both languages; see its README
  test-notification-text.mjs  the words a push carries, in both languages
src/
  App.tsx                     screen router, tab bars, floating overlays
  theme.ts                    colour / type / placeholder-tile tokens
  types.ts                    domain models
  styles/global.css           reset, fonts, keyframes, phone-frame CSS, .ltr-run
  lib/
    supabase.ts               client; `isSupabaseConfigured` false ⇒ demo mode
    auth.ts                 ★ passcode sign-in, identifier normalisation, profile reads
    database.types.ts         row types for the tables the app reads
  data/
    repository.ts           ★ loads the catalogue from Supabase, maps rows → app types
    bookings.ts             ★ writes and reads bookings; the price snapshot lives here
    availability.ts         ★ asks the database which times are actually free
    owner.ts                ★ the salon the signed-in user owns; hours + interval writes
    vendorBookings.ts       ★ the owner's own day, figures and reviews
    waitlist.ts             ★ the queue, both sides of it
    salons/services/staff/reviews/payments/vendor.ts   bundled demo data (fallback)
  i18n/
    en.ts / ar.ts             dictionaries (identical keys, enforced by the `Dictionary` type)
    index.ts                  money / tags / category / unit formatting helpers
  state/
    appReducer.ts           ★ all app state + actions (one reducer)
    AppContext.tsx            provider: timers, catalogue loading, session, derived values
    context.ts                context object + `useApp()` hook + `dateAtOffset`
    useSession.ts             who is signed in; listens to Supabase, does not drive it
    account.ts                display name / label / initials for the signed-in user
    replies.ts                scripted chat + assistant content, delays, input caps
  components/                 PhoneFrame, Screen, TabBar, SheetModal, NameSheet,
                              SampleDataNotice, Conversation, Toast, LangToggle, icons
  screens/Auth.tsx            sign-in sheet; floats over any screen in either mode
  screens/customer/           12 screens
  screens/vendor/             10 screens, plus AppointmentSheet.tsx (the owner's actions),
                              appointment.tsx (the row the dashboard and calendar share)
                              and status.ts (one status → label map for both)
  hooks/useDragScroll.ts      mouse-drag for horizontal rails
supabase/
  migrations/0001_schema.sql              14 tables, constraints, rating view
  migrations/0002_row_level_security.sql  30 policies + grants
  migrations/0003_availability.sql        available_slots() + salons.slot_step_minutes
  migrations/0004_owner_cannot_self_verify.sql  column grants: an owner may not approve itself
  migrations/0005_vendor_day.sql  salon_day() / salon_stats() / salon_reviews()
  migrations/0006_column_privileges.sql  which columns each side may write, and
                                         which status changes each side may make
  migrations/0007_review_reply.sql  reply_to_review(); the only way to answer one
  migrations/0008_create_booking.sql  create_booking() / reschedule_booking();
                                      the only way a booking comes into existence
  migrations/0009_waitlist.sql  the queue, the 15-minute holds, and claiming
  migrations/0010_notifications.sql  every offer queues a message.
                                     Also closes a function-privilege hole — see §7
  migrations/0011_push_devices.sql   registered devices; push replaces WhatsApp
  migrations/0012_claim_by_token.sql  the notification's link lands on the seat
  functions/send-notifications/  the worker that drains the outbox; deployed and
                                 scheduled. message.ts is pure and is tested;
                                 bundled.ts is GENERATED, for the dashboard editor
  setup.sql                   GENERATED — every migration concatenated, for one-paste setup
  seed.sql                    4 demo salons, 11 services, 6 staff, opening hours (verified counts)
  email-templates/magic-link.html  the sign-in e-mail; bilingual, carries {{ .Token }}
  tests/00_local_shim.sql     recreates Supabase's auth schema/roles for local testing
  tests/01_policy_tests.sql   88 assertions
  README.md                   Supabase setup, approving a salon, applying a later migration
docs/whatsapp-waitlist-template.md  the message a customer gets when a seat opens,
                              in both languages, plus how to get it approved by Meta
ROADMAP.md                    backlog + the path to the app stores
```

---

## 4. Front-end architecture

**One reducer, one context.** All state lives in `src/state/appReducer.ts` as a single `AppState`
with a discriminated-union `Action` type and an `assertNever` exhaustiveness guard — TypeScript
errors if an action goes unhandled. `AppContext.tsx` wraps it and adds derived values (totals, the
active salon, staff name, date and slot summaries) and side-effecting actions. Screens call
`useApp()`, read what they need, and dispatch. **No screen owns cross-screen state.**

**Navigation** is `state.screen` plus `state.mode` (`'customer' | 'vendor' | null`). `App.tsx` maps
screen names to components via two lookup records. Back behaviour is a `BACK_MAP` in the reducer,
with special cases for reschedule and for chat/assistant, which remember where they were opened from.

**Who owns the vendor portal.** `data/owner.ts` answers "which salon is this person's?" — a plain
query, not a `security definer` function, because `salons_select_published` already lets an owner
read their own salon (published or not) and `salons_update_own` lets them write it. It loads that
salon's services and staff itself rather than reusing `loadCatalog()`, which only fetches
*published* salons and would leave an owner still setting up staring at an empty list of their own
services. The portal stays browsable signed out on purpose — it is how the demo is shown — so every
still-simulated section carries a `SampleDataNotice`. Only the **waitlist** still needs one:
`section="waitlist"` is the last of those markers left, and the whole-portal notice still appears
for a visitor who owns no salon.

**`data/vendorBookings.ts` is the other half**, and it *is* `security definer`, for a reason worth
keeping straight: `bookings_select` already lets an owner read their salon's appointments, so the
rows were never the problem. `profiles_select_own` is `id = auth.uid()`, so an owner can read no
profile but their own — the browser can fetch the bookings and still not know whose they are.
`salon_day()`, `salon_stats()` and `salon_reviews()` (0005) cross that boundary as narrowly as
possible: the customer's display name and nothing else about them.

**Remote state is the exception to the one-reducer rule.** The catalogue and the session are
async and owned by Supabase, so they live in `useState`/`useSession` inside `AppContext` rather
than the reducer. Only *UI* state for those features (the sign-in form's two steps, for instance)
goes in the reducer. Follow this split for anything new that talks to the backend.

**i18n.** `en.ts` is the source of truth; `ar.ts` is typed as `Dictionary`, so a missing key fails
the build. Direction flips via `dir` on the phone frame and on `<html>`. Helpers in `i18n/index.ts`
handle money (`SAR 150` / `150 ر.س`), tag and category translation, and unit localisation inside
seeded strings.

**Dates go through `i18n/index.ts`, never `toLocaleDateString` at the call site.** `monthLabel`,
`weekdayLabel`, `dayLabel` and `instantLabel` all resolve the locale from `lang`; `weekdayFromCode`
covers the seeded vendor week, whose days are stored as `"MON"` rather than as dates. Two details
are load-bearing: **`-ca-gregory`**, because Saudi locales otherwise default to the Hijri calendar
while every stored date is Gregorian, and **`-nu-latn`**, because the rest of the app writes Latin
digits (prices, appointment times, the day numbers in the strip) and Arabic locales would otherwise
render dates alone in Arabic-Indic digits, putting two numbering systems on one screen. Hardcoding
`'en-US'` anywhere is the bug this replaced — it left English weekday names sitting inside Arabic
sentences.

**Bidi gotcha — already fixed, do not regress.** Latin-and-digit runs like `-20%` and `0.8 km`
reorder inside Arabic text. They are wrapped in `.ltr-run` (`direction: ltr; unicode-bidi: isolate`).
**Any new mixed-script string needs the same.**

**Presentation.** A phone frame on desktop; full-screen below 430px. All in `global.css`
(`.stage`, `.bezel`, `.viewport`, `.notch`).

**Timers.** Every simulated delay is tracked in a ref `Set` and cleared on unmount.

---

## 5. Data flow

```
Supabase ──> repository.loadCatalog() ──> AppContext state ──> useApp() ──> screens
                     │
                     └── on failure/timeout/empty ──> demoCatalog() from src/data/*
```

`loadCatalog()` fetches salons, services, staff and `salon_ratings` in parallel, then maps rows to
the app's existing types so **screens never see database shapes**. Conversions: `price_halalas / 100
→ price`, `duration_minutes → "45 min"`, placeholder tiles assigned by index, and an
`"any professional"` option appended to every salon's staff list (a UI affordance, not a row).

`catalogSource` is `'demo' | 'loading' | 'live' | 'error'`. Anything other than `live` shows a small
notice on the home screen and keeps the app fully usable on sample data.

**Handled honestly rather than faked:**
- A salon with no reviews shows **"New"**, not a score. `Salon.rating` is `number | null`.
- **Distance is empty** — the app does not ask for location yet, so it is omitted rather than invented.
- The salon-level discount badge and "from" price are **derived** from that salon's live services.

**Availability takes the same shape but a different route.** `data/availability.ts` calls the
`available_slots()` Postgres function rather than selecting rows, because row-level security
deliberately hides other customers' bookings — the browser cannot see what is taken, so the
database answers free/busy on its behalf. Its `source` is `'loading' | 'live' | 'demo' | 'error' |
'closed'`, and `'closed'` (the salon does not open that day) is deliberately distinct from a day
where every slot came back taken, because the screen says different things.

**The vendor portal reads through functions, not tables.** `data/vendorBookings.ts` maps the three
0005 functions to app types the same way, with the same `source` union minus `'closed'` — a closed
day is a fact about the day (`stats.isOpen`), not a failure to load one. `'demo'` there means the
viewer owns no salon, which is what keeps the portal browsable for a demo.

**Watch out:** `supabase-js` retries a failed request **four times internally**, and `.abortSignal()`
does not stop it. An unreachable database once sat silent for 19 seconds. Every read races a 6s
timeout — `LOAD_TIMEOUT_MS`, now defined once in `lib/supabase.ts` because it had been copied into
two modules with the same comment. Measured at 6.3s.

---

## 6. Authentication

**Passcodes only — there is no password anywhere in Saloni**, so nothing to reset, store or leak.
Both channels take the identical path (send a code to an identifier, verify it), which is why
switching from e-mail to SMS is one flag rather than a rewrite.

```
Auth.tsx  ──dispatch──>  appReducer (authForm: the two steps)
    │
    └── requestPasscode / submitPasscode (AppContext)
              └──> lib/auth.ts ──> Supabase Auth
                                        │
        useSession.ts <──onAuthStateChange──┘
              └──> profiles row ──> account.ts ──> Profile screen
```

- **`lib/auth.ts` is the only file that talks to Supabase Auth.** Every call returns
  `AuthFailure | null` rather than throwing: a wrong passcode is an ordinary outcome of signing in,
  not an exception. Failures come back as **codes** which `Auth.tsx` translates — so errors read in
  Arabic too, unlike Supabase's own English-only strings.
- **`normalizePhone`** accepts what a Saudi customer actually types (`05x`, `5x`, `+9665x`, `009665x`)
  and returns E.164, the only form Supabase takes.
- **`useSession.ts` listens to `onAuthStateChange` rather than driving the session** — supabase-js
  restores and refreshes it from storage itself, and listening means a sign-in in another tab lands
  here too. The profile is fetched from a **separate effect on purpose**: Supabase holds an internal
  lock while an auth-change callback runs, and querying from inside one can deadlock.
- **SMS is written but unexercised.** Set `VITE_AUTH_PHONE_OTP=true` once an SMS provider is
  configured in Supabase. Phone OTP is the Saudi norm and should become the primary channel.
- **One thing is gated: confirming a booking.** Browsing, picking services and the vendor portal
  still work signed out, because RLS lets anonymous visitors read the published catalogue. But a
  booking has to belong to somebody, so "Confirm & pay" opens the sign-in sheet with
  `reason: 'booking'`, which tells the customer why they were interrupted. Nothing is written
  before they sign in.
- **`profiles.full_name` is written now**, by the "Personal details" row on the profile screen and
  by a one-off prompt after a booking is confirmed — both through the shared `components/NameSheet`.
  Giving a name stays optional; the salon sees the booking reference otherwise, because 0005 hands
  it no e-mail or phone number to fall back on. Capped at `NAME_MAX_LENGTH` (60) on the input and
  again on write.
- **`profiles.locale`** is the one genuinely per-account behaviour today: the account's language
  wins on sign-in, and a later change is written back. Its reconciliation is a **single effect in
  `AppContext.tsx` guarded by a ref**. Split into two effects it races itself and overwrites the
  stored choice — this was a real bug, found by driving it in a browser. Do not "simplify" it.

**Supabase-side setup this depends on** (full walkthrough in `supabase/README.md` §3): the Magic
Link e-mail template must be replaced with `supabase/email-templates/magic-link.html` — the stock
template contains only a link and the app asks for a six-digit code — and the app's URL must be in
the Redirect URLs allow-list. Email OTP length must stay at 6; `CODE_LENGTH` in `lib/auth.ts`
hardcodes it.

**Why that e-mail is bilingual.** Supabase sends one identical template to everybody and cannot see
`profiles.locale`, so it has no way to know which language the recipient chose in the app. Rather
than pick one, the template says everything twice — English, then Arabic in its own `dir="rtl"`
block, with the code above both since digits need no translation. Note the split this illustrates:
Postgres stores Arabic byte-exact and the app translates Supabase's English-only *errors* itself,
so the e-mail was the only place Arabic genuinely could not reach.

---

## 7. Database

16 tables — `profiles, salons, salon_media, services, staff, staff_services, working_hours,
time_off, bookings, booking_items, waitlist_entries, waitlist_offers, notifications,
notification_settings, push_subscriptions, reviews` — plus a `salon_ratings` view and the
functions in 0003–0012 —
`available_slots()`, `salon_day()`, `salon_stats()`, `salon_reviews()`, `reply_to_review()`,
`create_booking()`, `reschedule_booking()`, 0009's waitlist set, 0010's outbox set, and
0012's `claim_offer_by_token()`.
30 RLS policies. 88 assertions.

**Row policies are not the whole boundary — column privileges are the other half.** 0002 grants
`insert, update, delete on all tables to authenticated`, which is column-blind, and a policy sees
whole rows. So "you may edit your own X" means "you may edit *every field* of your own X" unless a
grant says otherwise. 0004 said so for `salons`; **0006 says so for `profiles`, `bookings` and
`reviews`**, after an audit found three live holes (see §10). When adding a table or a column, ask
which columns the policy is really meant to expose — the answer is rarely "all of them".

**Guarantees enforced by Postgres, not by app code:**
1. **No double-booking, including "any professional".** A GiST exclusion constraint on
   `(staff_id, tstzrange(starts_at, ends_at))` for active statuses settles two people tapping the
   same slot. It needs a `staff_id` to compare, which unassigned bookings never had — so
   `create_booking()` (0008) assigns a chair *before* inserting, and refuses when there is none
   left. Measured: four "any professional" requests against a two-chair salon used to write four
   bookings; they now write two. Assertion 62.
2. **Past bookings never change** — `booking_items` snapshots name, price and duration. Editing a
   service can never rewrite what a customer was charged.
3. **Tenant isolation** — a vendor can only read/write their own salon's rows. Tested both directions.
4. **Customers see only their own bookings** and cannot book in someone else's name.
5. **Reviews require a completed booking of your own.**
6. **A salon must be verified before it can be published, and cannot verify itself.** The
   constraint enforces the order; migration 0004 enforces *who* — `authenticated` has no UPDATE
   privilege on `is_verified` or `is_published`, which row-level security cannot express because a
   policy sees whole rows, not columns.
7. **A signed-in user reads and updates only their own profile** — and only the parts of it that
   are theirs. `profiles.role` is **not** writable by `authenticated` (0006). It has to be:
   `is_admin()` reads it, so a self-settable role was a one-line privilege escalation to the whole
   database. Assertion 53.
8. **A salon owner reads their own customers and nobody else's.** The 0005 functions are
   `security definer`, so RLS does not filter them — the `is_salon_owner()` guard at the top of each
   *is* the boundary, and a rival salon or a plain customer gets `42501`. They are granted to
   `authenticated` only, unlike `available_slots()`, which anon needs because browsing is ungated.
   Assertions 46 and 47.
9. **A customer's contact details never reach the salon.** The functions return
   `nullif(full_name, '')` and nothing else about the person — no e-mail, no phone.
10. **What a booking costs is the salon's to say, not the caller's.** The money columns are not
    writable by `authenticated` (0006), and since 0008 `authenticated` cannot INSERT a booking at
    all — `create_booking()` prices it from the salon's own `services` rows. So there is no moment
    at which a total is taken on trust, before or after. Assertions 56 and 65.
11. **A review cannot be rewritten by its subject.** `authenticated` has no UPDATE on `reviews` at
    all (0006) — the customer owns `rating`/`body` and the salon owns `reply`, and a grant cannot
    say "different columns for different people". Replying arrives as `reply_to_review()` (0007),
    a `security definer` function that can write `reply` and `replied_at` and nothing else.
    Assertions 55, 59 and 60.
12. **Only the salon may complete a booking.** `reviews_insert_after_visit` trusts
    `status = 'completed'` to decide who has earned a review, so a trigger (0006) limits the
    customer to cancelling. A grant restricts columns, not values. Assertion 57.
13. **A booking and its items are written together or not at all**, because they are one function
    call and therefore one transaction. A booking with no services on it is unreachable.
    Assertion 66.
14. **Opening hours bound what can be booked, not just what is offered.** `create_booking()`
    checks the same window `available_slots()` steps across, so calling the API directly cannot
    take a time the salon never offered. Assertion 67.
15. **A place in the queue is not something you can write yourself.** `waitlist_entries.created_at`
    decides who is next, so `authenticated` has no INSERT or UPDATE on the table (0009) — joining
    goes through `join_waitlist()`. Otherwise an account could insert itself at the front, or mark
    itself as holding a seat nobody offered. Assertion 75.
16. **A freed seat is offered to one person at a time.** A cancellation triggers
    `offer_next_for_slot()`, which holds it for the longest-waiting match for 15 minutes; a lapsed
    hold passes on, and nobody is offered the same slot twice. Assertions 70 and 71.
17. **A queued message belongs to the sender, not to the browser.** `authenticated` has no INSERT,
    UPDATE or DELETE on `notifications` (0010), so an account cannot queue a message to anybody,
    mark its own as sent, or rewrite a queued payload so the link points elsewhere. It reads its
    own and nothing more. Assertion 83.
18. **Nobody is messaged who did not ask, and nobody twice.** Queueing honours `allow_whatsapp`,
    skips a profile with no phone number, refuses a slot already in the past, caps how often one
    person is pinged, and a unique index on `(offer_id, channel)` makes the three code paths that
    reach an offer unable to double-send. Assertions 78–81.
19. **An internal function is not reachable from the browser.** Supabase grants EXECUTE on every
    new function to `anon` and `authenticated` by default, so `revoke ... from public` revokes
    nothing — see the audit note in §10. 0010 names the roles explicitly, and **assertion 84 fails
    if a function added later forgets to.**

**Conventions:**
- Money is **integer halalas** (`15000` = 150.00 SAR). **Never floats.**
- VAT rate is stored **per booking** (`vat_rate`, default 0.150) so rate changes don't rewrite history.
- Bilingual content is paired `*_en` / `*_ar` columns.
- Services and staff are **archived, not deleted** (bookings reference them).
- IDs use `gen_random_uuid()`. `btree_gist` is the **only** required extension — `uuid-ossp` was
  deliberately removed because Supabase installs it where the column default may not resolve.

**The "any professional" gap is closed.** It ran from 0001 to 0008: with `staff_id` null the
exclusion constraint had nobody to compare against, so a salon could be oversold.
`available_slots()` (0003) capacity-checks at **offer** time, which narrowed the window without
shutting it; `create_booking()` (0008) assigns a chair at **write** time, which does.
`available_slots()` still subtracts unassigned bookings when counting capacity — that only applies
to rows made before 0008 now, and stays correct.

**Testing:** `./scripts/test-db.sh` is the whole command — **there is no Postgres to start by
hand any more.** It was a real trip-hazard: Postgres does not run by default here and a fresh
container has no cluster at all, so the script now calls `scripts/pg-start.sh`, which runs `initdb`
if `/var/tmp/saloni-pg` is missing and starts the server if it is down. Both are silent no-ops once
done, and `scripts/pg-stop.sh` reverses it. Setting `PGHOST`/`PGPORT`/`PGUSER` points the tests at
a Postgres of your own and leaves the starting to you. The server listens on a Unix socket only,
never on a network port.

It then creates a throwaway database, applies the migrations, runs all
88 assertions, drops it. Each of 53–88 was checked against a database with its own protection
removed, and each fails there — a security assertion that cannot fail is worse than none. `tests/00_local_shim.sql` recreates the `auth` schema, `auth.uid()` and the
`anon`/`authenticated` roles so policies are exercised exactly as in production. **That shim is
never applied to Supabase.** After changing anything in `migrations/`, re-run `scripts/build-setup-sql.sh`.

---

## 8. Environment and secrets

`.env` is **committed on purpose**:

```
VITE_SUPABASE_URL=https://nicdmspejrvruszlwhvm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
VITE_AUTH_PHONE_OTP=false
```

Vite inlines these into the browser bundle at build time, so the key is public no matter where it
is stored. It is public **by design**; RLS is the actual security boundary. This also means the
GitHub Pages build needs no secrets configuration.

**The secret key (`sb_secret_…` / `service_role`) bypasses every policy. It must never be in this
repo, in the app, or in a chat.** Supabase renamed its keys: `sb_publishable_` = old `anon`,
`sb_secret_` = old `service_role`.

---

## 9. What is real and what is simulated

| Area | State |
| --- | --- |
| Salons, services, staff, prices | **Live from Supabase** |
| Salon ratings | Live (view); empty ⇒ shows "New" |
| **Sign-in** | **Real.** Passcode to e-mail (SMS when enabled). Session survives reloads. |
| **Who you are** | **Real.** Profile screen shows the account, its role, and sign-out. |
| **Language preference** | **Real.** Stored on `profiles.locale`; follows the account, not the browser. |
| **Bookings** | **Real.** Created, moved and cancelled against the database, prices snapshotted. Survive a refresh. Signing in is required to book. |
| **Waitlist** | **Real.** Joining is stored, a cancellation offers the freed seat to whoever waited longest, and claiming makes a real booking. **Still not timely** — every offer now queues a WhatsApp message (0010), but nothing sends one, so an offer is still only seen when the app is next opened. |
| **Notifications** | **Deployed and running; no push delivered yet.** Push, not WhatsApp. The app is installable and registers the browser, every offer queues a message, and the worker is live and scheduled every minute. It runs green — but with no device registered it has only ever claimed an empty queue, so delivery itself is unproven. See §10. |
| **The claim link** | **Real.** `?claim=<token>` in the push claims that exact seat, checked for ownership so a forwarded link is worthless. |
| **Salon registration** | **Real.** A salon owner signs up in the app; the row is theirs, created unverified and unpublished. Default opening hours come with it. |
| **Business profile** | **Real.** The same screen becomes an editor afterwards, and shows whether the salon is awaiting review, verified, or live. Approval itself is not the owner's to make. |
| **Vendor opening hours + booking interval** | **Real.** An owner edits `working_hours` and `salons.slot_step_minutes`; the booking screen obeys them immediately. |
| **Vendor services and team** | **Real for an owner.** Add, edit, hide and remove, written to `services` and `staff`. Removing archives — bookings reference what they were made at. |
| **Vendor dashboard figures** | **Real.** Today's bookings, the value booked, occupancy and the rating, from `salon_stats()`. "Booked today" is **not revenue** — nothing is paid. |
| **Vendor day calendar** | **Real, and the owner can act on it.** Appointments for any day in the coming week from `salon_day()`, cancellations included. Tapping one offers confirm, start, complete, no-show, cancel and reassign. |
| **Vendor reviews** | **Real.** From `salon_reviews()`, unpublished rows included and marked. **Replying is real too**, through `reply_to_review()`. |
| **Vendor waitlist** | **Real.** The owner's own queue, with re-offering and extending a hold. **No `SampleDataNotice` remains anywhere in the portal.** |
| **Customer's name** | **Real.** Written to `profiles.full_name` from the profile screen or the prompt after booking. Optional — the salon sees the reference otherwise. |
| Payment | Simulated. **No card details are ever requested or collected.** |
| Salon chat + Saloni Assistant | Scripted locally (`state/replies.ts`). Nothing is sent anywhere. |
| Photos | CSS placeholder tiles. |
| **Availability** | **Real.** Times come from `working_hours`, the chosen services' length and the bookings already made, via `available_slots()`. Taken times are shown greyed rather than hidden. Falls back to the sample grid with no backend. |

---

## 10. Pending issues and known gaps

**Three `TODO(roadmap …)` markers in the code**, each cross-referenced to `ROADMAP.md`:

| File | Item | Gap |
| --- | --- | --- |
| `screens/vendor/Gallery.tsx` | A2 | The Upload button has **no handler at all** |

The two waitlist markers are gone: 0009 made it real. What is still missing there is the
*notification*, not the mechanism — see below.

**Authentication gaps:**
- **Never tested against real Supabase.** The development sandbox cannot reach `supabase.co`, so
  the flow was driven against stubbed HTTP endpoints. Only the unreachable-backend path was
  exercised for real. Live behaviour still needs confirming in a browser.
- **Phone OTP has never sent anything** — no SMS provider has been configured.
- **`profiles.full_name` is written now**, but only ever by the account itself, and only a name —
  there is still no wider "edit your details" screen, and `profiles.phone` is never set.
- **`role` is still not what gates anything.** Ownership does: the portal shows real data only for
  the salon whose `owner_id` matches the signed-in user, and the policies reject writes from anyone
  else (assertions 32 and 34). `profiles.role` remains decorative — a vendor with no salon row sees
  the sample portal, same as a customer.
- The profile screen's invented rows ("Saved salons 6", "3 cards") are **gone**. "Notifications ·
  On" remains and is still decorative — no notification is ever sent.

**Booking lifecycle.** Create, move and cancel all go through `data/bookings.ts`.
**Rescheduling is an UPDATE, not a new row** — the customer keeps their reference, the price
snapshot is untouched, and the salon sees one appointment that moved. It also skips checkout
entirely, because the appointment was already paid for (or not) once. Cancelling sets
`status = 'cancelled'` and keeps the row: it is history the salon needs, and the exclusion
constraint ignores cancelled rows, so the slot frees immediately.

**Booking gaps:**
- ~~The two inserts are not one transaction.~~ **Fixed in 0008**: `create_booking()` is one call
  and therefore one transaction, so the compensating delete is gone along with the orphan it could
  leave.
- **Times are real now.** `available_slots()` computes them from `working_hours`, the services'
  length and existing bookings, for new bookings and reschedules alike. The database is still the
  final authority: a slot can be taken between being offered and being confirmed, and the app still
  says "That time was just taken" — but it is now a genuine race, not the everyday case.
- ~~"Any professional" is outside the no-double-booking constraint at write time.~~ **Fixed in
  0008**: a chair is assigned before the insert, so the constraint applies. See §7.
- **Nothing is paid.** `payment_method` is recorded but `paid_at` stays null, because no money
  moves. Do not treat a booking as paid.

**Security posture, and the audit that produced 0006.** Three live holes were found by attacking a
throwaway database rather than by reading the policies, and all three shared one cause: 0002's
column-blind grant (§7). They are closed, and each has an assertion that fails if the protection is
removed. Worth knowing they existed, because the same mistake is easy to repeat:
- A customer could `update profiles set role = 'admin'` on their own row and then read every
  profile, every booking at every salon, and every unpublished salon.
- A salon could rewrite the reviews written about it — a 1.0 became a 5.0, still in the customer's
  name — and `salon_ratings` averaged the result.
- Either side of a booking could rewrite its price, or mark it paid.

**That audit is now fully closed.** The last item — `createBooking` stating the price from the
browser — went with 0008: `authenticated` has no INSERT on `bookings`, and `create_booking()`
prices from the salon's own rows.

**A second finding, from 0010, of exactly the same shape.** Every migration since 0003 ends its
functions with `revoke all on function … from public`. That line has never revoked anything.
Supabase — and `tests/00_local_shim.sql`, which mirrors it — sets default privileges granting
EXECUTE on every new function to `anon`, `authenticated` and `service_role` *by name*, and revoking
from PUBLIC leaves named grants untouched. Checked rather than assumed: before 0010, all thirty
`security definer` functions were executable by an anonymous visitor. Most did not matter, because
the guard is inside the body — `salon_day()` checks `is_salon_owner()` and does not care who calls
it. Two did:
- `waitlist_matches()` has no guard, so any visitor could list the customer ids waiting at any salon.
- `offer_next_for_slot()` has no guard, so any account could force offers and spend other people's
  one turn at a slot.

Both are closed, along with the sender functions 0010 adds — `claim_pending_notifications()` would
have been the worst of them, returning the phone number and name of everybody with a message
queued. **The durable fix is assertion 84**, which enumerates every `security definer` function
against an allow-list and fails if a new one is reachable. The same mistake cannot ship twice.

**The waitlist is real, and now half-notified.** The queue, the 15-minute holds, passing a lapsed
hold to the next person, opening the slot to everyone once they have all had a turn, and claiming —
all genuine, all in the database. 0010 added the missing half and stopped short of finishing it,
deliberately:

- **What is built.** Every offer queues a message in the `notifications` outbox — the customer's
  own language, the salon and services in both, a single-use claim link built from the
  `claim_token` 0009 has been generating all along, opt-outs honoured, a cap on how often one
  person is pinged, and quiet hours that stretch the hold rather than wake anybody. The app is
  installable, registers the browser as a device, and asks permission at the one moment it makes
  sense. The worker composes the words and pushes them. Assertions 77–86, 32 browser checks,
  17 on the message text.
- **The channel is push, not WhatsApp** (0011). Push is free, instant, needs nobody's approval and
  opens the app it came from. WhatsApp is switched off rather than deleted —
  `notification_settings.channels` decides, `docs/whatsapp-waitlist-template.md` is parked with
  what turning it back on would take, and assertion 86 keeps that path honest.
- **Live, but delivery is still unconfirmed.** The VAPID pair is set, the worker is deployed
  to Supabase and scheduled by pg_cron every minute, and it runs green. That proves the
  claim-and-return path only: **no push has yet been delivered to a real device**, because
  nobody has registered one. Sending, marking sent, and retiring a dead endpoint have still
  never executed against a push service. The first real delivery is the outstanding
  evidence — see §11.
- **iPhone needs installing first.** Safari only exposes push to a page added to the home screen,
  so an iPhone in an ordinary tab is told exactly that, in both languages. There is no way round
  it before the Capacitor wrap.
- **The claim link works** (0012). The push carries `?claim=<token>`; the app reads it on
  load, claims that seat through `claim_offer_by_token()`, and lands on Bookings. The
  token names the offer and authorises nothing by itself — ownership is still checked — so
  a forwarded link claims nothing. It is stripped from the address bar immediately, or
  tomorrow's refresh would re-claim a seat and report an error about something that
  worked. Assertions 87 and 88, 16 browser checks.
- **Nobody is queued for who has not installed it.** A push row is only written when the customer
  has a registered device, exactly as a WhatsApp row needed a phone number. So the outbox stays
  empty until people start adding Saloni to their home screens — which is a real adoption question,
  not a bug, and the reason the native wrap still matters.

Two older consequences still hold:
- **Nothing advances on a timer.** There is no job runner, so a lapsed hold is swept whenever
  somebody next reads the waitlist — both read functions sweep before they answer.
- **The salon can push it along.** "Notify" re-offers a lapsed slot to whoever is next, and
  "Give longer" extends a hold — but only when nobody is queued behind, since holding a seat for
  one person while others wait costs them their turn for nothing.

**Structural gaps:**
- **Verification is a manual step.** A registered salon stays invisible to customers until someone
  ticks `is_verified` then `is_published` in the Supabase dashboard. Fine at this volume, and the
  constraint stops the order being skipped, but there is no admin screen and no notification telling
  the owner they went live.
- **One salon per owner.** `createSalon` refuses a second, because every portal screen assumes one
  and a second would silently never be shown. The schema permits more.
- **The vendor portal is now entirely per-owner.** Registration, hours, interval, services, team,
  the dashboard figures, the day calendar, reviews and the waitlist are all the owner's own, and
  **no `SampleDataNotice` remains** — a visitor who owns no salon still sees the bundled demo, with
  the whole-portal notice explaining why.
- **The "+ Add" pill on the calendar is still inert.** A walk-in booking needs a customer account
  to belong to, which is a different problem from acting on one that exists.
- **The dashboard's today list is read-only** and links to the calendar instead. One place to act
  on an appointment is clearer than two.
- **Occupancy is still capped at 100%**, though the cap should now be unreachable: every booking
  made since 0008 holds a chair, so a day cannot be oversold. Rows created before it can still
  exceed the hours, which is the case the cap now covers.
- **The dashboard is today only.** No week, no month, no trend beyond yesterday's count.
- No storage bucket exists for photo upload.
- Open signup: anyone visiting the public demo can create an account. Accepted for now — a
  signed-in visitor sees exactly what a guest sees.

---

## 11. Suggested next steps

1. **Get one real notification delivered.** Everything is switched on and the worker runs
   green, but with no registered device it has only ever found an empty queue. On a phone:
   open the live site, add it to the home screen (required on iPhone), join a waitlist so
   the browser registers and permission is granted, then cancel a booking for that slot from
   the vendor side. That single delivery is the only thing that can confirm sending, marking
   sent, and retiring a dead endpoint — the last untested code in the feature.
   **This is the recommended next task, and it is testing rather than building.**
3. Photo upload with EXIF stripping (A2).
4. **Payments** — deliberately deferred until closer to launch; see `ROADMAP.md` Part B, Phase 2.
   Nothing is paid today: `payment_method` is recorded but `paid_at` stays null. **Start the
   commercial registration and payment-gateway paperwork early** — it runs for weeks in the
   background and is the thing most likely to delay launch.
5. Compliance and the Capacitor wrap — `ROADMAP.md` Part B, Phases 4–5. Native push registers
   in the same table through the same function, so only the worker's last hop changes.

---

## 12. Working conventions

- **Verify, don't assume.** DB changes are proven with `./scripts/test-db.sh` (88 assertions);
  UI changes with `scripts/browser-tests/` (145 checks, both languages), and the words a
  notification carries with `node --experimental-strip-types scripts/test-notification-text.mjs`
  (17 checks, both languages). Do not report something as
  working because the code looks right.
- **A security assertion that cannot fail is worse than none.** Every assertion from 53 onward was
  run against a database with its own protection removed, and each fails there. Do the same for
  any new one — it takes a minute and it is the difference between a test and a decoration.
- **The two suites prove different halves.** The browser checks stub Supabase, so they can say
  nothing about whether a grant or policy would really allow something; the database assertions are
  the evidence for that. Neither substitutes for the other.
- **Say what you could not verify.** Every claim in this document that could not be tested is
  marked as such. Keep it that way.
- **Commit messages explain *why*,** and state known gaps honestly.
- **Every push to the default branch redeploys the live site** — check the Actions run goes green.
  Work on a feature branch; merging to `claude/saloni-prototype-dev-idl8tr` is what publishes.
- **A new Postgres function is public until you say otherwise, and saying otherwise means
  naming `anon` and `authenticated`.** `revoke ... from public` does nothing on Supabase (§10). If
  a function is internal or for the sender only, `revoke execute ... from anon, authenticated` and
  grant it back to whoever genuinely needs it. Assertion 84 enforces this, so forgetting fails the
  suite rather than shipping.
- **Code style:** no `dangerouslySetInnerHTML`, no `eval`; user input is length-capped and rendered
  as text; real `<button>` elements with focus styles; `lang`/`dir` kept in sync.
- **The user is not a developer.** Explain changes in plain language, and when something needs
  doing in an external dashboard, give click-by-click steps rather than assuming familiarity.

### Sandbox quirk worth knowing

The Claude Code environment's egress proxy **blocks `supabase.co` and `github.io`**, so an agent
working on this repo **cannot** query the live database or load the deployed site. Work around it
by running Postgres locally with the same schema (`./scripts/test-db.sh`, which starts and if
necessary creates that Postgres itself) and by testing the app's fallback path. Playwright is not a dependency — install it ad hoc (`npm install --no-save
playwright`, browser at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). For anything needing
a *working* backend, `page.route()` the Supabase endpoints (`**/auth/v1/otp*`, `**/auth/v1/verify*`,
`**/rest/v1/profiles*`) and answer them yourself. **Live behaviour has to be confirmed by the user
in their own browser.**
