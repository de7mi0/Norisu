// The salon writing its own booking: a walk-in at the counter, or a caller.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/08-walkin.mjs
//
// The database side is proven by assertions 91–94 — who may write one, that it
// holds a chair, that a booking always belongs to somebody, and that the only
// phone number a salon ever gets is one it typed itself. What these check is
// the half a stub can speak to: that the app sends the right call, sends **no
// price** in it, says something useful when the write is refused, and shows a
// walk-in on the calendar as what it is.
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

const services = [
  { id: 'sv1', salon_id: SALON, name_en: 'Signature Haircut', name_ar: 'قص شعر',
    duration_minutes: 45, price_halalas: 15000, discount_percent: 20, is_active: true,
    is_archived: false, sort_order: 0, category_en: 'Hair', category_ar: 'شعر' },
  { id: 'sv2', salon_id: SALON, name_en: 'Luxury Facial', name_ar: 'عناية فاخرة',
    duration_minutes: 60, price_halalas: 22000, discount_percent: 0, is_active: true,
    is_archived: false, sort_order: 1, category_en: 'Skin', category_ar: 'بشرة' },
];

// What salon_day() gives back. One booking made through the app and one the
// salon wrote itself, so the screen has to tell them apart.
const today = [
  { booking_id: 'bk1', reference: 'SL-APP0001', starts_at: null, ends_at: null,
    status: 'confirmed', staff_name_en: 'Layla A.', staff_name_ar: 'ليلى ع.',
    customer_name: 'Huda A.', customer_phone: null, is_walk_in: false,
    services_en: ['Signature Haircut'], services_ar: ['قص شعر'], total_halalas: 13800 },
  { booking_id: 'bk2', reference: 'SL-WALK001', starts_at: null, ends_at: null,
    status: 'confirmed', staff_name_en: 'Sara M.', staff_name_ar: 'سارة م.',
    customer_name: 'Sara at the counter', customer_phone: '0501112233', is_walk_in: true,
    services_en: ['Luxury Facial'], services_ar: ['عناية فاخرة'], total_halalas: 25300 },
];

/** Two fixed times today, in the salon's own timezone. */
function at(hhmm) {
  const now = new Date();
  const pad = (n) => `${n}`.padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return new Date(`${day}T${hhmm}:00+03:00`).toISOString();
}
today[0].starts_at = at('10:00'); today[0].ends_at = at('10:45');
today[1].starts_at = at('12:00'); today[1].ends_at = at('13:00');

const db = { calls: [], rejectNext: null };

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

    if (url.includes('rpc/create_walkin_booking')) {
      const body = JSON.parse(req.postData() || '{}');
      db.calls.push(body);
      if (db.rejectNext) {
        const e = db.rejectNext; db.rejectNext = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) });
      }
      return ok(route, [{ booking_id: 'bk9', reference: 'SL-NEW0009',
                          staff_id: body.p_staff_id ?? 'st1', total_halalas: 13800 }]);
    }

    if (url.includes('rpc/salon_day')) return ok(route, today);
    if (url.includes('rpc/salon_stats')) return ok(route, [{ bookings_today: today.length,
      bookings_yesterday: 1, booked_halalas: 39100, occupancy_percent: 20, is_open: true,
      rating: null, review_count: 0 }]);
    if (url.includes('rpc/salon_reviews')) return ok(route, []);
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, slug: 'maison-noir',
      name_en: 'Maison Noir', name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر',
      category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا',
      phone: null, city: 'Riyadh', cr_number: '1010', is_published: true, is_verified: true,
      owner_id: USER, slot_step_minutes: 30 }]);
    if (url.includes('/rest/v1/services')) return ok(route, services);
    if (url.includes('/rest/v1/staff')) return ok(route, staff);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, []);
    if (url.includes('/rest/v1/working_hours')) return ok(route, [{ staff_id: null,
      day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' }]);
    if (url.includes('/rest/v1/time_off')) return ok(route, []);
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
  db.calls = []; db.rejectNext = null;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toCalendar(page, arabic);

  // What the calendar already shows, before anything is written.
  let body = await page.locator('body').innerText();
  check(`${L}: a walk-in is marked as one on the calendar`,
        body.includes(arabic ? 'حضور مباشر' : 'Walk-in'), body.slice(0, 300).replace(/\n/g, ' '));
  check(`${L}: and it is filed under the name the salon typed`,
        body.includes('Sara at the counter'), body.slice(0, 300).replace(/\n/g, ' '));
  // A Latin name in an Arabic paragraph reorders without isolating: "Huda A."
  // renders as ".Huda A", the full stop on the wrong end. Owner-typed names
  // make that everyday, so the name is a <bdi> and this is the guard.
  const isolated = await page.locator('bdi').filter({ hasText: 'Sara at the counter' }).count();
  check(`${L}: a name of unknown script is isolated from the text around it`,
        isolated > 0, String(isolated));
  check(`${L}: an app booking is not marked as a walk-in`,
        (body.match(/Walk-in|حضور مباشر/g) || []).length === 1,
        String((body.match(/Walk-in|حضور مباشر/g) || []).length));

  // Writing one.
  await page.getByRole('button', { name: arabic ? /^إضافة حجز$/ : /^Add a booking$/ }).first().click();
  await page.waitForTimeout(500);
  body = await page.locator('body').innerText();
  check(`${L}: the sheet says what it is for`,
        /counter or on the phone|إلى الصالون أو يتصل/.test(body),
        body.slice(0, 200).replace(/\n/g, ' '));

  // Saving with nothing filled in is refused, and nothing is sent.
  await page.getByRole('button', { name: arabic ? /^أضف الحجز$/ : /^Add booking$/ }).click();
  await page.waitForTimeout(600);
  body = await page.locator('body').innerText();
  check(`${L}: a booking with no name is refused, with a reason`,
        /A name is needed|الاسم مطلوب/.test(body), body.slice(0, 200).replace(/\n/g, ' '));
  check(`${L}: and nothing was sent`, db.calls.length === 0, JSON.stringify(db.calls));

  await page.locator('input[type="text"]').first().fill('Nora at the counter');
  await page.locator('input[type="tel"]').first().fill('0501112233');
  await page.getByRole('button', { name: arabic ? /^أضف الحجز$/ : /^Add booking$/ }).click();
  await page.waitForTimeout(600);
  body = await page.locator('body').innerText();
  check(`${L}: a booking with no service is refused too`,
        /at least one service|خدمة واحدة على الأقل/.test(body),
        body.slice(0, 200).replace(/\n/g, ' '));
  check(`${L}: and still nothing was sent`, db.calls.length === 0, JSON.stringify(db.calls));

  // Now a complete one.
  await page.getByRole('button', { name: arabic ? /^قص شعر$/ : /^Signature Haircut$/ }).click();
  await page.waitForTimeout(200);
  body = await page.locator('body').innerText();
  // 150.00 less the service's own 20% is 120.00 — read off the salon's rows,
  // not typed in here, which is the same figure Postgres will arrive at.
  const preview = await page.locator('text=/45 .*(SAR 120|120)/').count();
  check(`${L}: it previews the length and price from the salon's own service`,
        preview > 0, (await page.locator('body').innerText()).slice(-260).replace(/\n/g, ' '));

  await page.getByRole('button', { name: arabic ? /^أضف الحجز$/ : /^Add booking$/ }).click();
  await page.waitForTimeout(900);

  const call = db.calls[0];
  check(`${L}: the booking is written through create_walkin_booking()`,
        Boolean(call), JSON.stringify(db.calls));
  check(`${L}: the name goes with it`,
        call?.p_guest_name === 'Nora at the counter', JSON.stringify(call));
  check(`${L}: so does the number the salon wrote down`,
        call?.p_guest_phone === '0501112233', JSON.stringify(call));
  check(`${L}: the service is named by id, and only the one chosen`,
        Array.isArray(call?.p_service_ids) && call.p_service_ids.length === 1
          && call.p_service_ids[0] === 'sv1',
        JSON.stringify(call?.p_service_ids));
  check(`${L}: "whoever is free" is sent as no staff member, not as a guess`,
        call?.p_staff_id === null, JSON.stringify(call?.p_staff_id));
  // The headline: as with a customer's booking, the browser states no price.
  check(`${L}: the browser sends no price of any kind`,
        call ? !Object.keys(call).some((k) => /price|total|halalas|vat|subtotal/i.test(k)) : false,
        JSON.stringify(Object.keys(call || {})));
  check(`${L}: the time is sent as an instant, not as a wall clock`,
        typeof call?.p_starts_at === 'string' && call.p_starts_at.endsWith('Z'),
        String(call?.p_starts_at));

  body = await page.locator('body').innerText();
  check(`${L}: the owner is told it saved, with the reference`,
        /Booking added|تمت إضافة الحجز/.test(body) && body.includes('SL-NEW0009'),
        body.slice(0, 200).replace(/\n/g, ' '));
  check(`${L}: and the sheet has closed`,
        !/counter or on the phone|إلى الصالون أو يتصل/.test(body));

  await page.close();
}

// A refusal from the database is said in the owner's own words rather than
// swallowed — each of the three that can realistically happen.
for (const [code, wording, english] of [
  ['SL003', /Nobody is free|لا أحد متاح/, 'nobody free'],
  ['23P01', /already booked|محجوز/, 'that chair is taken'],
  ['42501', /owner can add|مالك الصالون/, 'not the owner'],
]) {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.calls = [];
  await install(page);
  await toCalendar(page, false);
  await page.getByRole('button', { name: /^Add a booking$/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator('input[type="text"]').first().fill('Nora');
  await page.getByRole('button', { name: /^Signature Haircut$/ }).click();
  db.rejectNext = { code, message: 'refused' };
  await page.getByRole('button', { name: /^Add booking$/ }).click();
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  check(`a refusal (${code}) is explained: ${english}`,
        wording.test(body), body.slice(0, 200).replace(/\n/g, ' '));
  // The sheet stays open on a refusal, so nothing has to be typed twice.
  check(`and the sheet stays open after ${code}`,
        /counter or on the phone/.test(body), body.slice(0, 160).replace(/\n/g, ' '));
  await page.close();
}

// The phone number is the salon's own note, and only appears where it wrote one.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toCalendar(page, false);

  await page.getByText('Sara at the counter').first().click();
  await page.waitForTimeout(600);
  let body = await page.locator('body').innerText();
  check('the appointment sheet shows the number the salon typed',
        body.includes('0501112233'), body.slice(0, 300).replace(/\n/g, ' '));
  const tel = await page.locator('a[href^="tel:"]').count();
  check('and it is dialable', tel === 1, String(tel));

  await page.getByRole('button', { name: /^(Close|Done|Cancel)$/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.getByText('Huda A.').first().click();
  await page.waitForTimeout(600);
  body = await page.locator('body').innerText();
  check('a customer who booked through the app has no number shown',
        !/05\d{8}|\+9665/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
