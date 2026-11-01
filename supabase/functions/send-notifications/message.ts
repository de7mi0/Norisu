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
