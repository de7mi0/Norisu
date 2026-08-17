# Saloni · صالوني

A bilingual (English / Arabic) salon booking platform for Saudi Arabia, implemented from
the "Saloni Prototype" design. It covers two apps in one shell: the **customer** booking
journey and the **vendor** portal salon owners use to run their business.

## ▶ Try it

**https://de7mi0.github.io/Norisu/**

Opens on a phone or a laptop, nothing to install. It redeploys automatically every time
this branch is pushed. On a desktop it appears inside a phone frame; on a real phone it
fills the screen.

### A guided tour

Some of the best parts aren't obvious, so here is the order worth clicking:

1. **Book an appointment.** "I'm a customer" → tap the big featured salon → tap two
   services (the total appears at the bottom) → Continue → pick a specialist → Pick a time
   → choose a slot → Continue to payment → Confirm & pay. Greyed-out slots are already taken.
2. **The waitlist.** On the time screen, pick the **5th date chip** — that day is fully
   booked. Tap "Join the waitlist", then **wait about 3 seconds**: a seat opens, a banner
   appears, and the freed slot turns green and becomes bookable. The banner follows you
   around the app until you tap it or dismiss it with ✕.
3. **Arabic.** Use the **EN / ع** toggle at the top-right of the home screen, or
   Profile → Language. Every screen mirrors to right-to-left, including the tab bar.
4. **Reschedule.** Bookings tab → Reschedule on any card.
5. **The assistant.** The 🤖 button floating above the tab bar. Try the topic chips, or
   type a message containing "refund" to see it branch.
6. **The vendor portal.** Profile → **"Switch to vendor portal"**. Then explore the
   dashboard, the calendar, and Services (toggle a service between Live and Hidden, or add
   one with "+ Add a service"). Under **More** you'll find the photo gallery, team
   management ("+ Add team member"), reviews, and waitlist settings. "Switch to customer
   app" takes you back.

### What's next

[**ROADMAP.md**](ROADMAP.md) covers what's still to build — editing services, photo
upload, and how a customer actually gets told a seat opened — plus the path from this
prototype to apps on the App Store and Google Play.

### What's real and what isn't

**Real:** the salons, services and staff you see are read from a Supabase database at
startup — see [`supabase/`](supabase/) for the schema and its security policies. Change a
price in the database and the app shows the new one on the next load. **Signing in is real
too:** a six-digit code goes to your e-mail (SMS once a provider is configured), the session
survives a reload, and the profile screen shows the account it belongs to. Saloni has no
passwords at all.

**Bookings are real too.** Making one saves it to your account with the prices as they
were on the day, and it is still there when you come back. This is the one place the app
asks you to sign in: an appointment has to belong to somebody.

**Still simulated:** payment is never actually taken and no card details are ever asked
for or collected — a booking records *how* you chose to pay but is never marked paid. The
salon chat and the assistant reply from a built-in script. Which times appear as available
is still invented rather than read from each salon's real opening hours, and the waitlist
and vendor edits still live only in the browser.

If the database can't be reached, the app falls back to bundled sample data after a few
seconds and says so at the top of the home screen, rather than showing an empty list.

## Running it locally

Only needed if you want to edit the code. Requires Node 20+.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck (tsc -b) + production build
npm run lint     # oxlint
```

For a quick look without installing anything, this repo also opens directly in a browser
sandbox at [stackblitz.com/github/de7mi0/Norisu](https://stackblitz.com/github/de7mi0/Norisu).

## What's implemented

**Customer** — role chooser, discovery home (featured salon, category filter, nearby
salons), salon profile with a multi-select service cart, specialist picker, date and time
slots, review & pay with VAT and the payment methods common in the Kingdom, booking
confirmation, my bookings (upcoming/past, reschedule), ratings & reviews, profile, salon
chat, and the Saloni Assistant.

**Waitlist** — when a day is fully booked the customer can join a waitlist. A seat is
then released, a banner surfaces it across the app, and the freed slot becomes bookable.

**Vendor** — registration, dashboard (today's numbers and schedule), calendar, services
and pricing with live/hidden switches and an add-service sheet, photo gallery, team
management with an add-member sheet, reviews with owner replies, and waitlist settings.

**Bilingual throughout** — every screen renders in English or Arabic, with the layout
mirroring to RTL, Arabic typefaces, and localised prices (`SAR 150` / `150 ر.س`).

## Architecture

```
src/
  App.tsx              screen router, tab bars, floating overlays
  theme.ts             colour, type, and placeholder-tile tokens
  types.ts             domain models
  data/                seeded salons, services, staff, payments, reviews, vendor data
  i18n/                en + ar dictionaries and formatting helpers
  state/               reducer, provider, scripted chat/assistant replies
  components/          phone frame, screen scaffolding, tab bar, sheet modal, chat, icons
  screens/customer/    the twelve customer screens
  screens/vendor/      the nine vendor screens
  hooks/               drag-to-scroll for horizontal rails
```

All application state lives in one reducer (`src/state/appReducer.ts`) exposed through a
context (`src/state/context.ts`). Screens read what they need and dispatch actions; no
screen owns cross-screen state.

## Notes on this build

This implements the prototype's behaviour, so everything that was simulated in the design
stays simulated and runs entirely in the browser:

- **Payments are not real.** The checkout screen selects a method and confirms; no card,
  wallet, or credential is ever collected or transmitted.
- **Chat and the assistant reply from a local script** (`src/state/replies.ts`). Nothing
  is sent anywhere.
- **The waitlist and vendor edits are in-memory**, so they reset on reload. The catalogue,
  the session and bookings are not — those are real.

The seams are deliberate: the data modules and the reducer's actions are where a real API
would be introduced, without touching the screens.

Design fidelity is intentional, but three things were fixed rather than copied, because
the prototype's behaviour was a genuine defect: the released-seat banner is dismissible
(it otherwise covers the back button and traps the user on the salon screen), Latin runs
such as `-20%` and `0.8 km` are bidi-isolated so they don't reorder inside Arabic text,
and a staff name ending in a period no longer produces "Layla A..".
