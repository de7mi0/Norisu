// Closing a salon, so its owner can leave.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/12-close-salon.mjs
//
// This is a store requirement wearing a feature's clothes. Both stores demand
// account deletion from inside the app; delete_my_account() refuses anybody
// who owns a salon; and until 0019 there was no way to stop owning one. A
// reviewer who registers a salon — which the vendor side invites on its first
// screen — and then tries to delete their account would have hit a dead end
// and read it as the requirement being missing.
//
// So half of these check a reviewer can find it and use it, and the other half
// check it cannot happen by accident: closing a salon is irreversible from
// inside the app and shuts a business.
//
// What closing actually DOES to the rows is assertions 116-118's business, not
// these: a stub agrees to anything.
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

const db = { calls: 0, sent: null, rejectNext: null, closed: false };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

function salonRow() {
  return [{
    id: SALON, owner_id: db.closed ? null : USER, slug: 'rose-oud',
    name_en: 'Rose & Oud', name_ar: 'وردة وعود',
    is_verified: true, is_published: !db.closed, closed_at: db.closed ? '2026-09-21T09:00:00Z' : null,
    waitlist_enabled: true, slot_step_minutes: 30, city: 'Riyadh',
    area_en: 'Al Olaya', area_ar: 'العليا', tags_en: '', tags_ar: '',
    category_en: '', category_ar: '', phone: '+966500000004',
    latitude: null, longitude: null,
  }];
}

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });

    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('rpc/close_my_salon')) {
      db.calls += 1;
      db.sent = JSON.parse(req.postData() || '{}');
      if (db.rejectNext) {
        const e = db.rejectNext; db.rejectNext = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) });
      }
      db.closed = true;
      return ok(route, null);
    }

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Salon Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, db.closed ? [] : salonRow());
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

// Entering the vendor portal lands on Business details, which is where closing
// lives — so a reviewer looking for it does not have to go anywhere.
async function toBusinessDetails(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(1100);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.calls = 0; db.sent = null; db.rejectNext = null; db.closed = false;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toBusinessDetails(page, arabic);

  let body = await page.locator('body').innerText();
  check(`${L}: an owner is offered a way to close the salon`,
        body.includes(arabic ? 'إغلاق هذا الصالون' : 'Close this salon'),
        body.slice(0, 300).replace(/\n/g, ' '));

  await page.getByRole('button', { name: arabic ? /^إغلاق هذا الصالون$/ : /^Close this salon$/ })
    .first().click();
  await page.waitForTimeout(500);
  body = await page.locator('body').innerText();

  check(`${L}: it says what stops`,
        arabic ? /يتوقف صالونك عن العمل/.test(body) : /Your salon stops trading/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // The half a confirmation dialog normally leaves out, and the half an owner
  // most needs: their records are not being erased.
  check(`${L}: and what survives it`,
        arabic ? /يبقى ما أنجزه فعلاً/.test(body) : /What it has already done stays/.test(body),
        body.slice(0, 500).replace(/\n/g, ' '));

  check(`${L}: and that it releases the account`,
        arabic ? /يُحرر حسابك/.test(body) : /releases your account/.test(body),
        body.slice(0, 500).replace(/\n/g, ' '));

  // The accident guard. Shutting a business must not be one mis-tap away.
  const go = page.getByRole('button', { name: arabic ? /^أغلقه نهائياً/ : /^Close it for good/ });
  check(`${L}: the close button starts disabled`, await go.isDisabled());
  await go.click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  check(`${L}: and clicking it anyway sends nothing`, db.calls === 0, String(db.calls));

  await page.locator('#close-salon-confirm').fill('CLOS');
  await page.waitForTimeout(200);
  check(`${L}: a half-typed word does not arm it`, await go.isDisabled());

  await page.locator('#close-salon-confirm').fill('CLOSE');
  await page.waitForTimeout(200);
  check(`${L}: typing the word arms it`, !(await go.isDisabled()));

  await go.click();
  await page.waitForTimeout(1100);
  body = await page.locator('body').innerText();

  check(`${L}: the salon is closed through the function`, db.calls === 1, String(db.calls));
  check(`${L}: and it names the salon it is closing`, db.sent?.p_salon_id === SALON,
        JSON.stringify(db.sent));
  check(`${L}: the owner is told`,
        arabic ? /تم إغلاق صالونك/.test(body) : /Your salon has been closed/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));

  await page.close();
}

// A refusal explains itself and leaves the sheet open, so nothing is retyped.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.calls = 0; db.closed = false;
  await install(page);
  await toBusinessDetails(page, false);
  await page.getByRole('button', { name: /^Close this salon$/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator('#close-salon-confirm').fill('CLOSE');
  db.rejectNext = { code: 'SL008', message: 'this salon is already closed' };
  await page.getByRole('button', { name: /^Close it for good/ }).click();
  await page.waitForTimeout(900);

  const body = await page.locator('body').innerText();
  check('an already-closed salon says so rather than failing vaguely',
        /already closed/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  check('and the sheet stays open, so nothing is retyped',
        /Type CLOSE to confirm/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

// The reason this exists: the refusal on the customer side now points at a way
// out that actually exists, rather than telling somebody to message support.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I'm a customer/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Profile/i }).last().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Delete my account$/ }).click();
  await page.waitForTimeout(400);
  await page.locator('input[type="text"]').last().fill('DELETE');

  await page.route('**/rpc/delete_my_account*', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 'SL007', message: 'this account owns a salon' }) }));
  await page.getByRole('button', { name: /^Delete for good$/ }).click();
  await page.waitForTimeout(900);

  const body = await page.locator('body').innerText();
  check('a salon owner is pointed at closing rather than at support',
        /close the salon first/.test(body) && !/message us/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  await page.close();
}

// Somebody who owns no salon is not offered it — there is nothing to close,
// and the registration form should not carry a destructive action.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.route(`**/${REF}.supabase.co/**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText();
  check('a visitor registering a salon is not offered a way to close one',
        !body.includes('Close this salon'), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
