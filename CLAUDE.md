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

Fully bilingual English / Arabic with real right-to-left layout, not a translation layer bolted on.
It began as a Claude Design prototype (`Saloni Prototype.dc.html`, **not in the repo**) and was
built out as a real app. The implementation is the source of truth now.

**Target platform:** native apps on the App Store and Google Play, reached by wrapping this same
codebase with **Capacitor** — no rewrite. The web build is the development and testing surface.

**Scale:** 56 TypeScript files, ~9,150 lines. ~960 lines of schema SQL, ~2,230 including tests and seed.

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
deploy) · `npm run lint` · `./scripts/test-db.sh`

The hosted Postgres version is whatever Supabase provisioned for the project — check the
dashboard rather than assuming. The local test harness runs against Postgres 16.

---

## 3. Repository layout

```
.env                          Supabase URL + publishable key (committed on purpose — see §7)
.github/workflows/deploy.yml  builds and deploys to GitHub Pages on push to the default branch
index.html                    fonts, favicon, meta
scripts/
  test-db.sh                  applies migrations to a throwaway Postgres, runs assertions
  build-setup-sql.sh          concatenates migrations into supabase/setup.sql
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
  components/                 PhoneFrame, Screen, TabBar, SheetModal, Conversation, Toast,
                              LangToggle, icons
  screens/Auth.tsx            sign-in sheet; floats over any screen in either mode
  screens/customer/           12 screens
  screens/vendor/             9 screens
  hooks/useDragScroll.ts      mouse-drag for horizontal rails
supabase/
  migrations/0001_schema.sql              14 tables, constraints, rating view
  migrations/0002_row_level_security.sql  30 policies + grants
  migrations/0003_availability.sql        available_slots() + salons.slot_step_minutes
  setup.sql                   GENERATED — the two migrations concatenated, for one-paste setup
  seed.sql                    4 demo salons, 11 services, 6 staff, opening hours (verified counts)
  email-templates/magic-link.html  the sign-in e-mail; bilingual, carries {{ .Token }}
  tests/00_local_shim.sql     recreates Supabase's auth schema/roles for local testing
  tests/01_policy_tests.sql   30 assertions
  README.md                   Supabase setup walkthrough, written for a non-developer
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

**Remote state is the exception to the one-reducer rule.** The catalogue and the session are
async and owned by Supabase, so they live in `useState`/`useSession` inside `AppContext` rather
than the reducer. Only *UI* state for those features (the sign-in form's two steps, for instance)
goes in the reducer. Follow this split for anything new that talks to the backend.

**i18n.** `en.ts` is the source of truth; `ar.ts` is typed as `Dictionary`, so a missing key fails
the build. Direction flips via `dir` on the phone frame and on `<html>`. Helpers in `i18n/index.ts`
handle money (`SAR 150` / `150 ر.س`), tag and category translation, and unit localisation inside
seeded strings.

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

**Watch out:** `supabase-js` retries a failed request **four times internally**, and `.abortSignal()`
does not stop it. An unreachable database once sat silent for 19 seconds. `loadCatalog` now races
the fetch against a 6s timeout (`LOAD_TIMEOUT_MS`), measured at 6.3s.

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

14 tables — `profiles, salons, salon_media, services, staff, staff_services, working_hours,
time_off, bookings, booking_items, waitlist_entries, waitlist_offers, notifications, reviews` —
plus a `salon_ratings` view, and the `available_slots()` function. 30 RLS policies. 30 assertions.

**Guarantees enforced by Postgres, not by app code:**
1. **No double-booking** — a GiST exclusion constraint on `(staff_id, tstzrange(starts_at, ends_at))`
   for active statuses. Two people tapping the same slot simultaneously is a race the UI cannot win.
2. **Past bookings never change** — `booking_items` snapshots name, price and duration. Editing a
   service can never rewrite what a customer was charged.
3. **Tenant isolation** — a vendor can only read/write their own salon's rows. Tested both directions.
4. **Customers see only their own bookings** and cannot book in someone else's name.
5. **Reviews require a completed booking of your own.**
6. **A salon must be verified before it can be published.**
7. **A signed-in user reads and updates only their own profile.**

**Conventions:**
- Money is **integer halalas** (`15000` = 150.00 SAR). **Never floats.**
- VAT rate is stored **per booking** (`vat_rate`, default 0.150) so rate changes don't rewrite history.
- Bilingual content is paired `*_en` / `*_ar` columns.
- Services and staff are **archived, not deleted** (bookings reference them).
- IDs use `gen_random_uuid()`. `btree_gist` is the **only** required extension — `uuid-ossp` was
  deliberately removed because Supabase installs it where the column default may not resolve.

**Known schema gap, now partly closed:** the double-booking constraint still **cannot cover
`staff_id IS NULL`** ("any professional") — there is nobody to compare against. `available_slots()`
(0003) performs the separate capacity check the constraint's own comment asks for: it counts
eligible staff who are free and subtracts the bookings that are themselves unassigned, so a full
salon stops offering the time *and* stops offering the last person by name. That is enforcement at
**offer** time, not at write time — two people racing the same last chair through "any
professional" can still both be accepted. Assignment at booking time remains the real fix.

**Testing:** `./scripts/test-db.sh` creates a throwaway database, applies the migrations, runs all
30 assertions, drops it. `tests/00_local_shim.sql` recreates the `auth` schema, `auth.uid()` and the
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
| Waitlist | Browser-only; seat release is a 3.2s `setTimeout`. |
| Vendor edits (add service/staff, live-hidden toggle) | Browser-only. |
| Payment | Simulated. **No card details are ever requested or collected.** |
| Salon chat + Saloni Assistant | Scripted locally (`state/replies.ts`). Nothing is sent anywhere. |
| Photos | CSS placeholder tiles. |
| **Availability** | **Real.** Times come from `working_hours`, the chosen services' length and the bookings already made, via `available_slots()`. Taken times are shown greyed rather than hidden. Falls back to the sample grid with no backend. |

---

## 10. Pending issues and known gaps

**Five `TODO(roadmap …)` markers in the code**, each cross-referenced to `ROADMAP.md`:

| File | Item | Gap |
| --- | --- | --- |
| `screens/vendor/Services.tsx` | A1 | Services can be added but **not edited or deleted** |
| `screens/vendor/Staff.tsx` | A1 | The "Edit" label is a `<div>`, **not a control** |
| `screens/vendor/Gallery.tsx` | A2 | The Upload button has **no handler at all** |
| `screens/vendor/Waitlist.tsx` | A3 | "Notify" only toasts the owner's own screen |
| `state/AppContext.tsx` | A3 | The waitlist seat release is a simulated timer |

**Authentication gaps:**
- **Never tested against real Supabase.** The development sandbox cannot reach `supabase.co`, so
  the flow was driven against stubbed HTTP endpoints. Only the unreachable-backend path was
  exercised for real. Live behaviour still needs confirming in a browser.
- **Phone OTP has never sent anything** — no SMS provider has been configured.
- **`profiles.full_name` is never set by the app.** New accounts sign in with a blank name and the
  profile screen falls back to the e-mail or number. There is no "edit your details" screen.
- **`role` is displayed but never enforced.** Nothing checks it before opening the vendor portal.
- The profile screen's other rows ("Saved salons 6", "3 cards") are **still fiction**.

**Booking lifecycle.** Create, move and cancel all go through `data/bookings.ts`.
**Rescheduling is an UPDATE, not a new row** — the customer keeps their reference, the price
snapshot is untouched, and the salon sees one appointment that moved. It also skips checkout
entirely, because the appointment was already paid for (or not) once. Cancelling sets
`status = 'cancelled'` and keeps the row: it is history the salon needs, and the exclusion
constraint ignores cancelled rows, so the slot frees immediately.

**Booking gaps:**
- **The two inserts are not one transaction.** supabase-js speaks REST, which cannot open one, so
  `createBooking` writes the booking, then its items, and deletes the booking again if the items
  fail. The compensating delete can itself fail. A Postgres function taking both in one call is the
  real fix.
- **Times are real now.** `available_slots()` computes them from `working_hours`, the services'
  length and existing bookings, for new bookings and reschedules alike. The database is still the
  final authority: a slot can be taken between being offered and being confirmed, and the app still
  says "That time was just taken" — but it is now a genuine race, not the everyday case.
- **"Any professional" is still outside the no-double-booking constraint** at write time, though
  it is now capacity-checked when times are offered. See §7.
- **Nothing is paid.** `payment_method` is recorded but `paid_at` stays null, because no money
  moves. Do not treat a booking as paid.

**Structural gaps:**
- The waitlist and vendor edits do not survive a refresh.
- "Any professional" bookings are outside the no-double-booking constraint at write time.
- **Owners cannot yet edit their hours or `slot_step_minutes` in the app.** Both are real,
  per-salon database columns the booking screen already obeys, but the vendor portal still reads
  demo data and does not know which salon the signed-in user owns, so there is nothing to hang the
  control on. It belongs with per-owner vendor data.
- No storage bucket exists for photo upload.
- Open signup: anyone visiting the public demo can create an account. Accepted for now — a
  signed-in visitor sees exactly what a guest sees.

---

## 11. Suggested next steps

1. **Per-owner vendor data, gated on `role`** — the portal shows the same demo dashboard to
   everyone, signed in or not. **This is the recommended next task**, and it now unblocks two
   things at once: the owner-facing controls for opening hours and `slot_step_minutes` have real
   columns behind them already and only need a screen that knows which salon the user owns.
2. **Assign staff at booking time for "any professional"**, so the no-double-booking constraint
   covers it at write time rather than only at offer time (§7).
3. Vendor CRUD (A1), photo upload with EXIF stripping (A2), waitlist notifications (A3).
4. **Payments** — deliberately deferred until closer to launch; see `ROADMAP.md` Part B, Phase 2.
   Nothing is paid today: `payment_method` is recorded but `paid_at` stays null. **Start the
   commercial registration and payment-gateway paperwork early** — it runs for weeks in the
   background and is the thing most likely to delay launch.
5. Compliance and the Capacitor wrap — `ROADMAP.md` Part B, Phases 4–5.

---

## 12. Working conventions

- **Verify, don't assume.** DB changes are proven with `./scripts/test-db.sh`. UI changes are
  driven in real Chromium via Playwright before being called done. Do not report something as
  working because the code looks right.
- **Say what you could not verify.** Every claim in this document that could not be tested is
  marked as such. Keep it that way.
- **Commit messages explain *why*,** and state known gaps honestly.
- **Every push to the default branch redeploys the live site** — check the Actions run goes green.
  Work on a feature branch; merging to `claude/saloni-prototype-dev-idl8tr` is what publishes.
- **Code style:** no `dangerouslySetInnerHTML`, no `eval`; user input is length-capped and rendered
  as text; real `<button>` elements with focus styles; `lang`/`dir` kept in sync.
- **The user is not a developer.** Explain changes in plain language, and when something needs
  doing in an external dashboard, give click-by-click steps rather than assuming familiarity.

### Sandbox quirk worth knowing

The Claude Code environment's egress proxy **blocks `supabase.co` and `github.io`**, so an agent
working on this repo **cannot** query the live database or load the deployed site. Work around it
by running Postgres locally with the same schema (`scripts/test-db.sh`) and by testing the app's
fallback path. Playwright is not a dependency — install it ad hoc (`npm install --no-save
playwright`, browser at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). For anything needing
a *working* backend, `page.route()` the Supabase endpoints (`**/auth/v1/otp*`, `**/auth/v1/verify*`,
`**/rest/v1/profiles*`) and answer them yourself. **Live behaviour has to be confirmed by the user
in their own browser.**
