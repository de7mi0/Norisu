# Saloni · صالوني

A bilingual (English / Arabic) salon booking platform for Saudi Arabia, implemented from
the "Saloni Prototype" design. It covers two apps in one shell: the **customer** booking
journey and the **vendor** portal salon owners use to run their business.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck (tsc -b) + production build
npm run lint     # oxlint
```

Requires Node 20+.

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
- **Data is seeded and in-memory**, so it resets on reload.

The seams are deliberate: the data modules and the reducer's actions are where a real API
would be introduced, without touching the screens.

Design fidelity is intentional, but three things were fixed rather than copied, because
the prototype's behaviour was a genuine defect: the released-seat banner is dismissible
(it otherwise covers the back button and traps the user on the salon screen), Latin runs
such as `-20%` and `0.8 km` are bidi-isolated so they don't reorder inside Arabic text,
and a staff name ending in a period no longer produces "Layla A..".
