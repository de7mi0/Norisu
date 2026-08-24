import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/Norisu/';
const REF = 'nicdmspejrvruszlwhvm';

const OWNER_ID = '33333333-3333-3333-3333-333333333333';

const session = {
  access_token: 'stub-access-token',
  refresh_token: 'stub-refresh-token',
  token_type: 'bearer',
  expires_in: 360000,
  expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: {
    id: OWNER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.com',
    phone: '',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
};

const SALON_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// What the fake backend answers with. Tests mutate these between navigations.
const state = {
  profileName: '',
  day: [
    {
      booking_id: 'b1',
      reference: 'SL-K3P2A9',
      starts_at: isoToday(10, 0),
      ends_at: isoToday(10, 45),
      status: 'confirmed',
      staff_name_en: 'Layla A.',
      staff_name_ar: 'ليلى ع.',
      customer_name: 'Huda A.',
      services_en: ['Signature Haircut'],
      services_ar: ['قص شعر'],
      total_halalas: 13800,
    },
    {
      booking_id: 'b2',
      reference: 'SL-M8T1Z4',
      starts_at: isoToday(13, 0),
      ends_at: isoToday(14, 0),
      status: 'pending',
      staff_name_en: null,
      staff_name_ar: null,
      customer_name: null,
      services_en: ['Hair Color & Gloss'],
      services_ar: ['صبغة وتلوين'],
      total_halalas: 23000,
    },
    {
      booking_id: 'b3',
      reference: 'SL-Q2W9E0',
      starts_at: isoToday(16, 0),
      ends_at: isoToday(16, 30),
      status: 'cancelled',
      staff_name_en: 'Sara M.',
      staff_name_ar: 'سارة م.',
      customer_name: 'Mona R.',
      services_en: ['Manicure'],
      services_ar: ['مانيكير'],
      total_halalas: 9000,
    },
  ],
  stats: [
    {
      bookings_today: 2,
      bookings_yesterday: 4,
      booked_halalas: 234000,
      occupancy_percent: 76,
      is_open: true,
      rating: '4.9',
      review_count: 12,
    },
  ],
  reviews: [
    {
      review_id: 'r1',
      rating: '4.5',
      body: 'Lovely cut, and they were on time.',
      reply: '',
      replied_at: null,
      is_published: true,
      created_at: '2026-08-14T13:00:00Z',
      customer_name: 'Huda A.',
    },
    {
      review_id: 'r2',
      rating: '2.0',
      body: 'Waited twenty minutes past my slot.',
      reply: 'We are sorry — we have added more staff on Thursdays.',
      replied_at: '2026-08-15T09:00:00Z',
      is_published: false,
      created_at: '2026-08-13T18:00:00Z',
      customer_name: null,
    },
  ],
  failRpc: false,
};

function isoToday(h, m) {
  const d = new Date();
  d.setHours(h - 3, m, 0, 0); // stored UTC, displayed in Riyadh (+03)
  return d.toISOString();
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

async function install(page) {
  await page.route(`**/${REF}.supabase.co/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }

    if (url.includes('/auth/v1/user')) return json(route, session.user);
    if (url.includes('/auth/v1/token')) return json(route, session);
    if (url.includes('/auth/v1/logout')) return json(route, {});

    if (url.includes('/rest/v1/rpc/salon_day')) {
      return state.failRpc ? json(route, { message: 'boom' }, 500) : json(route, state.day);
    }
    if (url.includes('/rest/v1/rpc/salon_stats')) {
      return state.failRpc ? json(route, { message: 'boom' }, 500) : json(route, state.stats);
    }
    if (url.includes('/rest/v1/rpc/salon_reviews')) {
      return state.failRpc ? json(route, { message: 'boom' }, 500) : json(route, state.reviews);
    }
    if (url.includes('/rest/v1/rpc/available_slots')) return json(route, []);

    if (url.includes('/rest/v1/profiles')) {
      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}');
        state.profileName = body.full_name ?? '';
        return json(route, []);
      }
      return json(route, {
        id: OWNER_ID,
        role: 'vendor',
        full_name: state.profileName,
        phone: null,
        locale: 'en',
      });
    }

    if (url.includes('/rest/v1/salons')) {
      return json(route, [
        {
          id: SALON_ID,
          slug: 'maison-noir',
          name_en: 'Maison Noir',
          name_ar: 'ميزون نوار',
          tags_en: 'Hair · Spa',
          tags_ar: 'شعر · سبا',
          category_en: 'Salon',
          category_ar: 'صالون',
          area_en: 'Al Olaya',
          area_ar: 'العليا',
          phone: null,
          city: 'Riyadh',
          cr_number: '1010101010',
          is_published: true,
          is_verified: true,
          owner_id: OWNER_ID,
          slot_step_minutes: 30,
        },
      ]);
    }
    if (url.includes('/rest/v1/services')) {
      return json(route, [
        {
          id: 'cccccccc-0000-0000-0000-000000000001',
          salon_id: SALON_ID,
          name_en: 'Signature Haircut',
          name_ar: 'قص شعر',
          duration_minutes: 45,
          price_halalas: 15000,
          discount_percent: 20,
          is_active: true,
          is_archived: false,
          sort_order: 0,
        },
      ]);
    }
    if (url.includes('/rest/v1/staff')) {
      return json(route, [
        {
          id: 'dddddddd-0000-0000-0000-000000000001',
          salon_id: SALON_ID,
          name_en: 'Layla A.',
          name_ar: 'ليلى ع.',
          role_en: 'Stylist',
          role_ar: 'مصففة',
          initials: 'LA',
          is_active: true,
          is_archived: false,
          sort_order: 0,
        },
      ]);
    }
    if (url.includes('/rest/v1/salon_ratings')) {
      return json(route, [{ salon_id: SALON_ID, rating: 4.9, review_count: 12 }]);
    }
    if (url.includes('/rest/v1/working_hours')) {
      return json(route, [
        { staff_id: null, day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' },
      ]);
    }
    if (url.includes('/rest/v1/bookings')) return json(route, []);

    return json(route, []);
  });

  await page.addInitScript(
    ([ref, value]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(value));
    },
    [REF, session],
  );
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

const browser = await chromium.launch({ executablePath: BROWSER });

async function open(mutate) {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  if (mutate) mutate();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
}

async function toVendor(page) {
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(900);
  // Entering the portal lands on Business details; its back arrow is the way
  // through to the dashboard for an owner who already has a salon.
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1200);
}

// ---------------------------------------------------------------- dashboard
{
  const page = await open();
  await toVendor(page);
  const body = await page.locator('body').innerText();

  check('dashboard: shows the owner’s salon name', body.includes('Maison Noir'));
  check('dashboard: "Booked today", never "Revenue"', body.includes('Booked today') && !body.includes('Revenue today'));
  check('dashboard: says the money is not yet paid', body.includes('not yet paid'));
  check('dashboard: today’s count is the real one', /\b2\b/.test(body) && body.includes("Today's bookings"));
  check('dashboard: compares against yesterday', body.includes('vs yesterday'), body.slice(0, 200));
  check('dashboard: occupancy from the database', body.includes('76%'));
  check('dashboard: rating from the shared view', body.includes('4.9') && body.includes('12 reviews'));
  check('dashboard: sample-data notice is gone on live data', !body.includes('still sample data'));
  check('dashboard: names the customer who gave one', body.includes('Huda A.'));
  check('dashboard: falls back to the bare reference, not an e-mail', body.includes('SL-M8T1Z4') && !body.includes('Booking ref') && !body.includes('@example.com'));
  check('dashboard: unassigned booking says any professional', body.includes('Any professional'));
  check('dashboard: cancelled booking still listed', body.includes('Cancelled'));
  await page.screenshot({ path: 'shots/dashboard-en.png', fullPage: true });
  await page.close();
}

// ----------------------------------------------------------------- calendar
{
  const page = await open();
  await toVendor(page);
  await page.getByRole('button', { name: /Calendar ›|التقويم/ }).first().click();
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();

  const today = new Date();
  const weekday = today.toLocaleDateString('en-US', { weekday: 'short' });
  check('calendar: the strip starts at today', body.includes(String(today.getDate())));
  check('calendar: day heading is a real date', body.includes(weekday));
  check('calendar: no hardcoded Jul 31 remains', !body.includes('Jul'));
  check('calendar: live appointments', body.includes('Huda A.') && body.includes('Signature Haircut'));
  check('calendar: sample notice gone', !body.includes('still sample data'));
  await page.screenshot({ path: 'shots/calendar-en.png', fullPage: true });

  // An empty day is an ordinary day, not a fault.
  state.day = [];
  await page.locator('.hscroll button').nth(3).click();
  await page.waitForTimeout(700);
  const empty = await page.locator('body').innerText();
  check('calendar: an empty day says so', empty.includes('Nothing booked for this day'));
  await page.screenshot({ path: 'shots/calendar-empty.png', fullPage: true });
  await page.close();
}

// ------------------------------------------------------------------ arabic
{
  state.day = [
    {
      booking_id: 'b1',
      reference: 'SL-K3P2A9',
      starts_at: isoToday(10, 0),
      ends_at: isoToday(10, 45),
      status: 'confirmed',
      staff_name_en: 'Layla A.',
      staff_name_ar: 'ليلى ع.',
      customer_name: 'هدى ع.',
      services_en: ['Signature Haircut'],
      services_ar: ['قص شعر'],
      total_halalas: 13800,
    },
    {
      booking_id: 'b2',
      reference: 'SL-M8T1Z4',
      starts_at: isoToday(13, 0),
      ends_at: isoToday(14, 0),
      status: 'pending',
      staff_name_en: null,
      staff_name_ar: null,
      customer_name: null,
      services_en: ['Hair Color'],
      services_ar: ['صبغة وتلوين'],
      total_halalas: 23000,
    },
  ];
  const page = await open();
  await page.getByRole('button', { name: 'العربية' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await toVendor(page);
  const body = await page.locator('body').innerText();
  const dir = await page.locator('.viewport, [dir]').first().getAttribute('dir');

  check('arabic: layout flips to rtl', dir === 'rtl', `dir=${dir}`);
  check('arabic: tiles translated', body.includes('محجوز اليوم') && body.includes('الإشغال'));
  check('arabic: no English weekday leaked in', !/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(body));
  check('arabic: unassigned reads in Arabic', body.includes('أي مختص'));

  // Latin runs must be isolated or they reorder inside the Arabic around them.
  const isolated = await page.evaluate(() => {
    const runs = [...document.querySelectorAll('.ltr-run')].map((n) => n.textContent.trim());
    return runs;
  });
  check('arabic: figures wrapped in .ltr-run', isolated.some((r) => r.includes('%')) && isolated.some((r) => /\d{2}:\d{2}/.test(r)), isolated.join('|'));
  await page.screenshot({ path: 'shots/dashboard-ar.png', fullPage: true });

  await page.getByRole('button', { name: /التقويم/ }).first().click();
  await page.waitForTimeout(700);
  const calBody = await page.locator('body').innerText();
  check('arabic calendar: Arabic weekday, Latin digits', /[؀-ۿ]/.test(calBody) && !/[٠-٩]/.test(calBody));
  await page.screenshot({ path: 'shots/calendar-ar.png', fullPage: true });
  await page.close();
}

// ----------------------------------------------------------------- reviews
{
  const page = await open();
  await toVendor(page);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(400);
  await page.getByText(/^Reviews|المراجعات/).first().click();
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();

  check('reviews: live review body', body.includes('Lovely cut'));
  check('reviews: unpublished one is shown and marked', body.includes('Hidden from your salon page'));
  check('reviews: owner reply rendered', body.includes('added more staff'));
  check('reviews: an unnamed reviewer is "A customer", not a label', body.includes('A customer') && !body.includes('Booking ref'));
  check('reviews: sample notice gone', !body.includes('still sample data'));
  await page.screenshot({ path: 'shots/reviews-en.png', fullPage: true });

  state.reviews = [];
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await toVendor(page);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(300);
  await page.getByText(/^Reviews/).first().click();
  await page.waitForTimeout(700);
  check('reviews: empty state', (await page.locator('body').innerText()).includes('No reviews yet'));
  await page.close();
}

// --------------------------------------------------------- failure fallback
{
  state.failRpc = true;
  const page = await open();
  await toVendor(page);
  const body = await page.locator('body').innerText();
  check('failure: the day says it could not load', body.includes('Could not load this day') || body.includes('sample data'), body.slice(0, 300));
  check('failure: the app is still usable', body.includes('Maison Noir'));
  await page.screenshot({ path: 'shots/dashboard-error.png', fullPage: true });
  state.failRpc = false;
  await page.close();
}

// -------------------------------------------------------------- name sheet
{
  state.profileName = '';
  const page = await open();
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Profile|حسابي/i }).last().click();
  await page.waitForTimeout(500);
  let body = await page.locator('body').innerText();

  check('profile: no invented saved-salon count', !body.includes('Saved salons'));
  check('profile: no invented card count', !body.includes('3 cards'));
  check('profile: a blank name says so', body.includes('Not given'));

  await page.getByText('Personal details').first().click();
  await page.waitForTimeout(400);
  check('profile: the name sheet opens', (await page.locator('body').innerText()).includes('What should we call you'));
  await page.locator('input').first().fill('Nora Al-Fahad');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(700);
  body = await page.locator('body').innerText();
  check('profile: the name is written to the profile', state.profileName === 'Nora Al-Fahad', `stored=${state.profileName}`);
  check('profile: the row shows the stored name', body.includes('Nora Al-Fahad'));
  await page.screenshot({ path: 'shots/profile-named.png', fullPage: true });
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
process.exit(failed.length ? 1 : 0);
