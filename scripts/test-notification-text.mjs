// The words a customer reads, checked in both languages.
//
//   node scripts/test-notification-text.mjs
//
// This is the only part of the sender that can be tested at all without a
// provider account and a real device, so it is worth testing properly: the
// calendar and the digits are exactly the things that went wrong in the app
// itself once, and the same two subtags fix them here.
import { composeEmail, composeMessage } from '../supabase/functions/send-notifications/message.ts';

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const payload = {
  kind: 'waitlist_offer',
  offer_id: '3f9a1c72-58d4-4a2e-9b61-0c7e5d2a8f14',
  salon: { en: 'Maison Noir', ar: 'ميزون نوار' },
  services: { en: 'Signature Haircut', ar: 'قص شعر' },
  // 16:30 Riyadh on a Tuesday.
  starts_at: '2026-08-25T13:30:00.000Z',
  hold_minutes: 15,
  claim_url: 'https://de7mi0.github.io/Norisu/?claim=3f9a1c72-58d4-4a2e-9b61-0c7e5d2a8f14',
};

const en = composeMessage(payload, 'en');
const ar = composeMessage(payload, 'ar');
console.log(`\nEN  ${en.title}\n    ${en.body}\nAR  ${ar.title}\n    ${ar.body}\n`);

check('EN names the salon in the title', en.title.includes('Maison Noir'), en.title);
check('AR names the salon in Arabic', ar.title.includes('ميزون نوار'), ar.title);
check('AR uses no English in the title', !/[A-Za-z]/.test(ar.title), ar.title);
check('EN names the service', en.body.includes('Signature Haircut'), en.body);
check('AR names the service in Arabic', ar.body.includes('قص شعر'), ar.body);

// The two that bit this project before.
check('AR is Gregorian, not Hijri', ar.body.includes('أغسطس') || ar.body.includes('آب'), ar.body);
check('AR uses Latin digits, not Arabic-Indic',
      !/[٠-٩۰-۹]/.test(ar.body), ar.body);
check('EN reads as a date a person would say', /Tuesday/.test(en.body), en.body);

// Riyadh, not UTC: 13:30Z is 16:30 local.
// 13:30Z is 16:30 in Riyadh, and 24-hour in both languages so the notification
// and the app's own slot grid never disagree about what time it is.
check('EN is 24-hour Riyadh time', en.body.includes('16:30'), en.body);
check('AR is 24-hour Riyadh time', ar.body.includes('16:30'), ar.body);
check('AR does not slip into 12-hour with ص/م', !/[صم]\s*\./.test(ar.body) && !ar.body.includes('4:30'), ar.body);

check('both say how long it is held',
      en.body.includes('15 minutes') && ar.body.includes('15 دقيقة'));
check('the claim link is carried through', en.url === payload.claim_url);
check('one notification per offer, so a re-send replaces',
      en.tag === ar.tag && en.tag.includes(payload.offer_id));
check('the language is stated for the notification to render right',
      en.lang === 'en' && ar.lang === 'ar');

// Nothing should throw or read badly when the salon has no services attached.
const bare = composeMessage({ salon: { en: 'X' }, starts_at: payload.starts_at }, 'en');
check('a payload with no services still reads as a sentence',
      !bare.body.includes('—') && bare.body.startsWith('Tuesday'), bare.body);
check('a missing hold falls back rather than saying NaN',
      /Held for you for \d+ minutes/.test(bare.body), bare.body);

// A message in a conversation (0025), not an offer. The old worker composed
// every row as an offer, which is why 0025 ships with message pushes off.
const chat = {
  kind: 'message',
  conversation_id: '7b1e0c44-1d2a-4f39-a6d0-5e8c2f91b3aa',
  from: { en: 'Maison Noir', ar: 'ميزون نوار' },
  preview: 'Yes, 6 is fine.',
  url: 'https://de7mi0.github.io/Norisu/',
};
const chatEn = composeMessage(chat, 'en');
const chatAr = composeMessage(chat, 'ar');
check('a message is titled with who wrote it, in the reader\'s language',
      chatEn.title === 'Maison Noir' && chatAr.title === 'ميزون نوار', chatAr.title);
check('a message shows what was said, and nothing about a seat',
      chatEn.body === 'Yes, 6 is fine.' && !/seat|موعد/.test(chatEn.title + chatAr.title), chatEn.body);
check('one notification per conversation, so a second message replaces the first',
      chatEn.tag === `chat:${chat.conversation_id}` && chatEn.url === chat.url);
const bareChat = composeMessage({ kind: 'message' }, 'ar');
check('a message with nothing in it still reads as a sentence',
      bareChat.title === 'رسالة جديدة' && bareChat.body === 'رسالة جديدة', bareChat.title);

// Bookings and salon decisions (0028).
const booking = {
  kind: 'booking_confirmed', booking_id: 'b1', reference: 'SL-ABC123',
  salon: { en: 'Maison Noir', ar: 'ميزون نوار' },
  services: { en: 'Signature Haircut', ar: 'قص شعر' },
  starts_at: '2026-08-25T13:30:00.000Z', url: 'https://de7mi0.github.io/Norisu/',
};
const confEn = composeMessage(booking, 'en');
const confAr = composeMessage(booking, 'ar');
check('a confirmation names the salon, the service, the time and the reference',
      confEn.title.includes('Maison Noir') && confEn.body.includes('Signature Haircut')
      && confEn.body.includes('16:30') && confEn.body.includes('SL-ABC123'), confEn.body);
check('and says payment is at the salon', /pay the salon at your visit/.test(confEn.body), confEn.body);
check('in Arabic, Gregorian with Latin digits', confAr.body.includes('قص شعر') && confAr.body.includes('16:30')
      && !/[٠-٩]/.test(confAr.body) && /أغسطس|آب/.test(confAr.body), confAr.body);
const remind24 = composeMessage({ ...booking, kind: 'booking_reminder', hours: 24 }, 'en');
const remind2 = composeMessage({ ...booking, kind: 'booking_reminder', hours: 2 }, 'ar');
check('the day-before reminder says tomorrow', /tomorrow/.test(remind24.title), remind24.title);
check('the two-hour reminder says how long, in Arabic', /بعد 2 ساعة/.test(remind2.title), remind2.title);
check('a salon cancellation says who cancelled and what to do',
      /Maison Noir cancelled your appointment/.test(composeMessage({ ...booking, kind: 'booking_cancelled' }, 'en').title)
      && /book another time/.test(composeMessage({ ...booking, kind: 'booking_cancelled' }, 'en').body));
check('a move gives the new time', /New time: .*16:30/.test(composeMessage({ ...booking, kind: 'booking_moved' }, 'en').body));
const rejected = { kind: 'salon_rejected', salon: { en: 'Rose & Oud', ar: 'وردة وعود' },
                   reason: '<b>CR</b> does not match', url: 'https://de7mi0.github.io/Norisu/' };
check('a refusal gives the reason and the fix',
      /CR.* does not match/.test(composeMessage(rejected, 'en').body)
      && /Business profile/.test(composeMessage(rejected, 'en').body));
check('approval and going live are told apart',
      /is approved/.test(composeMessage({ ...rejected, kind: 'salon_approved' }, 'en').title)
      && /is live/.test(composeMessage({ ...rejected, kind: 'salon_live' }, 'en').title));
const mail = composeEmail(rejected, 'en');
check('an e-mail escapes text a person wrote', mail.html.includes('&lt;b&gt;CR&lt;/b&gt;') && !mail.html.includes('<b>CR'), mail.html);
check('an Arabic e-mail is right-to-left', composeEmail(rejected, 'ar').html.includes('dir="rtl"'));
let threw = false;
try { composeMessage({ kind: 'something_new', salon: { en: 'X' } }, 'en'); } catch { threw = true; }
check('a kind with no wording is refused, not sent as a seat offer', threw);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
