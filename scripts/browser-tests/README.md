# Browser checks

145 checks that drive the built app in real Chromium, in **both languages**, against a
fake Supabase. They exist because `CLAUDE.md` §12 says UI changes are driven in a
browser before being called done — and because several real bugs in this project were
found here rather than by reading the code: an action bar that scrolled over the slot
grid, a sheet with two buttons that both said Close, and a booking reference that
scrambled inside Arabic text.

| File | Covers |
| --- | --- |
| `01-catalogue-and-portal.mjs` | Sign-in, the vendor dashboard and calendar, reviews, the name sheet, and the sample-data fallback |
| `02-appointments.mjs` | The owner acting on an appointment, reassigning, and replying to a review |
| `03-booking.mjs` | Booking through `create_booking()` — including that the browser sends no price |
| `04-waitlist.mjs` | Joining from a taken slot, the offer banner, claiming, and the salon's queue |
| `05-push.mjs` | Installability, the service worker, registering a device, and claiming a seat from a notification's link |

`05-push.mjs` carries the only regression check in this directory written against a fault
found in production rather than in review: a browser holding notification permission with
no subscription ever saved, which left six waitlist offers producing nothing and no error
anywhere. It was confirmed to fail against the code that had the bug before being trusted.

## Running them

Playwright is **not** a dependency — it is installed ad hoc, because CI does not run
these and adding it would put a browser download in every `npm install`:

```bash
npm install --no-save playwright
npm run build
npx vite preview --port 4173 &
BASE=http://localhost:4173/ node scripts/browser-tests/01-catalogue-and-portal.mjs
```

`05-push.mjs` is the exception: everything it covers is switched off without a VAPID
key, so it needs a build made with one. Any base64url string will do — nothing is
actually sent.

```bash
VITE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U npm run build
BASE=http://localhost:4173/ node scripts/browser-tests/05-push.mjs
```

Chromium always supports push, so the two cases that matter most on a customer's phone
— a refused permission, and an iPhone in an ordinary tab rather than on the home screen
— are reached by stubbing `Notification.permission` and `PushManager`. What is **not**
stubbed is the service worker registration and the manifest: those are the real thing,
because they are what makes the app installable at all.

Each file exits non-zero on the first failure and prints one line per check.

## How they fake Supabase

The sandbox these were written in cannot reach `supabase.co`, so every script
`page.route()`s the Supabase endpoints and answers them itself, and seeds a stub session
into `localStorage` so the app believes somebody is signed in.

**That is also their limit, and it matters.** A stub answers whatever it is told to, so
these prove the app *sends the right thing and renders the answer correctly* — they can
say nothing about whether a grant or a policy would really allow it. The database
assertions in `supabase/tests/` are the evidence for that half, and there are 88 of them.
