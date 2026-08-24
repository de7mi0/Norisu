# The WhatsApp message that tells a customer a seat opened

**Submit this now.** Meta reviews every message template before you may send it, and
until this one is approved the waitlist cannot tell anybody anything. Approval is
often quick but is quoted in days, and it costs nothing to have it sitting approved
and unused. Everything else in this document can wait; the submission cannot.

The database already queues these messages — see `supabase/migrations/0010_notifications.sql`.
What is missing is permission to send them and something to do the sending.

---

## 1. Why a template at all

WhatsApp does not let a business message somebody out of the blue in its own words.
You may reply freely for 24 hours after a customer messages you, and outside that
window you may only send a **template** that Meta has approved in advance.

A freed seat always arrives outside that window — the customer joined a waitlist
hours or days ago and has not messaged you since. So a template is not optional.

**Category: Utility.** This matters. A Utility template is one the customer asked
for, which is exactly what a waitlist is. The alternative, Marketing, costs more per
message and is suppressed for anyone who has opted out of marketing — which would
silently swallow the notification for some of the people most wanting it. If Meta's
form tries to auto-classify this as Marketing, change it back to Utility before
submitting.

---

## 2. What you need before you start

1. A **Meta Business account** with your business verified. Verification wants your
   commercial registration, and it is the slowest step — start it first if it is not
   already done.
2. A **WhatsApp Business Platform** account, either directly with Meta (Cloud API) or
   through a provider. In Saudi Arabia **Unifonic** is the usual local choice;
   **Twilio** and **360dialog** also work. A provider costs a little more per message
   and saves you a great deal of setup.
3. A **phone number** dedicated to the business, not already registered to a personal
   WhatsApp account.

You do not need any of the app's code or keys for this. It is entirely a dashboard job.

---

## 3. The template

Create it **once**, then add a second language version under the same name. Same name,
same variables, same order — only the words change. The app picks the language from
`profiles.locale`, which is the language the customer chose in the app.

**Name:** `waitlist_seat_offer`
*(lowercase and underscores only — Meta rejects spaces and capitals)*

**Category:** Utility

**Variables**, in this order, in both languages:

| | Meaning | Sample to paste in the form |
| --- | --- | --- |
| `{{1}}` | Salon name | `Lumière Beauty Lounge` |
| `{{2}}` | What they were booking | `Hair Colour + Blow Dry` |
| `{{3}}` | The date | `Tuesday 26 August` |
| `{{4}}` | The time | `4:30 PM` |
| `{{5}}` | How long it is held, in minutes | `15` |

Meta requires a sample value for every variable or it will not accept the submission.

### English body

```
A seat has just opened at {{1}}.

{{2}} — {{3}} at {{4}}.

It is being held for you for {{5}} minutes. Open Saloni to take it, or it will pass
to the next person waiting.
```

### Arabic body

```
توفّر موعد في {{1}}.

{{2}} — {{3}} الساعة {{4}}.

هذا الموعد محجوز لك لمدة {{5}} دقيقة. افتح تطبيق صالوني لتأكيده، وإلا سينتقل إلى من يليك في قائمة الانتظار.
```

### The button

Add one button, type **URL**, sub-type **Dynamic**:

- **Button text (English):** `Take this seat`
- **Button text (Arabic):** `احجز هذا الموعد`
- **URL:** `https://de7mi0.github.io/Norisu/?claim={{1}}`
- **Sample value for the URL variable:** `3f9a1c72-58d4-4a2e-9b61-0c7e5d2a8f14`

The button's `{{1}}` is numbered separately from the body's — it is the first variable
*of the button*, not a sixth variable. The value is the offer's `claim_token`, which
migration 0009 has been generating all along for exactly this purpose: it is single-use
and unguessable, so a forwarded link could not be used to take somebody else's seat.

**One honest caveat about that button today.** The app does not yet read the `claim`
parameter — tapping it opens Saloni, and the held seat is then one more tap away on the
Bookings screen, where it already appears with a "Take this seat" button. So the link
works, but it is two taps rather than one, and the token is carried without yet being
used. Wiring it up is a small change on both sides (a lookup by token in the database,
and reading the parameter on load) and is the next piece of this feature. Submitting the
template with the button now is still right — changing an approved template means
resubmitting and waiting again, so it is much better to have the button already there.

---

## 4. Submitting it, click by click

Menu labels move around; if one of these does not match what you see, look for the
nearest equivalent rather than assuming something is wrong.

1. Go to **business.facebook.com** and sign in.
2. Open **WhatsApp Manager** (in the left sidebar, or from the all-tools menu).
3. Choose **Manage templates** → **Create template**.
4. Set **Category** to **Utility**. Not Marketing — see §1.
5. Set **Name** to `waitlist_seat_offer`.
6. Set **Language** to **English**.
7. Paste the English body from §3 into the **Body** box. The form will detect `{{1}}`
   to `{{5}}` and ask for a sample of each — paste the samples from the table.
8. Under **Buttons**, add **Visit website**, set it to **Dynamic**, and paste the URL
   and its sample from §3.
9. Leave Header and Footer empty.
10. **Submit**.
11. Now repeat 3–10 with **Language: Arabic** and the Arabic body. Use the *same*
    template name. Meta treats the two as one template with two languages.

Watch the **Status** column. **Approved** means you may send. **Rejected** gives a
reason — the usual ones are a body that starts or ends with a variable, a missing
sample value, or wording that reads as an advert. None of those apply to the text
above, but if you edit it, keep those three in mind.

---

## 5. After it is approved

Approval alone sends nothing. Two things still have to happen, and both need work
that is not done yet:

- **Something has to read the queue and call WhatsApp.** The database fills an
  outbox; nothing drains it. `supabase/functions/send-notifications/` is the intended
  place, and it has never been run.
- **You need the provider's credentials** in Supabase, kept as secrets. The sending
  key is not a publishable key — it must never go in `.env` or in this repository.

Two limits worth knowing before you count on it:

- **The customer must have a phone number on their profile.** Nothing sets
  `profiles.phone` today, so in practice there is nobody to message yet. That is the
  next gap after this one.
- **Push is the better channel and needs the native app.** WhatsApp is what can be
  built before the Capacitor wrap exists, not what should carry this forever.

---

## 6. A second template, if you want one ready

Not needed for the waitlist, but it costs only another few days of waiting to have it
approved while you are here: a **booking confirmation**. If you want it, submit it
under the name `booking_confirmed`, Utility, same two languages, no button. It is not
referenced anywhere in the code and nothing will send it — it would simply be ready
when the app is.
