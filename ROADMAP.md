# Saloni — roadmap

Where the product goes from here. Today Saloni is a **front-end prototype**: it looks and
behaves like the real thing. The catalogue, sign-in, bookings, availability and the salon owner's
own dashboard, calendar and reviews are real and survive a refresh; payment, chat, the waitlist,
photos and notifications are still simulated.

Two decisions are settled and shape everything below:

- **Distribution:** native apps on the **App Store and Google Play**.
- **Waitlist alerts:** **push notifications + WhatsApp**.

> The Saudi regulatory points in this document (ZATCA e-invoicing, PDPL, commercial
> registration) are flagged as things to build for and to **confirm with an accountant and
> a lawyer**. They are not legal advice.

---

## Part A — Backlog

Three gaps recorded for implementation. Each names the file where the work lands.

### 1. Editing services

**Now:** `src/screens/vendor/Services.tsx` lets an owner add a service and switch it
between Live and Hidden. There is no way to **edit** or **remove** one — a typo in a price
means the service is stuck wrong. The Staff screen has the same hole in a worse form:
`src/screens/vendor/Staff.tsx` renders an "Edit" label that isn't even a button.

**To build:**
- Reuse the existing `SheetModal` / `SheetField` (`src/components/SheetModal.tsx`) in an
  edit mode, prefilled from the record — not a second form.
- Editable fields: name, Arabic name, price, duration, discount.
- Delete should **archive**, not hard-delete, so historical bookings keep their reference.
- Add `updateService` / `deleteService` actions alongside the existing `saveService` in
  `src/state/appReducer.ts`.
- Same treatment for staff members, wiring up that dead "Edit" control.

**Design decision to get right:** **snapshot the price onto the booking when it is made.**
If a salon raises a haircut from 150 to 180, every past booking and receipt must still say
150. Read prices from the booking record, never by looking the service up again later.

### 2. Photo upload

**Now:** the "+ Upload" button in `src/screens/vendor/Gallery.tsx` has **no click handler
at all** — it is decorative. Every image in the app is a striped CSS placeholder
(`tile.*` in `src/theme.ts`).

**To build:**
- Wire the button to a file input (`accept="image/*"`, multiple).
- Validate type and size on the client, then **resize and compress before uploading** —
  phone photos are 3–8 MB each and salons will upload dozens.
- Upload through a signed URL to object storage; store the returned URLs on the salon.
- Set cover photo, reorder, delete.
- Replace the placeholders in Gallery, Home and SalonDetail with real images, lazy-loaded,
  with a blurred placeholder while loading.

**Security, and this one matters:**
- Validate the real content type **server-side** — never trust the file extension.
- Cap file size and pixel dimensions; reject anything absurd before it hits storage.
- **Strip EXIF metadata.** Phone photos embed GPS coordinates. Uploading them raw would
  publish the exact location of the salon and of whoever took the photo.
- Moderate uploads — these are publicly visible on salon profiles.

### 3. Notifying a customer when a seat opens

**Now:** joining the waitlist starts a `setTimeout` in `src/state/AppContext.tsx`
(`joinWaitlist`) that fakes a seat opening 3.2 seconds later, and the vendor's "Notify"
button in `src/screens/vendor/Waitlist.tsx` shows a toast on the owner's own screen.
Nothing reaches the customer. This is the biggest gap of the three — the waitlist is the
feature that makes the product interesting, and it currently does nothing.

**How it should actually work:**

1. **Store the waitlist.** Each entry: customer, salon, service, date, time preference,
   and `created_at`.
2. **Trigger** when a booking is cancelled or rescheduled — or when the owner taps Notify.
3. **Match** entries for that salon and date against the freed slot's service and the
   customer's stated time preference, ordered by `created_at` so it is genuinely
   first-come-first-served.
4. **Offer it to one person at a time, with a hold.** Send the offer with a unique claim
   token and reserve the slot for ~10–15 minutes. If it expires unclaimed, pass it to the
   next person automatically.

   This is the decision worth thinking about. Broadcasting to everyone at once fills the
   seat fastest, but most recipients open the app to find it already taken — which teaches
   people to ignore the notifications. A sequential hold is slower and much better.

5. **Deep-link** the notification straight into the booking flow at that exact slot, so
   claiming it is one tap.
6. **Deliver on both channels:** push (FCM + APNs — reliable now the app is native) and a
   WhatsApp Business API template message, in Arabic and English.
7. **Be considerate:** respect quiet hours, allow opt-out, never send for a slot that has
   already passed, and cap how often one person is pinged.
8. **Record** `notified_at`, `claimed_at`, `expired_at` — you'll need them to tune the hold
   window and to see whether the feature actually works.

---

## Part B — From prototype to published app

Ordered by dependency. Phase 2 has the longest lead time and should start on day one, in
parallel with the engineering.

### Phase 0 — Foundations
Nothing else can be real until data persists.
- Backend and database.
- Data model: users, salons, staff, services, working hours, bookings, waitlist, reviews, media.
- ~~**Phone-OTP authentication**~~ — **built**, as passcode sign-in with the roles and
  row-level security already in place. It runs on e-mail codes today; the SMS channel that is
  the Saudi norm is written and waits only on an SMS provider being paid for
  (`VITE_AUTH_PHONE_OTP`). See `CLAUDE.md` §6.

Recommended: **Supabase** (Postgres, auth, storage, realtime and row-level security in one
product) rather than assembling four services. The swap-in points already exist in this
codebase: the modules under `src/data/` and the actions in `src/state/appReducer.ts`.

### Phase 1 — Real business logic
- ~~Bookings that persist~~ — **built.** Written to `bookings` + `booking_items` with prices
  snapshotted, read back into "My bookings", and gated on sign-in. Rescheduling moves the booking
  rather than creating a second one, and cancelling frees the slot while keeping the record.
  Still to do here: moving the two inserts into one Postgres function so they cannot
  half-succeed, and a cancellation policy (how late is too late to cancel free of charge).
- ~~A genuine availability engine~~ — **built.** `available_slots()` (migration 0003) computes
  offered times from `working_hours`, the chosen services' length and the bookings already made,
  per staff member or across the salon's capacity for "any professional". It is `security
  definer` because row-level security rightly hides other customers' bookings from the browser.
  The salon's own `slot_step_minutes` sets the spacing. Still to do here: **buffer//turnaround
  time between appointments**, per-staff schedules beyond the `working_hours.staff_id` rows the
  function already honours, and owner-facing screens to edit any of it.
- ~~Double-booking must be prevented by a database constraint~~ — **built** for named staff (the
  GiST exclusion constraint). **Still open for "any professional"**: `staff_id` is null, so
  Postgres has nobody to compare against. Availability capacity-checks it when offering times,
  but two people racing the last chair can still both be written. Assigning a staff member at
  booking time is the fix.
- Booking lifecycle: ~~confirm, cancel, reschedule~~ built **from the customer's side**; the salon
  cannot yet move a booking through its own statuses from the portal. **No-show** and a
  **cancellation policy** (notice period, fees) still to do.
- ~~Somewhere to put the customer's name~~ — **built.** `profiles.full_name` had existed since the
  first migration with nothing ever writing to it, so every account was blank and the vendor
  calendar had only booking references to show. The profile screen's "Personal details" row and a
  one-off prompt after a booking both write it. It stays **optional**: the salon sees the reference
  otherwise, which is the honest fallback rather than a degraded one. Still to do: a fuller "your
  details" screen — `profiles.phone` is never set by the app.
- ~~Salon self-registration~~ — **built.** The onboarding screen was a mockup: fixed placeholder
  text and a button that only navigated, so no salon could ever exist and the entire vendor side
  was unreachable. It now creates the salon owned by the signed-in user, unverified and
  unpublished, with a default week of opening hours so the booking screen works from minute one.
  Approval is a human step in the Supabase dashboard (`supabase/README.md`); still to do is an
  admin screen and telling an owner when they go live.
- ~~Per-owner vendor data~~ — **built, apart from the waitlist.** `src/data/owner.ts` resolves the
  salon the signed-in user owns; the opening-hours and booking-interval editor writes
  `working_hours` and `salons.slot_step_minutes`; the services and team lists are the owner's own;
  and migration 0005's `salon_day()`, `salon_stats()` and `salon_reviews()` now supply the
  dashboard figures, the day calendar and the reviews list. The **waitlist** is the last sample
  section and still says so on screen — it cannot become real until the customer side writes
  `waitlist_entries`, which nothing does yet.

  `bookings_select` did already let an owner read their salon's bookings, so the appointments
  needed no new privilege — but `profiles_select_own` hides every profile but the viewer's own, so
  the browser could fetch the bookings and still not know whose they were. That is what 0005 is
  for, and it is deliberately narrow: the customer's display name and nothing else. No e-mail, no
  phone number.

  Two figures are stated carefully rather than flattered. "Booked today" is what customers agreed
  to, **not takings** — `paid_at` is still always null. Occupancy is null on a day the salon is
  closed, and capped at 100% because unassigned bookings can oversell a day (see the
  double-booking item above).

  ~~The calendar is read-only~~ — **built.** Tapping an appointment offers confirm, start,
  complete, no-show, cancel and reassign, and only the moves that are legal from where it stands.
  What is legal is decided in the database by 0006's status trigger rather than duplicated in the
  browser. Replying to a review is built too, through `reply_to_review()` (0007) — it had to be a
  function, because 0006 left `reviews` with no UPDATE privilege at all.

  Still to do here: the "+ Add" pill, which needs a customer account for a walk-in to belong to,
  and the dashboard, which covers today only — no week, no month, no trend beyond yesterday.
- ~~Vendor CRUD for services and team (backlog item 1)~~ — **built.** An owner adds, edits, hides
  and removes their own services and staff. Removing archives rather than deletes, because
  bookings reference the row and a past booking must keep meaning what it meant. What is still
  unbuilt: photo upload.
- ~~Business profile editing~~ — **built,** and it turned up a hole worth recording: `salons_update_own`
  plus 0002's blanket column grant let an owner set `is_verified` and `is_published` on their own
  salon, walking into the customer catalogue with nobody having checked their CR. Migration 0004
  revokes those two columns from `authenticated`; approval stays a human act in the dashboard.

### Phase 2 — Payments (start the paperwork now)
- A **legal entity with a commercial registration (CR) and a business bank account** is a
  prerequisite — no gateway will onboard you without one. This queue is measured in weeks.
- Gateway for **mada**, Apple Pay and cards: Moyasar, Tap, HyperPay, PayTabs or
  Checkout.com. **Tabby and Tamara require their own separate merchant onboarding.**
- Payouts to salons, the commission model, and refunds.

Two things worth knowing early:
- **Apple does not require In-App Purchase for real-world services.** Salon appointments
  are a physical service, so you can take payment through mada/Apple Pay directly and keep
  the 30% that digital goods would cost you.
- **VAT invoicing falls under ZATCA e-invoicing.** That's a build item with real
  requirements, not a PDF you generate at the end. Confirm the current scope with an
  accountant.

### Phase 3 — Notifications
Backlog item 3: FCM and APNs for push, plus a WhatsApp Business API provider (Unifonic,
Twilio, 360dialog) with pre-approved bilingual templates. Template approval takes days, so
submit them before you need them.

### Phase 3.5 — The security audit, and what it left open
- ~~Column-level write privileges~~ — **built (migration 0006).** Row policies gate rows; only
  grants can gate columns, and 0002's blanket grant meant every "edit your own X" policy allowed
  editing *every field* of X. An audit found three live holes: a customer could promote themselves
  to `admin` and read the whole database, a salon could rewrite reviews about itself, and either
  side of a booking could rewrite its price or mark it paid. All closed, each with an assertion
  that fails when its protection is removed.
- **Still open, and it blocks payments:** the browser states the booking price at creation time.
  `create_booking()` computing totals in Postgres from the salon's own `services` rows is the fix,
  and it is the same function that makes the booking and its items atomic. Do it before money moves.
- Still to do: rate limiting on booking creation, and a decision on open signup — anyone can create
  an account today, which is fine for a demo and worth revisiting before launch.

### Phase 4 — Compliance and trust
- **PDPL** (Saudi Personal Data Protection Law, SDAIA): privacy policy, consent, retention
  periods, deletion rights, and a decision on data residency.
- Terms of service and a vendor agreement.
- **Verify vendors** — check the CR — before a salon can take real bookings.
- Moderation for photos and reviews.

### Phase 5 — Ship the apps
- Wrap this same React codebase with **Capacitor**. No rewrite: the existing screens ship
  as-is, with native push and deep links added.
- **Apple Developer Program** — an organisation account needs a **D-U-N-S number**, which
  takes time to obtain — and **Google Play Console**.
- Bilingual store listings and screenshots, Apple privacy labels, Google data-safety form.
- TestFlight and Play internal testing before review.
- Error monitoring (Sentry) and analytics **before** launch, not after.

### Phase 6 — Operations
Custom domain, a staging environment separate from production, automated tests in CI,
database backups, and someone reachable when a salon's Saturday morning breaks.

---

## The concrete next step

**Stand up the backend — auth and the data model first.** Everything above depends on data
that survives a refresh, and the current code is deliberately structured so that dropping
a real API behind `src/data/` and the reducer doesn't touch the screens.

**On the same day, start the CR and payment-gateway paperwork.** It runs for weeks in the
background while the engineering proceeds, and it is the thing most likely to delay launch
if it's left until the app is finished.
