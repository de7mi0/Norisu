// Who the reviewers' sign-in lets in — supabase/functions/review-sign-in/review.ts.
//
//   node --experimental-strip-types scripts/test-review-sign-in.mjs
//
// The function's network half (generating the code, the admin refusal, the
// lock) needs a live Supabase and is not run here; the lock itself is database
// assertion 149. This is the half that decides, and the half a mistake in
// would let somebody in.
import { decide, readConfig, sameSecret } from '../supabase/functions/review-sign-in/review.ts';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

const config = readConfig(' Review@Example.test ', '482913');

// Off unless both secrets are set, and set sensibly.
check('off with no secrets', readConfig(undefined, undefined) === null);
check('off with no code', readConfig('review@example.test', '') === null);
check('off with no e-mail', readConfig('', '482913') === null);
check('off with a code that is not six digits (12345)', readConfig('review@example.test', '12345') === null);
check('off with a code that is not six digits (1234567)', readConfig('review@example.test', '1234567') === null);
check('off with letters in the code', readConfig('review@example.test', '48291a') === null);
check('off with an address that is not one', readConfig('review', '482913') === null);
check('on, with the address lower-cased', config?.email === 'review@example.test', JSON.stringify(config));
check('disabled config refuses everything', decide(null, { email: 'review@example.test', code: '482913' }).kind === 'disabled');

// The right pair, typed the way people type.
check('the right address and code are let in',
      decide(config, { email: 'review@example.test', code: '482913' }).kind === 'allowed');
check('the address in capitals with spaces still matches',
      decide(config, { email: '  REVIEW@example.TEST ', code: ' 482913 ' }).kind === 'allowed');
check('and it signs in the configured account, not the typed text',
      decide(config, { email: 'REVIEW@example.test', code: '482913' }).email === 'review@example.test');

// Everything else is refused — and refused the same way.
const wrongCode = decide(config, { email: 'review@example.test', code: '482914' });
const wrongEmail = decide(config, { email: 'owner@example.test', code: '482913' });
check('a wrong code is refused', wrongCode.kind === 'refused');
check('the right code for another account is refused', wrongEmail.kind === 'refused');
check('a wrong address and a wrong code look identical',
      JSON.stringify(wrongCode) === JSON.stringify(wrongEmail));
check('a prefix of the code is refused', decide(config, { email: 'review@example.test', code: '4829' }).kind === 'refused');
check('the code with extra digits is refused',
      decide(config, { email: 'review@example.test', code: '4829130' }).kind === 'refused');
check('an empty code is refused', decide(config, { email: 'review@example.test', code: '' }).kind === 'refused');
check('a look-alike address is refused',
      decide(config, { email: 'review@example.test.evil', code: '482913' }).kind === 'refused');

// Malformed requests never reach the comparison.
check('no body', decide(config, null).kind === 'badRequest');
check('a number for a code', decide(config, { email: 'review@example.test', code: 482913 }).kind === 'badRequest');
check('an array for an address', decide(config, { email: ['review@example.test'], code: '482913' }).kind === 'badRequest');
check('an oversized address', decide(config, { email: `${'a'.repeat(400)}@x.y`, code: '482913' }).kind === 'badRequest');

// The comparison itself.
check('sameSecret: equal strings', sameSecret('482913', '482913'));
check('sameSecret: one digit different', !sameSecret('482913', '482910'));
check('sameSecret: different lengths', !sameSecret('482913', '48291'));
check('sameSecret: empty against something', !sameSecret('', '482913'));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
