// Checkout, photo descriptions and keyboard focus.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/20-checkout-and-access.mjs
//
// From the compliance pass: checkout said "Confirm & pay" and listed saved
// cards ("mada •••• 4921"), a wallet balance and instalment offers that did
// not exist, when nothing is paid through Saloni at all; photographs could not
// be described for screen readers; and five text fields switched the keyboard
// focus outline off. Fails against the build before the change.
import { chromium } from 'playwright';

// The stable path; the versioned one under it changes when the image updates.
const BROWSER = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
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
  await page.locator('.scr button').filter({ hasText: /Any professional|أي مختص/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Pick a time|اختر الوقت/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '15:00' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue to review|المتابعة للمراجعة/i }).click();
  await page.waitForTimeout(700);
  const body = (await page.locator('body').innerText()).replace(/\n/g, ' ');

  check(`${L}: checkout says "Confirm booking", not "pay"`,
        (arabic ? /تأكيد الحجز/ : /Confirm booking/).test(body) && !/Confirm & pay|تأكيد والدفع/.test(body),
        body.slice(-300));
  check(`${L}: it says payment happens at the salon and Saloni adds no fees`,
        arabic ? /تدفع للصالون عند زيارتك/.test(body) && /لا يضيف صالوني أي رسوم/.test(body)
               : /You pay the salon at your visit/.test(body) && /Saloni adds no fees/.test(body),
        body.slice(0, 600));
  check(`${L}: no saved card, wallet balance or instalment offer is shown`,
        !/•••• \d{4}|Wallet balance|رصيد المحفظة|Tabby|Tamara|interest-free|بدون فوائد/.test(body),
        body.slice(0, 900));
  check(`${L}: the total including VAT is on screen before confirming`,
        (arabic ? /الإجمالي|المجموع/ : /Total/).test(body) && /VAT|ضريبة/.test(body), body.slice(0, 900));

  await page.getByRole('button', { name: /Confirm booking|تأكيد الحجز/ }).last().click();
  await page.waitForTimeout(1200);
  const done = (await page.locator('body').innerText()).replace(/\n/g, ' ');
  check(`${L}: the confirmation does not call the amount paid`,
        (arabic ? /يُدفع في الصالون/ : /To pay at the salon/).test(done) && !/\bPaid\b|المدفوع/.test(done),
        done.slice(0, 600));
  // reminders_on() is not stubbed true here, so nothing is promised.
  check(`${L}: no reminder is offered while reminders are not being sent`,
        !/Remind me|ذكّرني/.test(done), done.slice(0, 600));
  await page.close();
}

// Keyboard focus is visible on a text field, which used to switch it off.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I'm a customer/i }).first().click();
  await page.waitForTimeout(800);
  const search = page.getByRole('searchbox').or(page.getByPlaceholder(/Search by salon name/)).first();
  await search.focus();
  const outline = await search.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  check('a focused text field shows a visible outline', /solid 2px/.test(outline), outline);
  await page.close();
}

// An owner describes a photograph in both languages, and both are written.
{
  const OWNER = '44444444-4444-4444-4444-444444444444';
  const SALON_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
  const owner = { ...session, user: { ...session.user, id: OWNER } };
  const sent = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return reply(route, owner.user);
    if (url.includes('/rest/v1/profiles')) return reply(route, { id: OWNER, role: 'vendor', full_name: '', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salon_media')) {
      if (req.method() === 'PATCH') { sent.push(JSON.parse(req.postData() || '{}')); return reply(route, []); }
      return reply(route, [{ id: 'm1', salon_id: SALON_ID, storage_path: `${SALON_ID}/gallery/a.jpg`,
        alt_text: '', alt_text_ar: '', is_cover: true, sort_order: 0 }]);
    }
    if (url.includes('/rest/v1/salons')) return reply(route, [{ id: SALON_ID, owner_id: OWNER, slug: 'r',
      name_en: 'Rose & Oud', name_ar: 'وردة وعود', is_verified: true, is_published: true, closed_at: null,
      waitlist_enabled: true, slot_step_minutes: 30, city: 'Riyadh', area_en: '', area_ar: '', tags_en: '',
      tags_ar: '', category_en: '', category_ar: '', phone: null, latitude: null, longitude: null }]);
    return reply(route, []);
  });
  await page.addInitScript(([r, v]) => window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, owner]);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /More/i }).last().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Photo gallery/ }).first().click();
  await page.waitForTimeout(900);
  const describe = page.getByRole('button', { name: /\+ Describe/ });
  check('an undescribed photograph is marked for describing', (await describe.count()) === 1);
  await describe.click();
  await page.waitForTimeout(300);
  await page.getByLabel('In English').fill('Two styling chairs by a window');
  await page.getByLabel('In Arabic').fill('كرسيا تصفيف بجانب نافذة');
  await page.getByRole('button', { name: /^Save changes$/ }).click();
  await page.waitForTimeout(800);
  check('both descriptions are written to the photograph',
        sent.some((b) => b.alt_text === 'Two styling chairs by a window' && b.alt_text_ar === 'كرسيا تصفيف بجانب نافذة'),
        JSON.stringify(sent));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
