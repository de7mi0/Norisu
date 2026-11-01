// Saloni — the notification worker, as one file.
//
// GENERATED FILE. Do not edit directly: it is built from index.ts and
// message.ts by scripts/build-function-bundle.sh. Edit those and regenerate.
//
// This exists for one reason: the Supabase dashboard's function editor is the
// only way to deploy without installing the CLI, and one file is much less to
// get wrong than recreating a directory. Paste the whole thing in and deploy.
//
// If you use the CLI instead, deploy the directory rather than this file —
// index.ts and message.ts are the originals, and message.ts is what
// scripts/test-notification-text.mjs actually tests.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

/**
 * The words a customer actually reads, composed here and nowhere else.
 *
 * Deliberately dependency-free and side-effect-free, for two reasons: it runs
 * inside a Deno edge function, and it is the one part of the sender that can be
 * tested without a network, a provider account or a device — which
 * `scripts/test-notification-text.mjs` does, in both languages.
 *
 * The service worker composes nothing. It displays what arrives, because a
 * translation living in a service worker is a translation that drifts from
 * src/i18n and cannot be checked against it.
 */

export type Locale = 'en' | 'ar';

export interface OfferPayload {
  kind?: string;
  salon?: Partial<Record<Locale, string>>;
  services?: Partial<Record<Locale, string>>;
  starts_at?: string;
  hold_minutes?: number;
  claim_url?: string;
  offer_id?: string;
  /** Present on a message in a conversation (0025) rather than an offer. */
  conversation_id?: string;
  from?: Partial<Record<Locale, string>>;
  preview?: string;
  url?: string;
  /** Bookings and salon decisions (0028). */
  booking_id?: string;
  reference?: string;
  hours?: number;
  reason?: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  lang: Locale;
}

/**
 * Both formatters carry the same two subtags the app forces in src/i18n, for
 * the same reasons, and getting either wrong is the kind of thing nobody
 * notices until an Arabic-speaking customer does:
 *
 *   -ca-gregory  Saudi locales default to the Hijri calendar, and every date
 *                stored here is Gregorian.
 *   -nu-latn     the rest of the message — the time, the minutes — is in Latin
 *                digits, and an Arabic locale would otherwise render the date
 *                alone in Arabic-Indic ones, putting two numbering systems in
 *                one sentence.
 */
function formatWhen(iso: string, locale: Locale): { date: string; time: string } {
  const at = new Date(iso);
  const base = locale === 'ar' ? 'ar-SA' : 'en-GB';
  const zone = { timeZone: 'Asia/Riyadh' } as const;

  return {
    date: at.toLocaleDateString(`${base}-u-ca-gregory-nu-latn`, {
      ...zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    time: at.toLocaleTimeString(`${base}-u-ca-gregory-nu-latn`, {
      ...zone,
      hour: '2-digit',
      minute: '2-digit',
      // 24-hour in both languages, because that is what the app shows on the
      // slot grid and on the booking. A notification saying 4:30 م and a screen
      // saying 16:30 are the same time twice, and the customer has to do the
      // conversion to be sure.
      hour12: false,
    }),
  };
}

/**
 * Somebody wrote in a conversation. The title is who, the body is what they
 * said — the message itself, not a description of it, because that is what
 * every messaging app shows and what lets somebody decide whether to open it.
 */
function composeChat(payload: OfferPayload, lang: Locale): PushMessage {
  const from = payload.from?.[lang] ?? payload.from?.en ?? '';
  const fallback = lang === 'ar' ? 'رسالة جديدة' : 'New message';
  return {
    title: from || fallback,
    body: payload.preview?.trim() || fallback,
    url: payload.url ?? './',
    // One notification per conversation: a second message replaces the first
    // rather than stacking a pile of them on the lock screen.
    tag: `chat:${payload.conversation_id ?? 'conversation'}`,
    lang,
  };
}

/**
 * A booking or a salon decision (0028). Every word is here and nowhere else,
 * like the offer and the chat: the service worker displays, it never composes.
 * Returns null for a kind this file does not know, so the worker can fail the
 * row rather than send it worded as a seat offer.
 */
function composeNotice(payload: OfferPayload, lang: Locale): PushMessage | null {
  const ar = lang === 'ar';
  const salon = payload.salon?.[lang] ?? payload.salon?.en ?? '';
  const services = payload.services?.[lang] ?? payload.services?.en ?? '';
  const url = payload.url ?? './';
  const tag = `${payload.kind}:${payload.booking_id ?? salon}`;
  const when = payload.starts_at ? formatWhen(payload.starts_at, lang) : null;
  const at = when ? (ar ? `${when.date} الساعة ${when.time}` : `${when.date} at ${when.time}`) : '';
  const what = services ? `${services} — ${at}` : at;
  const ref = payload.reference ? (ar ? ` المرجع ${payload.reference}.` : ` Ref ${payload.reference}.`) : '';
  const reason = (payload.reason ?? '').trim();
  const out = (title: string, body: string): PushMessage => ({ title, body, url, tag, lang });

  switch (payload.kind) {
    case 'booking_confirmed':
      return ar
        ? out(`تم تأكيد حجزك في ${salon}`, `${what}.${ref} تدفع للصالون عند زيارتك.`)
        : out(`Booking confirmed at ${salon}`, `${what}.${ref} You pay the salon at your visit.`);
    case 'booking_moved':
      return ar
        ? out(`تم نقل موعدك في ${salon}`, `الموعد الجديد: ${what}.${ref}`)
        : out(`Your appointment at ${salon} has moved`, `New time: ${what}.${ref}`);
    case 'booking_cancelled':
      return ar
        ? out(`ألغى ${salon} موعدك`, `${what}. افتح صالوني لحجز وقت آخر.`)
        : out(`${salon} cancelled your appointment`, `${what}. Open Saloni to book another time.`);
    case 'booking_reminder': {
      const hours = Math.round(payload.hours ?? 24);
      const lead = hours >= 24
        ? ar ? 'تذكير: موعدك غداً' : 'Reminder: your appointment is tomorrow'
        : ar ? `تذكير: موعدك بعد ${hours} ساعة` : `Reminder: your appointment is in ${hours} hours`;
      return out(`${lead} · ${salon}`, `${what}.${ref}`);
    }
    case 'salon_approved':
      return ar
        ? out(`تم اعتماد ${salon}`, 'تحققنا من سجلك التجاري. سيظهر صالونك للعملاء بعد نشره في الدليل.')
        : out(`${salon} is approved`, 'We checked your commercial registration. Your salon appears to customers once it is published.');
    case 'salon_live':
      return ar
        ? out(`${salon} منشور الآن`, 'يستطيع العملاء الآن إيجاد صالونك والحجز فيه على صالوني.')
        : out(`${salon} is live`, 'Customers can now find and book your salon on Saloni.');
    case 'salon_rejected':
      return ar
        ? out(`تعذّر اعتماد ${salon}`, `السبب: ${reason}. صحّح رقم السجل في ملف العمل لنراجعه مرة أخرى.`)
        : out(`We could not approve ${salon}`, `Reason: ${reason}. Correct your registration number in Business profile and we will review it again.`);
    case 'salon_closed':
      return ar
        ? out(`أُغلق ${salon}`, `أغلق صالوني صالونك. السبب: ${reason}.`)
        : out(`${salon} has been closed`, `Saloni closed your salon. Reason: ${reason}.`);
    default:
      return null;
  }
}

/** Kinds composeNotice knows; anything else is not sent as one. */
export const NOTICE_KINDS = [
  'booking_confirmed', 'booking_moved', 'booking_cancelled', 'booking_reminder',
  'salon_approved', 'salon_live', 'salon_rejected', 'salon_closed',
];

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

/** Text that came from a person — a salon's name, a refusal's reason — made safe for HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The same notice as an e-mail, in the recipient's language. Plain, with the
 * words of the push and a link back to the app; no images, no tracking pixel.
 */
export function composeEmail(payload: OfferPayload, locale: Locale): EmailMessage {
  const push = composeMessage(payload, locale);
  const ar = push.lang === 'ar';
  const open = ar ? 'افتح صالوني' : 'Open Saloni';
  const footer = ar
    ? 'وصلتك هذه الرسالة لأنها تخص حسابك في صالوني. Oilgy Establishment.'
    : 'You received this because it is about your Saloni account. Oilgy Establishment.';
  const dir = ar ? 'rtl' : 'ltr';
  return {
    subject: push.title,
    text: `${push.body}\n\n${open}: ${push.url}\n\n${footer}`,
    html:
      `<div dir="${dir}" lang="${push.lang}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1913">` +
      `<p style="font-size:18px;font-weight:bold;margin:0 0 12px">${escapeHtml(push.title)}</p>` +
      `<p style="margin:0 0 18px">${escapeHtml(push.body)}</p>` +
      `<p style="margin:0 0 24px"><a href="${escapeHtml(push.url)}" style="color:#856817">${open}</a></p>` +
      `<p style="font-size:12px;color:#6f6b62;margin:0">${footer}</p></div>`,
  };
}

export function composeMessage(payload: OfferPayload, locale: Locale): PushMessage {
  const lang: Locale = locale === 'ar' ? 'ar' : 'en';
  if (payload.kind === 'message') return composeChat(payload, lang);
  if (payload.kind && NOTICE_KINDS.includes(payload.kind)) {
    const notice = composeNotice(payload, lang);
    if (notice) return notice;
  }
  // Anything else that names a kind is not an offer, and wording it as one —
  // "A seat has opened" — is the mistake 0025 and 0028 shipped switched off to
  // avoid. Fail the row instead; the outbox records why.
  if (payload.kind && payload.kind !== 'waitlist_offer') {
    throw new Error(`no wording for notification kind ${payload.kind}`);
  }
  const salon = payload.salon?.[lang] ?? payload.salon?.en ?? '';
  const services = payload.services?.[lang] ?? payload.services?.en ?? '';
  const minutes = Math.max(1, Math.round(payload.hold_minutes ?? 15));
  const { date, time } = formatWhen(payload.starts_at ?? new Date().toISOString(), lang);

  // One notification per offer: a re-send replaces rather than stacks, which is
  // what the service worker's `tag` does with this.
  const tag = `offer:${payload.offer_id ?? 'waitlist'}`;
  const url = payload.claim_url ?? './';

  if (lang === 'ar') {
    return {
      title: salon ? `توفّر موعد في ${salon}` : 'توفّر موعد',
      body: `${services ? `${services} — ` : ''}${date} الساعة ${time}. محجوز لك لمدة ${minutes} دقيقة.`,
      url,
      tag,
      lang,
    };
  }

  return {
    title: salon ? `A seat has opened at ${salon}` : 'A seat has opened',
    body: `${services ? `${services} — ` : ''}${date} at ${time}. Held for you for ${minutes} minutes.`,
    url,
    tag,
    lang,
  };
}

// Saloni — the worker that drains the notifications outbox.
//
// Claims a batch of due messages, pushes each to every device its owner has
// registered, and marks it sent or failed. All three steps go through database
// functions granted to service_role alone (0010, 0011), because draining the
// outbox means reading who is waiting and how to reach them.
//
// HONESTY ABOUT WHAT IS TESTED. This has delivered a push to an Android phone:
// claiming, composing, sending and marking sent have all run against a live
// push service. A note here once claimed that prematurely, on a report alone,
// while the cron job was answering 401 and this function was never being
// called — so it is worth saying what makes the claim safe now: a registered
// device exists, and the cron job gets a 200. Of its three parts:
//
//   * The words a customer reads are composed in ./message.ts, which is pure
//     and is covered by scripts/test-notification-text.mjs — 17 checks in both
//     languages, including the Gregorian calendar and Latin digits that have
//     gone wrong in this project before.
//   * The encryption and VAPID signing are web-push's, and its API was checked
//     rather than recalled: generateRequestDetails() on a real P-256
//     subscription returns a POST with Content-Encoding aes128gcm and a
//     `vapid t=` Authorization header, which is the protocol.
//   * Claiming, composing, sending and marking sent have run for real. Retiring
//     a dead endpoint has not: it needs a subscription the push service has
//     forgotten, which happens only after an uninstall or a revoked permission.
//
// Deploy:   supabase functions deploy send-notifications
// Schedule: every minute or two. Holds are 15 minutes, so anything slower
//           wastes them.
//
// Secrets (supabase secrets set NAME=value). None belong in .env, which is
// committed and inlined into the browser bundle:
//
//   SUPABASE_URL                the project URL — provided automatically
//   SUPABASE_SERVICE_ROLE_KEY   the secret key. Bypasses every policy. Also
//                               provided automatically, but Supabase now calls
//                               this a "legacy" variable and plans to retire
//                               it. If it ever comes back empty, set
//                               SALONI_SERVICE_KEY yourself to the sb_secret_
//                               value and this keeps working.
//   VAPID_PUBLIC_KEY            the public half — the same value as the app's
//                               VITE_VAPID_PUBLIC_KEY, or nothing will decrypt
//   VAPID_PRIVATE_KEY           the private half. Never anywhere else.
//   VAPID_SUBJECT               a mailto: or https: URL identifying you, which
//                               push services require so they can complain

const BATCH = 20;

interface Device {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: 'web' | 'ios' | 'android';
}

interface Claimed {
  id: string;
  channel: 'push' | 'whatsapp' | 'sms';
  template: string;
  locale: Locale;
  payload: OfferPayload & { expires_at?: string };
  attempts: number;
  to_phone: string | null;
  to_name: string | null;
  devices: Device[];
  /** 0028: the address the person signs in with, for e-mail rows. */
  to_email?: string | null;
}

// SUPABASE_SERVICE_ROLE_KEY is injected by Supabase, but is now labelled a
// legacy variable on its way out. Rather than guess at the shape of whatever
// replaces it, fall back to a name we set ourselves — one secret to add on the
// day it disappears, instead of a worker that stops sending and says 401.
const serviceKey =
  Deno.env.get('SALONI_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!serviceKey) {
  throw new Error(
    'No service key. Set SALONI_SERVICE_KEY in Edge Function secrets to the ' +
      'project\'s sb_secret_ value.',
  );
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
  auth: { persistSession: false },
});

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

/**
 * How long the push service should keep trying, in seconds.
 *
 * Bounded by the hold: a notification delivered after the seat has passed to
 * the next person is worse than none, because it is the kind that teaches
 * people to stop opening them. A phone that has been off for the whole hold
 * should simply never receive this.
 */
function ttlSeconds(payload: { expires_at?: string }): number {
  if (!payload.expires_at) return 600;
  const left = Math.floor((new Date(payload.expires_at).getTime() - Date.now()) / 1000);
  return Math.max(60, Math.min(left, 3600));
}

/** True when the push service says this endpoint is gone for good. */
function isDead(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * E-mail through Resend's HTTP API (https://resend.com). Two secrets, both in
 * the function's settings and nowhere else:
 *
 *   RESEND_API_KEY   the key from the Resend dashboard
 *   EMAIL_FROM       e.g. "Saloni <bookings@your-domain.sa>" — on a domain
 *                    verified in Resend. A gmail.com address cannot be used:
 *                    providers refuse to send as a domain you do not control.
 *
 * Without them every e-mail row fails with a message saying so, which is what
 * the outbox shows rather than a silence.
 */
async function sendEmail(n: Claimed): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) throw new Error('e-mail not configured: set RESEND_API_KEY and EMAIL_FROM');
  if (!n.to_email) throw new Error('no e-mail address');
  const email = composeEmail(n.payload, n.locale);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [n.to_email], subject: email.subject, text: email.text, html: email.html }),
  });
  if (!response.ok) {
    throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

async function pushToDevices(n: Claimed): Promise<void> {
  if (n.devices.length === 0) throw new Error('no registered device');

  const message = JSON.stringify(composeMessage(n.payload, n.locale));
  const ttl = ttlSeconds(n.payload);

  let delivered = 0;
  const problems: string[] = [];

  for (const device of n.devices) {
    // Native devices will register here too once the Capacitor wrap exists,
    // and they do not speak Web Push. Skipping rather than failing keeps one
    // old iPhone from blocking the laptop that would have worked.
    if (device.platform !== 'web') {
      problems.push(`${device.platform}: no sender yet`);
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        message,
        {
          TTL: ttl,
          // web-push defaults this to "normal", which lets Android hold the
          // message until the phone next leaves Doze — in practice, until
          // somebody unlocks it. That is fine for a newsletter and useless for
          // a seat held for fifteen minutes, and it is exactly what makes a
          // push look like it "only works when the browser is open".
          //
          // "high" tells the push service to wake the device now. The Web Push
          // spec reserves it for messages the user would want interrupting
          // them for, which a seat about to be given away is.
          urgency: 'high',
        },
      );
      delivered += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      if (isDead(status)) {
        // Uninstalled, or permission revoked. The browser never tells us, so
        // this is the only moment we find out. Clear it out rather than
        // retrying it every offer forever.
        await admin.rpc('retire_push_device', { p_endpoint: device.endpoint });
        problems.push(`${status} gone, retired`);
      } else {
        problems.push(`${status || 'error'}: ${(e as Error).message}`.slice(0, 120));
      }
    }
  }

  // One device reached is a notification delivered. Only a clean sweep of
  // failures is a failure, or a customer with a dead old device would never be
  // told anything.
  if (delivered === 0) throw new Error(problems.join('; ') || 'no device accepted it');
}

/**
 * A shared word between the cron job and this function, if one is set.
 *
 * The function never looked at who was calling it. That cannot make it send
 * anything it should not — every row it sends was queued by the database, and
 * the payload is the database's — but anybody who knew the URL could make it
 * *run*, which spends the project's invocation budget and nothing else.
 *
 * Deliberately opt-in. Requiring a header the existing cron job does not send
 * would stop every notification the moment this deploys, which is a worse
 * outcome than the thing it fixes. Set SALONI_WORKER_SECRET in the function's
 * secrets and add the same value as an `x-saloni-worker` header on the cron
 * job — supabase/README.md has the SQL — and this closes. Until then it says
 * so in the response rather than pretending to be protected.
 */
const workerSecret = Deno.env.get('SALONI_WORKER_SECRET');

Deno.serve(async (request) => {
  if (workerSecret && request.headers.get('x-saloni-worker') !== workerSecret) {
    // No detail: a caller who guessed wrong learns only that they guessed.
    return Response.json({ error: 'not authorised' }, { status: 401 });
  }

  // Rows whose hold has lapsed or whose seat has been taken are filtered out
  // here rather than sent — see claim_pending_notifications().
  const { data, error } = await admin.rpc('claim_pending_notifications', { p_limit: BATCH });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const claimed = (data ?? []) as Claimed[];
  let sent = 0;
  let failed = 0;

  for (const n of claimed) {
    try {
      if (n.channel === 'email') {
        await sendEmail(n);
        await admin.rpc('mark_notification_sent', { p_id: n.id });
        sent += 1;
        continue;
      }
      if (n.channel !== 'push') {
        // WhatsApp is built in the database and switched off in
        // notification_settings.channels. If it is ever switched back on, this
        // is the branch to write — see docs/whatsapp-waitlist-template.md.
        // Saying so beats retrying a row five times in silence.
        throw new Error(`no sender for channel ${n.channel}`);
      }
      await pushToDevices(n);
      await admin.rpc('mark_notification_sent', { p_id: n.id });
      sent += 1;
    } catch (e) {
      await admin.rpc('mark_notification_failed', {
        p_id: n.id,
        p_error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  // `guarded` is here so a glance at the cron job's own logs answers "is this
  // endpoint protected yet?" without reading the secrets page.
  return Response.json({ claimed: claimed.length, sent, failed, guarded: Boolean(workerSecret) });
});
