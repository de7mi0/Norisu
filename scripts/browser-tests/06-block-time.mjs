// The owner taking time off sale, from the calendar.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/06-block-time.mjs
//
// The database side needs no proving here — available_slots() and
// create_booking() have honoured time_off since 0003 and 0008, and the
// assertions cover that. What these check is that the app writes the right row
// and shows what is already blocked.
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

const staff = [
  { id: 'st1', salon_id: SALON, name_en: 'Layla A.', name_ar: 'ليلى ع.', role_en: 'Stylist',
    role_ar: 'مصففة', initials: 'LA', is_active: true, is_archived: false, sort_order: 0 },
  { id: 'st2', salon_id: SALON, name_en: 'Sara M.', name_ar: 'سارة م.', role_en: 'Stylist',
    role_ar: 'مصففة', initials: 'SM', is_active: true, is_archived: false, sort_order: 1 },
];

const db = { blocks: [], writes: [], deletes: [], rejectNext: null };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('/rest/v1/time_off')) {
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        db.writes.push(body);
        if (db.rejectNext) {
          const e = db.rejectNext; db.rejectNext = null;
          return route.fulfill({ status: 403, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) });
        }
        db.blocks.push({ id: `tb${db.blocks.length + 1}`, staff_id: body.staff_id,
          starts_at: body.starts_at, ends_at: body.ends_at, reason: body.reason });
        return ok(route, []);
      }
      if (method === 'DELETE') {
        db.deletes.push(url);
        db.blocks = [];
        return ok(route, []);
      }
      return ok(route, db.blocks);
    }

    if (url.includes('rpc/salon_day')) return ok(route, []);
    if (url.includes('rpc/salon_stats')) return ok(route, [{ bookings_today: 0,
      bookings_yesterday: 0, booked_halalas: 0, occupancy_percent: 0, is_open: true,
      rating: null, review_count: 0 }]);
    if (url.includes('rpc/salon_reviews')) return ok(route, []);
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, slug: 'maison-noir',
      name_en: 'Maison Noir', name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر',
      category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا',
      phone: null, city: 'Riyadh', cr_number: '1010', is_published: true, is_verified: true,
      owner_id: USER, slot_step_minutes: 30 }]);
    if (url.includes('/rest/v1/services')) return ok(route, []);
    if (url.includes('/rest/v1/staff')) return ok(route, staff);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, []);
    if (url.includes('/rest/v1/working_hours')) return ok(route, [{ staff_id: null,
      day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' }]);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toCalendar(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالوناً/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$|^رجوع$/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Calendar|التقويم/i }).last().click();
  await page.waitForTimeout(900);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.blocks = []; db.writes = []; db.deletes = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toCalendar(page, arabic);

  // The pill used to be a styled div with no handler at all.
  const pill = page.getByRole('button', { name: arabic ? 'حجب وقت' : 'Block out time' }).first();
  check(`${L}: the calendar offers blocking time out`, await pill.isVisible());
  check(`${L}: and it is a real button, not decoration`, await pill.isEnabled());

  await pill.click();
  await page.waitForTimeout(500);
  let body = await page.locator('body').innerText();
  check(`${L}: it opens the sheet`,
        body.includes(arabic ? 'حجب وقت' : 'Block out time'));
  check(`${L}: which says what blocking does`,
        body.includes(arabic ? 'لن يُقبل أي حجز' : 'Nothing can be booked'));
  check(`${L}: and defaults to the whole salon`,
        body.includes(arabic ? 'الصالون بالكامل' : 'The whole salon'));

  // Set a range, name one stylist, give a reason.
  const selects = page.locator('.sheet select, form select');
  await selects.nth(0).selectOption('st1');
  await selects.nth(1).selectOption('13:00');
  await selects.nth(2).selectOption('14:30');
  await page.locator('form input[type="text"]').first().fill('Running late');
  await page.getByRole('button', { name: arabic ? 'احجب هذا الوقت' : 'Block this time' }).click();
  await page.waitForTimeout(1200);

  const wrote = db.writes[0];
  check(`${L}: it writes a time_off row`, Boolean(wrote), JSON.stringify(db.writes));
  check(`${L}: against the owner's own salon`, wrote?.salon_id === SALON);
  check(`${L}: for the stylist chosen, not the whole salon`, wrote?.staff_id === 'st1',
        JSON.stringify(wrote?.staff_id));
  check(`${L}: with the range the owner picked`,
        typeof wrote?.starts_at === 'string' && typeof wrote?.ends_at === 'string' &&
        new Date(wrote.ends_at) > new Date(wrote.starts_at),
        JSON.stringify([wrote?.starts_at, wrote?.ends_at]));
  check(`${L}: and the reason`, wrote?.reason === 'Running late', JSON.stringify(wrote?.reason));

  body = await page.locator('body').innerText();
  check(`${L}: the blocked period is listed`, body.includes('13:00'), body.slice(0, 240).replace(/\n/g, ' '));
  check(`${L}: named against the person it applies to`,
        body.includes(arabic ? 'ليلى' : 'Layla'), body.slice(0, 240).replace(/\n/g, ' '));

  // And it can be put back on sale.
  await page.getByRole('button', { name: arabic ? 'إتاحة هذا الوقت' : 'Free this time' }).first().click();
  await page.waitForTimeout(1000);
  check(`${L}: freeing it deletes the row`, db.deletes.length === 1, String(db.deletes.length));
  body = await page.locator('body').innerText();
  check(`${L}: and it leaves the day`, !body.includes('Running late'));
  await page.close();
}

// A salon that is not yours must not be writable, and the app should say so
// rather than appearing to succeed.
{
  db.blocks = []; db.writes = []; db.deletes = [];
  db.rejectNext = { code: '42501', message: 'new row violates row-level security policy' };
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toCalendar(page, false);
  await page.getByRole('button', { name: 'Block out time' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Block this time' }).click();
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText();
  check('a refused write says whose it is, rather than looking saved',
        /Only the salon’s owner|owner can change/i.test(body),
        body.slice(0, 200).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
