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

function iso(h, m) {
  const d = new Date(); d.setHours(h - 3, m, 0, 0); return d.toISOString();
}

// Mutable fake backend, so a write actually changes what the next read returns.
const db = {
  appt: {
    booking_id: 'b1', reference: 'SL-K3P2A9',
    starts_at: iso(10, 0), ends_at: iso(10, 45), status: 'confirmed',
    staff_name_en: 'Layla A.', staff_name_ar: 'ليلى ع.', customer_name: 'Huda A.',
    services_en: ['Signature Haircut'], services_ar: ['قص شعر'], total_halalas: 13800,
  },
  review: {
    review_id: 'r1', rating: '2.0', body: 'Waited twenty minutes past my slot.',
    reply: '', replied_at: null, is_published: true,
    created_at: '2026-08-14T13:00:00Z', customer_name: 'Huda A.',
  },
  rejectNext: null,   // set to an error to simulate a refused write
  writes: [],
};

const staff = [
  { id: 'st1', salon_id: SALON, name_en: 'Layla A.', name_ar: 'ليلى ع.', role_en: 'Stylist',
    role_ar: 'مصففة', initials: 'LA', is_active: true, is_archived: false, sort_order: 0 },
  { id: 'st2', salon_id: SALON, name_en: 'Sara M.', name_ar: 'سارة م.', role_en: 'Stylist',
    role_ar: 'مصففة', initials: 'SM', is_active: true, is_archived: false, sort_order: 1 },
];

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  await page.route(`**/${REF}.supabase.co/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    if (url.includes('/rest/v1/bookings') && method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      db.writes.push(body);
      if (db.rejectNext) {
        const e = db.rejectNext; db.rejectNext = null;
        return route.fulfill({ status: 409, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) });
      }
      if (body.status) db.appt.status = body.status;
      if ('staff_id' in body) {
        const person = staff.find((s) => s.id === body.staff_id);
        db.appt.staff_name_en = person ? person.name_en : null;
        db.appt.staff_name_ar = person ? person.name_ar : null;
      }
      return ok(route, []);
    }

    if (url.includes('rpc/reply_to_review')) {
      const body = JSON.parse(req.postData() || '{}');
      db.writes.push(body);
      db.review.reply = (body.p_reply ?? '').trim();
      db.review.replied_at = db.review.reply ? new Date().toISOString() : null;
      return ok(route, null);
    }

    if (url.includes('rpc/salon_day')) return ok(route, [db.appt]);
    if (url.includes('rpc/salon_stats')) return ok(route, [{ bookings_today: 1,
      bookings_yesterday: 0, booked_halalas: 13800, occupancy_percent: 8, is_open: true,
      rating: '2.0', review_count: 1 }]);
    if (url.includes('rpc/salon_reviews')) return ok(route, [db.review]);
    if (url.includes('rpc/available_slots')) return ok(route, []);

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, slug: 'maison-noir',
      name_en: 'Maison Noir', name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر',
      category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا',
      phone: null, city: 'Riyadh', cr_number: '1010', is_published: true, is_verified: true,
      owner_id: USER, slot_step_minutes: 30 }]);
    if (url.includes('/rest/v1/services')) return ok(route, []);
    if (url.includes('/rest/v1/staff')) return ok(route, staff);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, [{ salon_id: SALON, rating: 2.0, review_count: 1 }]);
    if (url.includes('/rest/v1/working_hours')) return ok(route, [{ staff_id: null,
      day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' }]);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (name, okv, detail = '') => {
  results.push(okv);
  console.log(`${okv ? 'PASS' : 'FAIL'}  ${name}${okv || !detail ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch({ executablePath: BROWSER });

async function toCalendar(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Calendar ›|التقويم/ }).first().click();
  await page.waitForTimeout(900);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.appt.status = 'confirmed';
  db.appt.staff_name_en = 'Layla A.'; db.appt.staff_name_ar = 'ليلى ع.';
  db.writes = [];

  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toCalendar(page, arabic);

  // Open the appointment.
  await page.getByRole('button').filter({ hasText: 'Huda A.' }).first().click();
  await page.waitForTimeout(500);
  let body = await page.locator('body').innerText();
  check(`${L}: tapping an appointment opens the sheet`,
        body.includes(arabic ? 'الموعد' : 'Appointment'));
  const actions = async () =>
    (await page.locator('[role="dialog"] button').allInnerTexts()).map((x) => x.trim());
  const offered = await actions();
  const confirmLabel = arabic ? 'تأكيد' : 'Confirm';
  const completeLabel = arabic ? 'وضع كمكتمل' : 'Mark completed';
  check(`${L}: only the legal next steps are offered`,
        offered.includes(completeLabel) && !offered.includes(confirmLabel),
        `offered: ${offered.join(' | ')}`);
  if (!arabic) await page.screenshot({ path: 'shots/appt-sheet.png' });

  // Complete it, and watch the calendar follow.
  await page.getByRole('button', { name: arabic ? 'وضع كمكتمل' : 'Mark completed' }).click();
  await page.waitForTimeout(900);
  body = await page.locator('body').innerText();
  check(`${L}: the write sent the new status`,
        db.writes.some((w) => w.status === 'completed'), JSON.stringify(db.writes));
  check(`${L}: the calendar row shows it`, body.includes(arabic ? 'مكتمل' : 'Completed'));
  check(`${L}: the sheet closed itself`, !body.includes(arabic ? 'نقل إلى مختص آخر' : 'Move to another specialist'));

  // A finished appointment has nowhere left to go.
  await page.getByRole('button').filter({ hasText: 'Huda A.' }).first().click();
  await page.waitForTimeout(400);
  const afterwards = await actions();
  check(`${L}: a completed appointment offers no further moves`,
        !afterwards.includes(completeLabel)
        && !afterwards.includes(arabic ? 'إلغاء هذا الموعد' : 'Cancel this appointment'),
        `offered: ${afterwards.join(' | ')}`);
  await page.getByRole('button', { name: arabic ? 'إغلاق' : 'Close' }).first().click();
  await page.waitForTimeout(300);

  // Reassign, including the collision the exclusion constraint produces.
  db.appt.status = 'confirmed';
  await page.reload({ waitUntil: 'networkidle' });
  await toCalendar(page, arabic);
  await page.getByRole('button').filter({ hasText: 'Huda A.' }).first().click();
  await page.waitForTimeout(400);
  db.rejectNext = { code: '23P01', message: 'conflicting key value violates exclusion constraint' };
  await page.getByRole('button', { name: arabic ? 'سارة م.' : 'Sara M.' }).click();
  await page.waitForTimeout(800);
  body = await page.locator('body').innerText();
  check(`${L}: a clash says the specialist is busy, not "could not save"`,
        body.includes(arabic ? 'محجوز في هذا الوقت' : 'already booked at this time'),
        body.slice(0, 160));

  // And a clean reassign works.
  await page.getByRole('button', { name: arabic ? 'سارة م.' : 'Sara M.' }).click();
  await page.waitForTimeout(900);
  body = await page.locator('body').innerText();
  check(`${L}: reassigning moves the appointment`, body.includes(arabic ? 'سارة م.' : 'Sara M.'));

  await page.close();
}

// Review replies.
{
  db.review.reply = '';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Back$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /More/i }).last().click();
  await page.waitForTimeout(400);
  await page.getByText(/^Reviews/).first().click();
  await page.waitForTimeout(900);

  let body = await page.locator('body').innerText();
  check('reviews: an unanswered review invites a reply', body.includes('Reply to this review'));

  await page.getByText('Reply to this review').first().click();
  await page.waitForTimeout(400);
  await page.locator('input').first().fill('Sorry about the wait — we have added staff on Thursdays.');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(900);

  check('reviews: the reply went through the 0007 function, not a table write',
        db.writes.some((w) => w.p_review_id === 'r1' && /added staff/.test(w.p_reply ?? '')),
        JSON.stringify(db.writes.slice(-1)));
  body = await page.locator('body').innerText();
  check('reviews: the reply is shown on the review', body.includes('added staff on Thursdays'));
  await page.screenshot({ path: 'shots/review-reply.png' });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} appointment checks passed.`);
process.exit(failed ? 1 : 0);
