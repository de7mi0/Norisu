// The app-store reviewers' sign-in, from the sign-in sheet.
//
//   VITE_REVIEW_EMAIL=review@example.test npx vite build --outDir /some/dir
//   BASE=http://localhost:<port>/ node scripts/browser-tests/25-review-sign-in.mjs
//
// Needs a build made with VITE_REVIEW_EMAIL set — like 05-push.mjs needs a
// VAPID key — because the feature is off without it. Reviewers cannot read the
// e-mail a code goes to, so for that one address the app sends nothing and
// checks the typed code with the review-sign-in Edge Function, which answers
// with an ordinary session. What this proves is the app's half: that the
// review address never asks Supabase to send a code, that the typed code goes
// to the function, that its refusals read like any other wrong code, and that
// every OTHER address still signs in the normal way. Who the function lets in
// is scripts/test-review-sign-in.mjs; its lock is database assertion 149.
import { chromium } from 'playwright';

const BROWSER = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const REVIEW = 'review@example.test';
const USER = '99999999-9999-9999-9999-999999999925';

// supabase-js reads a session's expiry out of its access token, so the stub
// hands back something shaped like a JWT. Nothing checks the signature.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated',
  aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: REVIEW })}.sig`;
const user = { id: USER, aud: 'authenticated', role: 'authenticated', email: REVIEW, phone: '',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page, functionAnswer, lang = 'en') {
  const seen = { otp: [], verify: 0, review: [] };
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/otp')) { seen.otp.push(JSON.parse(req.postData() || '{}')); return json(route, 200, {}); }
    if (url.includes('/auth/v1/verify')) { seen.verify += 1; return json(route, 400, { code: 'otp_expired', msg: 'Token has expired or is invalid' }); }
    if (url.includes('/functions/v1/review-sign-in')) {
      seen.review.push(JSON.parse(req.postData() || '{}'));
      return functionAnswer(route);
    }
    if (url.includes('/auth/v1/user')) return json(route, 200, user);
    if (url.includes('/rest/v1/profiles')) return json(route, 200, { id: USER, role: 'customer',
      // The account's own language wins on sign-in (CLAUDE.md §6), so it is the
      // language this run is in, or the screen would switch under the checks.
      full_name: '', phone: null, locale: lang, allow_push: true, allow_whatsapp: false });
    return json(route, 200, []);
  });
  return seen;
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const browser = await chromium.launch({ executablePath: BROWSER });

async function signIn(page, arabic, email, code) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: arabic ? /^حسابي$/ : /^Profile$/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: arabic ? /^تسجيل الدخول$/ : /^Sign in$/ }).first().click();
  await page.waitForTimeout(500);
  await page.locator('input[type="email"], input[inputmode="email"]').first().fill(email);
  await page.getByRole('button', { name: arabic ? /^إرسال الرمز$/ : /^Send code$/ }).first().click();
  await page.waitForTimeout(700);
  await page.locator('input[autocomplete="one-time-code"]').first().fill(code);
  await page.getByRole('button', { name: arabic ? /تحقّق وسجّل الدخول/ : /Verify & sign in/ }).first().click();
  await page.waitForTimeout(1200);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';

  // The right code: signed in, and no e-mail was ever asked for.
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    const seen = await install(page, (route) => json(route, 200,
      { access_token: jwt, refresh_token: 'refresh-25' }), arabic ? 'ar' : 'en');
    await signIn(page, arabic, '  Review@Example.TEST ', '482913');
    check(`${L}: the review address is never sent a code`, seen.otp.length === 0, JSON.stringify(seen.otp));
    check(`${L}: the typed code goes to the review function`,
          seen.review.length === 1 && seen.review[0].code === '482913', JSON.stringify(seen.review));
    check(`${L}: and not to Supabase's own code check`, seen.verify === 0);
    const stored = await page.evaluate((r) => window.localStorage.getItem(`sb-${r}-auth-token`), REF);
    check(`${L}: the function's session is the one the app keeps`,
          Boolean(stored && stored.includes('refresh-25')), String(stored).slice(0, 80));
    // Not the address alone: "We sent a code to review@…" contains it too.
    const signOut = page.getByRole('button', { name: arabic ? /^تسجيل الخروج$/ : /^Sign out$/ });
    const codeStep = page.locator('input[autocomplete="one-time-code"]');
    check(`${L}: and the app shows the account signed in`,
          (await signOut.count()) > 0 && (await codeStep.count()) === 0);
    await page.close();
  }

  // A wrong code reads exactly like any other wrong code.
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    await install(page, (route) => json(route, 401, { error: 'invalid_code' }));
    await signIn(page, arabic, REVIEW, '000000');
    const body = await page.locator('body').innerText();
    // The same sentence any wrong code gets (Auth.tsx, authBadCode).
    const wrong = arabic ? 'الرمز غير صحيح' : "That code isn't right";
    check(`${L}: a wrong review code is refused, with the ordinary wrong-code message`,
          body.includes(wrong), body.slice(-300).replace(/\n/g, ' '));
    const stored = await page.evaluate((r) => window.localStorage.getItem(`sb-${r}-auth-token`), REF);
    check(`${L}: and nobody is signed in`, !stored);
    await page.close();
  }

  // Locked for the hour: told to wait, not that the code was wrong.
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    await install(page, (route) => json(route, 429, { error: 'too_many_attempts' }));
    await signIn(page, arabic, REVIEW, '482913');
    const stored = await page.evaluate((r) => window.localStorage.getItem(`sb-${r}-auth-token`), REF);
    check(`${L}: a locked review sign-in signs nobody in`, !stored);
    const body = await page.locator('body').innerText();
    check(`${L}: and says to wait, not that the code was wrong`,
          body.includes(arabic ? 'محاولات كثيرة' : 'Too many attempts'), body.slice(-300).replace(/\n/g, ' '));
    await page.close();
  }

  // Every other address is untouched: a real code is sent, and checked by Supabase.
  {
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    const seen = await install(page, (route) => json(route, 500, {}));
    await signIn(page, arabic, 'nora@example.test', '123456');
    check(`${L}: an ordinary address is still sent a real code`,
          seen.otp.length === 1 && seen.otp[0].email === 'nora@example.test', JSON.stringify(seen.otp));
    check(`${L}: and its code is checked by Supabase, never by the review function`,
          seen.verify === 1 && seen.review.length === 0, `verify=${seen.verify} review=${seen.review.length}`);
    await page.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
