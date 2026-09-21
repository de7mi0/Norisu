// What the portal says to somebody who closed their salon and came back.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/13-closed-portal.mjs
//
// Written against a real report rather than a review: the owner closed a salon,
// came back, and the vendor portal showed a salon again. Not theirs — the
// bundled sample one, which the portal falls back to for any account owning
// none, under a notice reading "Sample salon — this account doesn't own one
// yet". For somebody who had just deliberately shut their business, every word
// of that is wrong, and `yet` most of all.
//
// The cause was 0019 working as designed: closing severs owner_id on purpose,
// so afterwards the app could not tell "just closed one" from "never had one".
// 0020 records who closed it and answers through my_closed_salon().
//
// These check the sentence, because the sentence is the whole fix. They are
// confirmed to fail against the code before 0020.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '44444444-4444-4444-4444-444444444444';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'former@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

// `closed` false means an account that never had a salon — the case the old
// wording was written for, and which must keep reading the way it did.
const db = { closed: true, answers: true, calls: 0 };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });

    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('rpc/my_closed_salon')) {
      db.calls += 1;
      if (!db.closed) return ok(route, []);
      if (!db.answers) {
        return route.fulfill({ status: 500, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ message: 'boom' }) });
      }
      return ok(route, [{ name_en: 'Rose & Oud', name_ar: 'وردة وعود',
                          closed_at: '2026-09-18T09:00:00Z' }]);
    }

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Former Owner', phone: null, locale: 'en' });
    // The account owns nothing: closing nulled owner_id.
    if (url.includes('/rest/v1/salons')) return ok(route, []);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toPortalHub(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(1000);
  // Business details first; its back arrow reaches the dashboard.
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^More$|^المزيد$/ }).last().click();
  await page.waitForTimeout(900);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.closed = true; db.answers = true; db.calls = 0;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toPortalHub(page, arabic);

  const body = await page.locator('body').innerText();

  check(`${L}: the portal asks what this account closed`, db.calls > 0, String(db.calls));

  check(`${L}: it says the salon was closed`,
        arabic ? /لقد أغلقت هذا الصالون/.test(body) : /You closed this salon/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // Naming it is what stops the sample salon being mistaken for theirs.
  check(`${L}: and names which one`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'),
        body.slice(0, 400).replace(/\n/g, ' '));

  check(`${L}: and when`, /18/.test(body), body.slice(0, 400).replace(/\n/g, ' '));

  // The whole reported confusion: a salon on screen that is not yours.
  check(`${L}: it says the salon shown below is not theirs`,
        arabic ? /لا شيء مما بالأسفل يخصك/.test(body)
               : /Nothing below is yours/.test(body),
        body.slice(0, 500).replace(/\n/g, ' '));

  check(`${L}: it says their records were kept`,
        arabic ? /أما سجلاتك فمحفوظة/.test(body) : /Your records were kept/.test(body),
        body.slice(0, 500).replace(/\n/g, ' '));

  // The wrong sentence, in the one place it was being shown.
  check(`${L}: and never says they do not own one "yet"`,
        arabic ? !/لا يملك صالوناً بعد/.test(body) : !/doesn’t own one yet/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  check(`${L}: there is a way to open a new salon`,
        arabic ? /سجّل صالوناً جديداً/.test(body) : /Register a new salon/.test(body),
        body.slice(0, 500).replace(/\n/g, ' '));

  await page.close();
}

// Somebody who never had a salon must keep reading the way they did — the old
// wording is correct for them, and this fix must not spread to their case.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.closed = false; db.answers = true; db.calls = 0;
  await install(page);
  await toPortalHub(page, false);
  const body = await page.locator('body').innerText();

  check('an account that never had a salon still reads "doesn’t own one yet"',
        /doesn’t own one yet/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  check('and is not told it closed anything',
        !/You closed this salon/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

// If the lookup fails, the portal still must not say "yet" — losing the name
// costs a sentence, and saying the wrong thing costs trust.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.closed = true; db.answers = false; db.calls = 0;
  await install(page);
  await toPortalHub(page, false);
  const body = await page.locator('body').innerText();

  check('a failed lookup still shows the portal rather than breaking it',
        /Sample salon/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
