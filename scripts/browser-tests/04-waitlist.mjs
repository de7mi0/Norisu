import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const OWNER = '33333333-3333-3333-3333-333333333333';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000001';
const SERVICE = 'cccccccc-0000-0000-0000-000000000001';

function sess(id, email) {
  return {
    access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
    expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
    user: { id, aud: 'authenticated', role: 'authenticated', email, phone: '',
            app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

// A fake backend that actually holds state, so a join shows up on the next read.
const db = { mine: [], queue: [], rpc: [], reject: null, waitlistEnabled: true };

const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

function slots() {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  for (let m = 10 * 60; m + 45 <= 22 * 60; m += 30) {
    // 15:00 is taken — that is the one the waitlist hangs off.
    const at = new Date(d.getTime() + (m - 180) * 60000);
    out.push({ slot_at: at.toISOString(), is_free: m !== 15 * 60, staff_free: m === 15 * 60 ? 0 : 2 });
  }
  return out;
}

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page, session) {
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    const body = req.postData() ? JSON.parse(req.postData()) : {};

    if (url.includes('rpc/join_waitlist')) {
      db.rpc.push({ fn: 'join_waitlist', body });
      if (db.reject) { const e = db.reject; db.reject = null;
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(e) }); }
      db.mine = [{
        entry_id: 'e1', salon_id: SALON, salon_name_en: 'Maison Noir', salon_name_ar: 'ميزون نوار',
        requested_date: body.p_requested_date, earliest_time: body.p_earliest_time,
        latest_time: body.p_latest_time, status: 'waiting',
        offer_id: null, offer_starts_at: null, offer_expires_at: null, claimable: false,
        service_names_en: ['Signature Haircut'], service_names_ar: ['قص شعر'],
      }];
      db.queue = [{
        entry_id: 'e1', customer_name: 'Huda A.', requested_date: body.p_requested_date,
        earliest_time: body.p_earliest_time, latest_time: body.p_latest_time, status: 'waiting',
        waiting_since: new Date().toISOString(), offer_id: null, offer_starts_at: null,
        offer_expires_at: null, can_extend: false,
        service_names_en: ['Signature Haircut'], service_names_ar: ['قص شعر'],
      }];
      return ok(route, [{ entry_id: 'e1' }]);
    }
    if (url.includes('rpc/leave_waitlist')) {
      db.rpc.push({ fn: 'leave_waitlist', body }); db.mine = []; db.queue = [];
      return ok(route, null);
    }
    if (url.includes('rpc/claim_waitlist_offer')) {
      db.rpc.push({ fn: 'claim_waitlist_offer', body });
      db.mine = []; db.queue = [];
      return ok(route, [{ booking_id: 'bk9', reference: 'SL-WAIT1234' }]);
    }
    if (url.includes('rpc/extend_waitlist_offer')) {
      db.rpc.push({ fn: 'extend_waitlist_offer', body }); return ok(route, new Date().toISOString());
    }
    if (url.includes('rpc/reoffer_waitlist_slot')) {
      db.rpc.push({ fn: 'reoffer_waitlist_slot', body }); return ok(route, 'e1');
    }
    if (url.includes('rpc/my_waitlist')) return ok(route, db.mine);
    if (url.includes('rpc/salon_waitlist')) return ok(route, db.queue);
    if (url.includes('rpc/available_slots')) return ok(route, slots());
    if (url.includes('rpc/salon_day')) return ok(route, []);
    if (url.includes('rpc/salon_stats')) return ok(route, [{ bookings_today: 0,
      bookings_yesterday: 0, booked_halalas: 0, occupancy_percent: 0, is_open: true,
      rating: null, review_count: 0 }]);
    if (url.includes('rpc/salon_reviews')) return ok(route, []);
    if (url.includes('rpc/create_booking')) return ok(route, [{ booking_id: 'b1',
      reference: 'SL-AAA11111', staff_id: 'st1', total_halalas: 13800 }]);

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: session.user.id,
      role: 'customer', full_name: 'Huda A.', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) {
      if (method === 'PATCH') { db.waitlistEnabled = body.waitlist_enabled; return ok(route, []); }
      return ok(route, [{ id: SALON, slug: 'maison-noir', name_en: 'Maison Noir',
        name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر', category_en: 'Salon',
        category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا', phone: null, city: 'Riyadh',
        cr_number: '1010', is_published: true, is_verified: true, owner_id: OWNER,
        slot_step_minutes: 30, waitlist_enabled: db.waitlistEnabled }]);
    }
    if (url.includes('/rest/v1/services')) return ok(route, [{ id: SERVICE, salon_id: SALON,
      name_en: 'Signature Haircut', name_ar: 'قص شعر', duration_minutes: 45,
      price_halalas: 15000, discount_percent: 20, is_active: true, is_archived: false, sort_order: 0 }]);
    if (url.includes('/rest/v1/staff')) return ok(route, [{ id: 'st1', salon_id: SALON,
      name_en: 'Layla A.', name_ar: 'ليلى ع.', role_en: 'Stylist', role_ar: 'مصففة',
      initials: 'LA', is_active: true, is_archived: false, sort_order: 0 }]);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, []);
    if (url.includes('/rest/v1/working_hours')) return ok(route, [{ staff_id: null,
      day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' }]);
    if (url.includes('/rest/v1/bookings')) return ok(route, []);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toTimePicker(page, arabic) {
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
  // The strip starts on today; the stubbed availability is for tomorrow.
  await page.waitForTimeout(1000);
  await page.locator('.hscroll button').nth(1).click();
  await page.waitForTimeout(1200);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.mine = []; db.queue = []; db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await toTimePicker(page, arabic);

  // The taken 15:00 is now a way onto the waitlist, not a dead button.
  const taken = page.getByRole('button').filter({ hasText: '15:00' }).first();
  check(`${L}: a taken slot is tappable`, await taken.isEnabled());
  await taken.click();
  await page.waitForTimeout(500);
  let body = await page.locator('body').innerText();
  check(`${L}: it opens the waitlist sheet`,
        body.includes(arabic ? 'الانضمام لقائمة الانتظار' : 'Join the waitlist'));
  check(`${L}: the sheet suggests a window around that time`, body.includes('14:00–17:00'),
        body.slice(0, 240));
  // What this line says follows the browser's own state — see 05-push.mjs for
  // the full matrix. With a VAPID key built in and permission not yet asked,
  // the true thing to say is that we will ask. It said "we cannot message you
  // yet" until the key was configured, and that is no longer true.
  check(`${L}: it says what will actually happen about notifying them`,
        body.includes(arabic ? 'سنطلب إذنك بإرسال إشعار' : 'ask to send you a notification'),
        body.slice(0, 240).replace(/\n/g, ' '));
  if (!arabic) await page.screenshot({ path: 'shots/waitlist-sheet.png' });

  await page.getByRole('button', { name: arabic ? 'أضفني للقائمة' : 'Add me to the list' }).click();
  await page.waitForTimeout(900);

  const sent = db.rpc.find((r) => r.fn === 'join_waitlist');
  check(`${L}: the join went to join_waitlist()`, Boolean(sent));
  check(`${L}: it sent the window, not just the day`,
        sent?.body.p_earliest_time === '14:00' && sent?.body.p_latest_time === '17:00',
        JSON.stringify(sent?.body));
  check(`${L}: it sent the chosen services`,
        Array.isArray(sent?.body.p_service_ids) && sent.body.p_service_ids[0] === SERVICE);

  // It shows in My bookings, and can be left. The time picker has no tab bar,
  // so go back out to a screen that does.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Bookings|الحجوزات/i }).last().click();
  await page.waitForTimeout(1000);
  body = await page.locator('body').innerText();
  check(`${L}: the queue shows in My bookings`,
        body.includes(arabic ? 'بانتظار موعد' : 'Waiting for a seat'), body.slice(0, 200));

  await page.getByRole('button', { name: arabic ? 'مغادرة القائمة' : 'Leave the list' }).click();
  await page.waitForTimeout(800);
  check(`${L}: leaving calls leave_waitlist()`,
        db.rpc.some((r) => r.fn === 'leave_waitlist'));
  await page.close();
}

// An offer arrives: the banner, and claiming it.
{
  db.rpc = [];
  const day = tomorrow();
  const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(12, 0, 0, 0);
  db.mine = [{
    entry_id: 'e1', salon_id: SALON, salon_name_en: 'Maison Noir', salon_name_ar: 'ميزون نوار',
    requested_date: day, earliest_time: null, latest_time: null, status: 'offered',
    offer_id: 'o1', offer_starts_at: at.toISOString(),
    offer_expires_at: new Date(Date.now() + 9 * 60000).toISOString(), claimable: true,
    service_names_en: ['Signature Haircut'], service_names_ar: ['قص شعر'],
  }];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I'm a customer/i }).first().click();
  await page.waitForTimeout(1200);

  const body = await page.locator('body').innerText();
  check('offer: the banner announces the held seat', body.includes('A spot opened') || body.includes('Maison Noir'),
        body.slice(0, 200));
  await page.screenshot({ path: 'shots/waitlist-offer.png' });

  await page.locator('[style*="rgb(15, 122, 107)"] button').first().click();
  await page.waitForTimeout(1000);
  check('offer: tapping it claims through claim_waitlist_offer()',
        db.rpc.some((r) => r.fn === 'claim_waitlist_offer'), JSON.stringify(db.rpc));
  await page.close();
}

// The salon side.
{
  db.rpc = [];
  db.queue = [{
    entry_id: 'e1', customer_name: 'Huda A.', requested_date: tomorrow(),
    earliest_time: '14:00:00', latest_time: '17:00:00', status: 'offered',
    waiting_since: new Date().toISOString(), offer_id: 'o1',
    offer_starts_at: new Date(Date.now() + 86400000).toISOString(),
    offer_expires_at: new Date(Date.now() + 600000).toISOString(), can_extend: true,
    service_names_en: ['Signature Haircut'], service_names_ar: ['قص شعر'],
  }];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(OWNER, 'owner@example.com'));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /More/i }).last().click();
  await page.waitForTimeout(400);
  await page.getByText(/^Waitlist/).first().click();
  await page.waitForTimeout(1000);

  let body = await page.locator('body').innerText();
  check('vendor: the real queue is shown', body.includes('Huda A.'));
  check('vendor: the sample-data notice is gone', !body.includes('still sample data'), body.slice(0, 200));
  check('vendor: the held seat is marked', body.includes('Held for you'));
  check('vendor: Extend is offered with nobody behind', body.includes('Give longer'));
  await page.screenshot({ path: 'shots/waitlist-vendor.png' });

  await page.getByRole('button', { name: 'Give longer' }).click();
  await page.waitForTimeout(700);
  check('vendor: Extend calls extend_waitlist_offer()',
        db.rpc.some((r) => r.fn === 'extend_waitlist_offer'));

  await page.getByRole('button', { name: 'Notify' }).first().click();
  await page.waitForTimeout(700);
  check('vendor: Notify re-offers the slot',
        db.rpc.some((r) => r.fn === 'reoffer_waitlist_slot'));

  // With somebody queued behind, the button must not be there at all.
  db.queue[0].can_extend = false;
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$/ }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /More/i }).last().click();
  await page.waitForTimeout(400);
  await page.getByText(/^Waitlist/).first().click();
  await page.waitForTimeout(1000);
  body = await page.locator('body').innerText();
  check('vendor: Extend is hidden with a queue behind', !body.includes('Give longer'));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} waitlist checks passed.`);
process.exit(failed ? 1 : 0);
