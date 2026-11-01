// "Open now" from a salon's own hours, in Riyadh time.
//
//   node --experimental-strip-types scripts/test-hours.mjs
//
// The salon page said "Open now · until 11:00 PM" for every salon at every
// hour. These pin the replacement: Riyadh time whatever the phone's clock,
// a break at midday, a closed day, and a salon that gave no hours at all.
import { openingStatus } from '../src/lib/hours.ts';

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${JSON.stringify(d)}`}`); };

// Sun–Thu 10:00–23:00, Friday 14:00–23:00, Saturday split around a break.
const hours = [0, 1, 2, 3, 4].map((day) => ({ day, opens: '10:00:00', closes: '23:00:00' }))
  .concat([{ day: 5, opens: '14:00:00', closes: '23:00:00' },
           { day: 6, opens: '09:00:00', closes: '12:00:00' },
           { day: 6, opens: '16:00:00', closes: '22:00:00' }]);

// 2026-11-01 is a Sunday. 12:00Z is 15:00 in Riyadh.
let s = openingStatus(hours, new Date('2026-11-01T12:00:00Z'));
check('open in the afternoon, until its real closing time', s.open && s.closes === '23:00', s);

// 21:00Z Sunday is 00:00 Monday in Riyadh: closed, opens at 10:00 today.
s = openingStatus(hours, new Date('2026-11-01T21:00:00Z'));
check('midnight in Riyadh is closed even when UTC says 9pm', !s.open && s.opens === '10:00' && s.inDays === 0, s);

// Friday 08:00 Riyadh (05:00Z): opens later the same day, at 14:00.
s = openingStatus(hours, new Date('2026-11-06T05:00:00Z'));
check('Friday morning waits for the late start', !s.open && s.opens === '14:00' && s.inDays === 0, s);

// Saturday 13:00 Riyadh (10:00Z): in the break, reopens at 16:00.
s = openingStatus(hours, new Date('2026-11-07T10:00:00Z'));
check('a midday break is closed, reopening that afternoon', !s.open && s.opens === '16:00', s);
s = openingStatus(hours, new Date('2026-11-07T14:00:00Z'));
check('and open again after it', s.open && s.closes === '22:00', s);

// Thursday 23:30 Riyadh: next opening is Friday 14:00, tomorrow.
s = openingStatus(hours, new Date('2026-11-05T20:30:00Z'));
check('after closing, the next opening is tomorrow', !s.open && s.inDays === 1 && s.opens === '14:00', s);

s = openingStatus([], new Date());
check('a salon with no hours is not called open', !s.open && s.opens === null, s);

const only = [{ day: 3, opens: '10:00', closes: '18:00' }]; // Wednesdays only
s = openingStatus(only, new Date('2026-11-01T12:00:00Z'));
check('a salon open one day a week says which day', !s.open && s.inDays === 3, s);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
