// Screens that stated things nobody had checked.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/19-no-invented-facts.mjs
//
// Found in an audit of the live app: every salon page said "Open now · until
// 11:00 PM" and "Private rooms" whatever the salon's hours or rooms; Explore
// headed its list "Near you" in an app that never asks where anybody is; the
// owner's More screen said "5 photos", "4.9 ★" and "Verified" to every owner,
// including one still awaiting review; and Profile said notifications were
// "On" whatever the phone had allowed. Each check here fails against the code
// before the fix.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '44444444-4444-4444-4444-444444444444';
const SALON = 'bbbbbbbb-0000-0000-0000-000000000002';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// hours: 'always' (open every minute of every day), 'never' (none given), 'fail'.
const db = { hours: 'always', published: true, verified: true };

function salonRow() {
  return [{ id: SALON, owner_id: USER, slug: 'rose-oud', name_en: 'Rose & Oud', name_ar: 'وردة وعود',
    is_verified: db.verified, is_published: db.published, closed_at: null, waitlist_enabled: true,
    slot_step_minutes: 30, city: 'Riyadh', area_en: 'Al Olaya', area_ar: 'العليا', tags_en: '',
    tags_ar: '', category_en: 'Ladies salon', category_ar: 'صالون سيدات', phone: null,
    latitude: null, longitude: null }];
}

async function install(page, signedIn) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/rest/v1/working_hours')) {
      if (url.includes('salon_id=eq')) {
        // The owner's own hours editor.
        return ok(route, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ salon_id: SALON, staff_id: null,
          day_of_week: d, opens_at: '00:00:00', closes_at: '23:59:00' })));
      }
      if (db.hours === 'fail') return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      if (db.hours === 'never') return ok(route, []);
      return ok(route, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ salon_id: SALON, day_of_week: d,
        opens_at: '00:00:00', closes_at: '23:59:00' })));
    }
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, db.published || url.includes('owner_id') ? salonRow() : []);
    return ok(route, []);
  });
  if (signedIn) {
    await page.addInitScript(([r, v]) =>
      window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
  }
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const text = async (page) => (await page.locator('body').innerText()).replace(/\n/g, ' ');
const browser = await chromium.launch({ executablePath: BROWSER });

async function toSalon(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';

  // A salon that is open every minute of every day says so, with its own closing time.
  Object.assign(db, { hours: 'always', published: true, verified: true });
  let page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, false);
  await toSalon(page, arabic);
  let body = await text(page);
  check(`${L}: Explore no longer says "Near you"`, !/Near you|قريب منك/.test(body), body.slice(0, 300));
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(700);
  body = await text(page);
  check(`${L}: an open salon is called open, until its own closing time`,
        (arabic ? /مفتوح الآن/.test(body) : /Open now/.test(body)) && body.includes('23:59'), body.slice(0, 500));
  check(`${L}: the invented "11:00 PM" and "Private rooms" are gone`,
        !/11:00 PM|11:00 مساءً|Private rooms|غرف خاصة/.test(body), body.slice(0, 500));
  await page.close();

  // A salon that gave no hours is not called open.
  db.hours = 'never';
  page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, false);
  await toSalon(page, arabic);
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(700);
  body = await text(page);
  check(`${L}: a salon with no hours is not called open`,
        !/Open now|مفتوح الآن/.test(body) && (arabic ? /لم تُحدَّد أوقات العمل/ : /No opening hours given/).test(body),
        body.slice(0, 500));
  await page.close();

  // Hours that could not be read are not guessed at.
  db.hours = 'fail';
  page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, false);
  await toSalon(page, arabic);
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(700);
  body = await text(page);
  check(`${L}: hours that failed to load are not guessed at`,
        !/Open now|مفتوح الآن|Closed now|مغلق الآن/.test(body) && body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'),
        body.slice(0, 500));

  // Profile reports this browser's real notification state, not a fixed "On".
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: arabic ? /^حسابي$/ : /^Profile$/ }).first().click();
  await page.waitForTimeout(500);
  body = await text(page);
  check(`${L}: Profile does not claim notifications are on when nothing was allowed`,
        !(arabic ? /الإشعارات\s*مفعّلة/ : /Notifications\s*On/).test(body), body.slice(0, 500));
  await page.close();

  // An owner awaiting review is told so, and shown no invented figures.
  Object.assign(db, { hours: 'always', published: false, verified: false });
  page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, true);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(600);
  body = await text(page);
  check(`${L}: an owner awaiting review is not told they are verified`,
        (arabic ? /بانتظار المراجعة/ : /Awaiting review/).test(body) && !/Al Olaya, Riyadh · Verified/.test(body),
        body.slice(0, 400));
  check(`${L}: and is shown no invented photo count or rating`,
        !/5 photos|5 صور|4\.9 ★/.test(body), body.slice(0, 700));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
