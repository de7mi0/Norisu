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

export function composeMessage(payload: OfferPayload, locale: Locale): PushMessage {
  const lang: Locale = locale === 'ar' ? 'ar' : 'en';
  if (payload.kind === 'message') return composeChat(payload, lang);
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
