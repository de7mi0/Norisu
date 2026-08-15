# Saloni — project handoff

Everything a new contributor (or a new AI session) needs to pick this up. Current as of
commit `112702d`.

---

## 1. What this is

**Saloni (صالوني)** — a bilingual (English / Arabic, full RTL) salon booking platform for
Saudi Arabia. Two apps in one shell:

- **Customer app** — find a salon, pick services, choose a specialist and a time, pay, manage bookings.
- **Vendor portal** — the salon owner's side: dashboard, calendar, services, staff, gallery, reviews, waitlist.

It began as a Claude Design prototype (`Saloni Prototype.dc.html`) and was implemented as
a real app. The design file is **not** in the repo; the implementation is the source of truth now.

**Live:** https://de7mi0.github.io/Norisu/ — redeploys automatically on every push.
**Repo:** `de7mi0/Norisu` — **default branch `claude/saloni-prototype-dev-idl8tr`** (not `main`; `main` does not exist).
**Also in scope but untouched:** `de7mi0/norisu-ai` (empty, reserved for a future assistant service).

---

## 2. Tech stack

| Layer | Choice | Version |
| --- | --- | --- |
| UI | React | 19.2 |
| Language | TypeScript | 6.0 |
| Build | Vite | 8.2 |
| Lint | oxlint | 1.75 |
| Backend | Supabase (Postgres 15 + Auth + RLS) | client `@supabase/supabase-js` 2.112 |
| Hosting | GitHub Pages via GitHub Actions | — |

No CSS framework, no state library, no router — deliberately. Styling is inline styles plus
a small `global.css`; navigation is a `switch` on a screen name in state.

**Target platform decision:** native apps on the **App Store and Google Play**, to be reached
by wrapping this same codebase with **Capacitor** (no rewrite). The web build is the
development and testing surface.

---

## 3. Repository layout

```
.env                        Supabase URL + publishable key (committed on purpose, see §7)
.github/workflows/deploy.yml  build + deploy to GitHub Pages on push
index.html                  fonts, favicon, meta
scripts/
  test-db.sh                applies migrations to a throwaway Postgres, runs assertions
  build-setup-sql.sh        concatenates migrations into supabase/setup.sql
src/
  App.tsx                   screen router, tab bars, floating overlays
  main.tsx                  entry
  theme.ts                  colour / type / placeholder-tile tokens
  types.ts                  domain models
  styles/global.css         reset, fonts, keyframes, phone-frame CSS, .ltr-run
  lib/
    supabase.ts             client; `isSupabaseConfigured` false ⇒ demo mode
    database.types.ts       row types for the tables the app reads
  data/
    repository.ts           ★ loads the catalogue from Supabase, maps rows → app types
    salons/services/staff/reviews/payments/vendor.ts   bundled demo data (fallback)
  i18n/
    en.ts / ar.ts           dictionaries (identical keys, enforced by `Dictionary` type)
    index.ts                money/tags/category/units formatting helpers
  state/
    appReducer.ts           ★ all app state + actions (one reducer)
    AppContext.tsx          provider: timers, catalogue loading, derived values
    context.ts              context object + `useApp()` hook + `dateAtOffset`
    replies.ts              scripted chat/assistant content, delays, input caps
  components/               PhoneFrame, Screen, TabBar, SheetModal, Conversation, Toast, LangToggle, icons
  screens/customer/         12 screens
  screens/vendor/           9 screens
  hooks/useDragScroll.ts    mouse-drag for horizontal rails
supabase/
  migrations/0001_schema.sql            tables, constraints, rating view
  migrations/0002_row_level_security.sql  30 policies + grants
  setup.sql                 GENERATED — the two migrations concatenated, for one-paste setup
  seed.sql                  4 demo salons, 11 services, 6 staff, opening hours
  tests/00_local_shim.sql   recreates Supabase's auth schema/roles for local testing
  tests/01_policy_tests.sql 15 assertions
  README.md                 Supabase setup walkthrough
ROADMAP.md                  backlog + path to the app stores
```

**50 TypeScript files, ~6,800 lines. ~740 lines of SQL.**

---

## 4. Front-end architecture

**One reducer, one context.** All state lives in `src/state/appReducer.ts` as a single
`AppState` with a discriminated-union `Action` type and an `assertNever` exhaustiveness
guard. `AppContext.tsx` wraps it and adds derived values (totals, the active salon, staff
name, date/slot summaries) and side-effecting actions. Screens call `useApp()`, read what
they need, and dispatch. **No screen owns cross-screen state.**

**Navigation** is `state.screen` plus `state.mode` (`'customer' | 'vendor' | null`). `App.tsx`
maps screen names to components via two lookup records. Back behaviour is a `BACK_MAP` in the
reducer with special cases for reschedule and for chat/assistant (which remember where they
were opened from).

**i18n.** `en.ts` is the source of truth; `ar.ts` is typed as `Dictionary` so a missing key
fails the build. Direction flips via `dir` on the phone frame and on `<html>`. Helpers in
`i18n/index.ts` handle money (`SAR 150` / `150 ر.س`), tag/category translation, and unit
localisation inside seeded strings.

**Bidi gotcha (already fixed, don't regress):** Latin-and-digit runs like `-20%` and `0.8 km`
reorder inside Arabic text. They are wrapped in `.ltr-run` (`direction: ltr; unicode-bidi:
isolate`). Any new mixed-script string needs the same.

**Presentation.** A phone frame on desktop; full-screen below 430px. All in `global.css`
(`.stage`, `.bezel`, `.viewport`, `.notch`).

**Timers.** Every simulated delay (toast, chat reply, waitlist) is tracked in a ref `Set` and
cleared on unmount.

---

## 5. Data flow — the important part

```
Supabase ──> repository.loadCatalog() ──> AppContext state ──> useApp() ──> screens
                     │
                     └── on failure/timeout/empty ──> demoCatalog() from src/data/*
```

`loadCatalog()` fetches salons, services, staff and `salon_ratings` in parallel, then maps
rows to the app's existing types so **screens never see database shapes**. Conversions:
`price_halalas / 100 → price`, `duration_minutes → "45 min"`, placeholder tiles assigned by
index, and an `"any professional"` option appended to every salon's staff list (it is a UI
affordance, not a row).

`catalogSource` is `'demo' | 'loading' | 'live' | 'error'`. Anything other than `live` shows a
small notice on the home screen and keeps the app fully usable on sample data.

**Two known behaviours, deliberately handled rather than faked:**
- A salon with no reviews shows **"New"**, not a score. `Salon.rating` is `number | null`.
- **Distance is empty** — the app does not ask for location yet, so it is omitted rather than invented.
- Salon-level discount badge and "from" price are **derived** from that salon's live services.

**Watch out:** `supabase-js` retries a failed request **four times internally**, and
`.abortSignal()` does not stop it. An unreachable database sat silent for 19s. `loadCatalog`
now races the fetch against a 6s timeout (`LOAD_TIMEOUT_MS`). Measured at 6.3s.

---

## 6. Database

14 tables: `profiles, salons, salon_media, services, staff, staff_services, working_hours,
time_off, bookings, booking_items, waitlist_entries, waitlist_offers, notifications, reviews`
plus a `salon_ratings` view. 30 RLS policies. 15 assertions.

**Guarantees enforced by Postgres, not by app code:**
1. **No double-booking** — a GiST exclusion constraint on `(staff_id, tstzrange(starts_at, ends_at))`
   for active statuses. Two people tapping the same slot simultaneously is a race the UI cannot win.
2. **Past bookings never change** — `booking_items` snapshots name, price and duration. Editing a
   service can never rewrite what a customer was charged.
3. **Tenant isolation** — a vendor can only read/write their own salon's rows. Tested in both directions.
4. **Customers see only their own bookings** and cannot book in someone else's name.
5. **Reviews require a completed booking of your own.**
6. **A salon must be verified before it can be published.**

**Conventions:**
- Money is **integer halalas** (`15000` = 150.00 SAR). Never floats.
- VAT rate is stored **per booking** (`vat_rate`, default 0.150) so rate changes don't rewrite history.
- Bilingual content is paired `*_en` / `*_ar` columns.
- Services and staff are **archived, not deleted** (bookings reference them).
- IDs use `gen_random_uuid()` (core Postgres). `btree_gist` is the **only** extension required —
  `uuid-ossp` was deliberately removed because Supabase installs it in a schema where the
  column default may not resolve.

**Known gap:** the double-booking constraint **cannot cover `staff_id IS NULL`** ("any
professional") — there is nobody to compare against. Needs either assignment at booking time
or a separate capacity check. Recorded on the constraint itself.

**Testing:** `./scripts/test-db.sh` creates a throwaway database, applies the migrations, runs
all 15 assertions, drops it. `tests/00_local_shim.sql` recreates the `auth` schema, `auth.uid()`
and the `anon`/`authenticated` roles so policies are exercised exactly as in production. That
shim is **never** applied to Supabase.

---

## 7. Environment and secrets

`.env` is **committed on purpose**:

```
VITE_SUPABASE_URL=https://nicdmspejrvruszlwhvm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Vite inlines these into the browser bundle at build time, so the key is public no matter where
it is stored. It is public **by design**; RLS is the actual security boundary. This also means
the GitHub Pages build needs no secrets configuration.

**The secret key (`sb_secret_…` / `service_role`) bypasses every policy. It must never be in
this repo, in the app, or in a chat.**

Supabase renamed its keys: `sb_publishable_` = old `anon`, `sb_secret_` = old `service_role`.

---

## 8. What is real vs simulated

| Area | State |
| --- | --- |
| Salons, services, staff, prices | **Live from Supabase** |
| Salon ratings | Live (view); currently empty ⇒ "New" |
| Auth / sign-in | **Not built.** No sign-in screen exists. Users are created from the Supabase dashboard. |
| Bookings | Browser-only. Lost on refresh. |
| Waitlist | Browser-only; seat release is a 3.2s `setTimeout`. |
| Vendor edits (add service/staff, live-hidden toggle) | Browser-only. |
| Payment | Simulated. No card details are ever requested or collected. |
| Salon chat + Saloni Assistant | Scripted locally (`state/replies.ts`). Nothing is sent anywhere. |
| Photos | CSS placeholder tiles. |
| Availability (slots, disabled times) | **Hardcoded arrays** in `data/services.ts`, not from `working_hours`. |

---

## 9. Open TODOs in the code

Grep `TODO(roadmap` — five markers, all cross-referenced to `ROADMAP.md`:

- `screens/vendor/Services.tsx` — services can be added but **not edited or deleted** (A1)
- `screens/vendor/Staff.tsx` — the "Edit" label is a `<div>`, not a control (A1)
- `screens/vendor/Gallery.tsx` — the Upload button has **no handler at all** (A2)
- `screens/vendor/Waitlist.tsx` — "Notify" only toasts the owner's own screen (A3)
- `state/AppContext.tsx` — the waitlist seat release is a simulated timer (A3)

---

## 10. Suggested next steps

1. **Authentication** — a real sign-in screen (phone OTP is the KSA norm; email is enabled for
   now). Nothing else can be user-specific until this exists. **This is the recommended next task.**
2. **Persist bookings** — write to `bookings` + `booking_items` (snapshot prices!), read "My bookings" back.
3. **Real availability** — replace the hardcoded `SLOTS`/`DISABLED_SLOTS` with a query over
   `working_hours`, service durations and existing bookings.
4. Vendor CRUD (roadmap A1), photo upload with EXIF stripping (A2), waitlist notifications (A3).
5. Payments, compliance, Capacitor wrap — see `ROADMAP.md` §B.

---

## 11. Working conventions

- **Verify, don't assume.** DB changes are proven with `./scripts/test-db.sh`; UI changes are
  driven in real Chromium via Playwright before being called done.
- Commit messages explain **why**, and state known gaps honestly.
- Every push redeploys the live site — check the Actions run goes green.
- Code style: no `dangerouslySetInnerHTML`, no `eval`; user input is length-capped and rendered
  as text; real `<button>` elements with focus styles; `lang`/`dir` kept in sync.

### Sandbox quirk worth knowing
The Claude Code environment's egress proxy **blocks `supabase.co` and `github.io`**. So an
agent working on this repo **cannot** query the live database or load the deployed site. Work
around it by running Postgres locally with the same schema (`scripts/test-db.sh`) and by
testing the app's fallback path; the live behaviour has to be confirmed in the user's browser.
