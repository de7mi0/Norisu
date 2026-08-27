// The words a customer reads, checked in both languages.
//
//   node scripts/test-notification-text.mjs
//
// This is the only part of the sender that can be tested at all without a
// provider account and a real device, so it is worth testing properly: the
// calendar and the digits are exactly the things that went wrong in the app
// itself once, and the same two subtags fix them here.
import { composeMessage } from '../supabase/functions/send-notifications/message.ts';

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

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
