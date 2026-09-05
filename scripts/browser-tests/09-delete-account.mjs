// Deleting an account from inside the app.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/09-delete-account.mjs
//
// Both app stores require this of any app with sign-in, and require it to be
// reachable without contacting anybody — so half of what these check is that a
// reviewer can find it and use it. The other half is that it cannot happen by
// accident: it is the one irreversible thing a customer can do here.
//
// What actually gets deleted is assertions 107-109's business, not these:
// a stub will agree to anything. These prove the app asks properly, sends the
// call, and explains a refusal.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '77777777-7777-7777-7777-777777777777';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'leaver@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const db = { calls: 0, signedOut: false, rejectNext: null };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });

    if (url.includes('/auth/v1/logout')) { db.signedOut = true; return ok(route, {}); }
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('rpc/delete_my_account')) {
      db.calls += 1;
      if (db.rejectNext) {
        const e = db.rejectNext; db.rejectNext = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) });
      }
      return ok(route, null);
    }

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'customer',
      full_name: 'Leaving Soon', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, []);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toProfile(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Profile|حسابي/i }).last().click();
  await page.waitForTimeout(700);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.calls = 0; db.signedOut = false; db.rejectNext = null;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toProfile(page, arabic);

  // A reviewer has to be able to find it without being told where it is.
  let body = await page.locator('body').innerText();
  check(`${L}: the profile screen offers to delete the account`,
        body.includes(arabic ? 'حذف حسابي' : 'Delete my account'),
        body.slice(0, 200).replace(/\n/g, ' '));

  await page.getByRole('button', { name: arabic ? /^حذف حسابي$/ : /^Delete my account$/ }).click();
  await page.waitForTimeout(500);
  body = await page.locator('body').innerText();

  check(`${L}: it says what is removed and what the salon keeps`,
        /removed for good|نهائياً/.test(body) && /salon|الصالون/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));

  // Nothing happens until the word is typed — this is the accident guard.
  const go = page.getByRole('button', { name: arabic ? /^احذف نهائياً$/ : /^Delete for good$/ });
  check(`${L}: the delete button starts disabled`, await go.isDisabled());
  await go.click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  check(`${L}: and clicking it anyway sends nothing`, db.calls === 0, String(db.calls));

  // A near miss is still a miss.
  await page.locator('input[type="text"]').last().fill('delet');
  await page.waitForTimeout(200);
  check(`${L}: a half-typed word does not arm it`, await go.isDisabled());

  await page.locator('input[type="text"]').last().fill('DELETE');
  await page.waitForTimeout(200);
  check(`${L}: typing the word arms it`, !(await go.isDisabled()));

  await go.click();
  await page.waitForTimeout(900);
  body = await page.locator('body').innerText();

  check(`${L}: the account is deleted through the function`, db.calls === 1, String(db.calls));
  check(`${L}: the session is ended with it`, db.signedOut);
  check(`${L}: and the person is told`,
        /account has been deleted|تم حذف حسابك/.test(body),
        body.slice(0, 200).replace(/\n/g, ' '));

  await page.close();
}

// A salon owner is refused, in words that say what to do instead — not
// "could not save".
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.calls = 0; db.signedOut = false;
  await install(page);
  await toProfile(page, false);
  await page.getByRole('button', { name: /^Delete my account$/ }).click();
  await page.waitForTimeout(400);
  await page.locator('input[type="text"]').last().fill('DELETE');
  db.rejectNext = { code: 'SL007', message: 'this account owns a salon' };
  await page.getByRole('button', { name: /^Delete for good$/ }).click();
  await page.waitForTimeout(900);

  const body = await page.locator('body').innerText();
  check('a salon owner is told why, and what to do instead',
        /owns a salon/.test(body) && /handed over or closed/.test(body),
        body.slice(0, 240).replace(/\n/g, ' '));
  check('the refusal does not sign them out', !db.signedOut);
  check('and the sheet stays open, so nothing is retyped',
        /Type DELETE to confirm/.test(body), body.slice(0, 160).replace(/\n/g, ' '));
  await page.close();
}

// Signed out there is nothing to delete, and the app does not offer it.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.route(`**/${REF}.supabase.co/**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I'm a customer/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Profile/i }).last().click();
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();
  check('a signed-out visitor is not offered account deletion',
        !body.includes('Delete my account'), body.slice(0, 200).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
