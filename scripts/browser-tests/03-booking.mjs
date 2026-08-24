import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '11111111-1111-1111-1111-111111111111';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000001';
const SERVICE = 'cccccccc-0000-0000-0000-000000000001';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'me@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const db = { rpc: [], reject: null, booking: null };

function slots() {
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  for (let m = 10 * 60; m + 45 <= 22 * 60; m += 30) {
    out.push({ slot_at: new Date(d.getTime() + (m - 180) * 60000).toISOString(),
               is_free: true, staff_free: 2 });
  }
  return out;
}

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('rpc/create_booking')) {
      const body = JSON.parse(req.postData() || '{}');
      db.rpc.push({ fn: 'create_booking', body });
      if (db.reject) { const e = db.reject; db.reject = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) }); }
      db.booking = { booking_id: 'bk1', reference: 'SL-A1B2C3D4',
                     staff_id: 'st1', total_halalas: 13800 };
      return ok(route, [db.booking]);
    }
    if (url.includes('rpc/reschedule_booking')) {
      const body = JSON.parse(req.postData() || '{}');
      db.rpc.push({ fn: 'reschedule_booking', body });
      if (db.reject) { const e = db.reject; db.reject = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) }); }
      return ok(route, [{ staff_id: 'st2' }]);
    }
    if (url.includes('rpc/available_slots')) return ok(route, slots());
    if (url.includes('rpc/salon_')) return ok(route, []);

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'customer',
      full_name: 'Nora', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, slug: 'maison-noir',
      name_en: 'Maison Noir', name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر',
      category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا',
      phone: null, city: 'Riyadh', cr_number: '1010', is_published: true, is_verified: true,
      slot_step_minutes: 30 }]);
    if (url.includes('/rest/v1/services')) return ok(route, [{ id: SERVICE, salon_id: SALON,
      name_en: 'Signature Haircut', name_ar: 'قص شعر', duration_minutes: 45,
      price_halalas: 15000, discount_percent: 20, is_active: true, is_archived: false, sort_order: 0 }]);
    if (url.includes('/rest/v1/staff')) return ok(route, [{ id: 'st1', salon_id: SALON,
      name_en: 'Layla A.', name_ar: 'ليلى ع.', role_en: 'Stylist', role_ar: 'مصففة',
      initials: 'LA', is_active: true, is_archived: false, sort_order: 0 }]);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, []);
    if (url.includes('/rest/v1/working_hours')) return ok(route, []);
    if (url.includes('/rest/v1/bookings')) return ok(route, []);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }

  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByText('Maison Noir').first().click();
  await page.waitForTimeout(600);
  await page.locator('.scr button').filter({ hasText: /Signature Haircut|قص شعر/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue|متابعة/i }).last().click();
  await page.waitForTimeout(600);
  // Take "any professional" — the case this whole migration is about.
  await page.locator('.scr button').filter({ hasText: /Any professional|أي مختص/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Pick a time|اختر الوقت/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '15:00' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue to payment|المتابعة للدفع/i }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Confirm|تأكيد/i }).last().click();
  await page.waitForTimeout(1200);

  const sent = db.rpc.find((r) => r.fn === 'create_booking');
  check(`${L}: booking goes through create_booking()`, Boolean(sent));
  check(`${L}: the browser sends no price`,
        sent && !JSON.stringify(sent.body).match(/halalas/i), JSON.stringify(sent?.body));
  check(`${L}: it sends service ids, not names or prices`,
        sent && Array.isArray(sent.body.p_service_ids)
        && sent.body.p_service_ids[0] === SERVICE, JSON.stringify(sent?.body.p_service_ids));
  check(`${L}: "any professional" is sent as nobody`, sent && sent.body.p_staff_id === null);

  const body = await page.locator('body').innerText();
  check(`${L}: the confirmation shows the reference the database made`,
        body.includes('SL-A1B2C3D4'), body.slice(0, 200));
  if (!arabic) await page.screenshot({ path: 'shots/booked.png' });
  await page.close();
}

// The failures the function can return, each worded for the customer.
for (const [code, needle, label] of [
  ['SL002', "isn't open then", 'closed'],
  ['SL003', 'just taken', 'nobody free'],
  ['SL001', 'Choose a service', 'service not bookable'],
]) {
  db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  db.reject = { code, message: 'refused' };
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I'm a customer/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByText('Maison Noir').first().click();
  await page.waitForTimeout(600);
  await page.locator('.scr button').filter({ hasText: /Signature Haircut/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue/i }).last().click();
  await page.waitForTimeout(600);
  await page.locator('.scr button').filter({ hasText: /Any professional/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Pick a time/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '15:00' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue to payment/i }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Confirm/i }).last().click();
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText();
  check(`${code} reads as "${label}"`, body.includes(needle), body.slice(-220));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} booking checks passed.`);
process.exit(failed ? 1 : 0);
