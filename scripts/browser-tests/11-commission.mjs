// What a salon owes Saloni.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/11-commission.mjs
//
// Saloni takes a percentage of each booking, so every salon gets an invoice.
// The screen exists so that invoice is never the first time an owner sees the
// number — which makes most of what these check a matter of the words being
// right, not just the data arriving.
//
// Three of them are about being honest rather than being correct, and those
// are the ones worth having: that a failed query does NOT read as "you owe
// nothing", that walk-ins are stated as never charged, and that the screen
// says nothing is collected through the app. Each is a thing a salon would
// otherwise assume the other way, and each is expensive to get wrong once.
//
// What is actually owed is assertions 112-115's business, not these: a stub
// agrees to anything.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '33333333-3333-3333-3333-333333333333';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000001';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

// Two calls arrive, this month then last. 13,800 halalas billed at 5% is 690 —
// the figures the assertions use, so the two suites talk about the same money.
const db = { calls: [], fail: false, empty: false };

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

    if (url.includes('rpc/commission_statement')) {
      const body = JSON.parse(req.postData() || '{}');
      db.calls.push(body);
      if (db.fail) {
        return route.fulfill({ status: 500, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ message: 'boom' }) });
      }
      if (db.empty) {
        return ok(route, [{ bookings_count: 0, gross_halalas: 0, commission_halalas: 0 }]);
      }
      // The first call is this month, the second last month.
      const second = db.calls.length > 1;
      return ok(route, [second
        ? { bookings_count: 9, gross_halalas: 414000, commission_halalas: 20700 }
        : { bookings_count: 3, gross_halalas: 138000, commission_halalas: 6900 }]);
    }

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Salon Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{
      id: SALON, owner_id: USER, slug: 'maison-noir', name_en: 'Maison Noir',
      name_ar: 'ميزون نوار', is_verified: true, is_published: true,
      waitlist_enabled: true, slot_step_minutes: 30, city: 'Riyadh',
      area_en: 'Al Olaya', area_ar: 'العليا', tags_en: '', tags_ar: '',
      category_en: '', category_ar: '', phone: null, latitude: null, longitude: null }]);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toEarnings(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(900);
  // Entering the portal lands on Business details; its back arrow is the way
  // through to the dashboard for an owner who already has a salon.
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^More$|^المزيد$/ }).last().click();
  await page.waitForTimeout(800);

  // Checked on the hub itself, before opening the screen, so this fails as a
  // check rather than as a navigation crash against the code that had a
  // "Payouts · SAR 18,240" row with a dead handler where this now sits.
  const hub = await page.locator('body').innerText();
  check(`${arabic ? 'AR' : 'EN'}: the More hub no longer shows an invented payout figure`,
        !hub.includes('18,240'), hub.slice(0, 300).replace(/\n/g, ' '));

  await page.getByRole('button', { name: arabic ? /عمولة صالوني/ : /Saloni commission/ }).click();
  await page.waitForTimeout(900);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.calls = []; db.fail = false; db.empty = false;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toEarnings(page, arabic);

  const body = await page.locator('body').innerText();

  check(`${L}: it asks the database for two periods`, db.calls.length === 2,
        JSON.stringify(db.calls));

  // Both windows must be whole months, and they must not overlap.
  if (db.calls.length === 2) {
    const [now, prev] = db.calls;
    check(`${L}: this month's window starts on the 1st`,
          new Date(now.p_from).getDate() === 1, now.p_from);
    check(`${L}: last month ends where this month begins`,
          prev.p_to === now.p_from, `${prev.p_to} vs ${now.p_from}`);
  }

  check(`${L}: what is owed this month is shown`,
        body.includes(arabic ? '69 ر.س' : 'SAR 69'),
        body.slice(0, 300).replace(/\n/g, ' '));

  check(`${L}: and what it was charged on`,
        body.includes(arabic ? '1380 ر.س' : 'SAR 1380'),
        body.slice(0, 300).replace(/\n/g, ' '));

  check(`${L}: the completed-visit count is shown`, /\b3\b/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));

  // Derived from the two figures rather than read from the salon row, because
  // the rate is in no grant at all (migration 0018).
  check(`${L}: the rate is derived and shown`, body.includes('5.0%'),
        body.slice(0, 400).replace(/\n/g, ' '));

  check(`${L}: last month is shown beside it`,
        body.includes(arabic ? '207 ر.س' : 'SAR 207'),
        body.slice(0, 500).replace(/\n/g, ' '));

  // The two things a salon would otherwise assume the other way.
  check(`${L}: it says walk-ins are never charged`,
        arabic ? /لا تُحتسب عمولة على من يأتي إليك مباشرة/.test(body)
               : /Walk-ins and bookings you took yourself are never charged/.test(body),
        body.slice(0, 600).replace(/\n/g, ' '));

  check(`${L}: and that nothing is collected through the app`,
        arabic ? /لا يُحصَّل شيء عبر التطبيق/.test(body)
               : /Nothing is collected through the app/.test(body),
        body.slice(0, 600).replace(/\n/g, ' '));

  check(`${L}: it says commission only counts once a visit is completed`,
        arabic ? /تضع الزيارة كمكتملة/.test(body) : /mark a visit completed/.test(body),
        body.slice(0, 600).replace(/\n/g, ' '));

  await page.close();
}

// A failed query must not read as "you owe nothing". Zero is a figure, and
// this is the one place being wrong that way costs somebody real money.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.calls = []; db.fail = true; db.empty = false;
  await install(page);
  await toEarnings(page, false);
  const body = await page.locator('body').innerText();

  check('a failed lookup says so rather than showing a zero',
        /Could not load your figures/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  check('and shows no money figure at all',
        !/SAR\s*\d/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

// A real month with nothing completed is a real answer worth zero, and reads
// differently from a failure.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.calls = []; db.fail = false; db.empty = true;
  await install(page);
  await toEarnings(page, false);
  const body = await page.locator('body').innerText();

  check('a month with no completed visits says nothing is owed yet',
        /Nothing owed yet/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  check('and explains when commission would appear',
        /once a booking is marked completed/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  await page.close();
}

// A visitor who owns no salon is told why, rather than shown zeroes that look
// like their own figures.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.route(`**/${REF}.supabase.co/**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /^More$/ }).last().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Saloni commission/ }).click();
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();

  check('a visitor who owns no salon is told these are a salon\'s figures',
        /These are a salon’s figures|These are a salon's figures/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
