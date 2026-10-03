// The list the owner wrote after testing the app themselves.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/16-testing-feedback.mjs
//
// Every check here is one of their reports, driven the way they found it:
//
//   * typing in the service sheet always landed in the name field
//   * the sheet's fields had no visible names
//   * "See all" did nothing
//   * the city at the top of Explore could not be changed
//   * registering a salon offered no list of categories or cities
//   * booking sometimes showed every time as taken — two causes, one a salon
//     with no team and one a reschedule that asked about the wrong stylist
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '11111111-1111-1111-1111-111111111111';
const SALON_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SALON_B = 'bbbbbbbb-0000-0000-0000-000000000002';

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function start(page, arabic, who = /I'm a customer|أنا عميل/i) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: who }).first().click();
  await page.waitForTimeout(900);
}
const text = (page) => page.locator('body').innerText();

// ---------------------------------------------------------------------------
// The sample catalogue, no backend: Explore, the city chooser and "See all".
// ---------------------------------------------------------------------------

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await start(page, arabic);

  const cityButton = page.getByRole('button', { name: arabic ? /اختر مدينة/ : /Choose a city/ }).first();
  check(`${L}: the city at the top is a button`, await cityButton.isVisible());
  check(`${L}: it starts on the whole Kingdom`,
        (await cityButton.innerText()).includes(arabic ? 'كل مدن المملكة' : 'All of Saudi Arabia'),
        await cityButton.innerText());

  await cityButton.click();
  await page.waitForTimeout(300);
  const dialog = page.getByRole('dialog');
  check(`${L}: tapping it opens a list of cities`, await dialog.isVisible());
  let body = await dialog.innerText();
  check(`${L}: the list is in the reader's language`,
        arabic ? body.includes('جدة') && body.includes('الدمام') && !body.includes('Jeddah')
               : body.includes('Jeddah') && body.includes('Dammam'),
        body.slice(0, 200));

  await page.getByRole('option', { name: arabic ? /جدة/ : /Jeddah/ }).click();
  await page.waitForTimeout(300);
  body = await text(page);
  check(`${L}: a city with no salons says so`,
        body.includes(arabic ? 'لا توجد صالونات في هذه المدينة بعد' : 'No salons in this city yet'),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and lists none of another city's`,
        !body.includes(arabic ? 'ميزون نوار' : 'Maison Noir'));

  // Remembered on this device.
  await page.reload({ waitUntil: 'networkidle' });
  // A signed-out visitor's language is not remembered across a reload; the
  // city is the thing under test, so choose the language again.
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  const after = await page.getByRole('button', { name: /Choose a city|اختر مدينة/ }).first().innerText();
  check(`${L}: the chosen city survives a reload`, /Jeddah|جدة/.test(after), after);

  await page.getByRole('button', { name: /Choose a city|اختر مدينة/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: arabic ? /الرياض/ : /Riyadh/ }).click();
  await page.waitForTimeout(300);
  body = await text(page);
  check(`${L}: choosing Riyadh lists Riyadh's salons`,
        body.includes(arabic ? 'ميزون نوار' : 'Maison Noir'), body.slice(0, 300).replace(/\n/g, ' '));

  // "See all" — only offered while a category hides something, and undoes it.
  const seeAll = page.getByRole('button', { name: arabic ? 'عرض الكل' : 'See all' });
  check(`${L}: "See all" is not offered while everything is shown`, (await seeAll.count()) === 0);
  await page.getByRole('button', { name: arabic ? 'حلاقة' : 'Barber', exact: true }).click();
  await page.waitForTimeout(300);
  body = await text(page);
  check(`${L}: a category narrows the list`, !body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'));
  check(`${L}: and "See all" appears`, await seeAll.isVisible());
  await seeAll.click();
  await page.waitForTimeout(300);
  body = await text(page);
  check(`${L}: "See all" brings every salon back`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud') && body.includes(arabic ? 'ذا باربر' : 'The Barber Atelier'));
  check(`${L}: and the "All" chip is chosen again`,
        (await page.getByRole('button', { name: arabic ? 'الكل' : 'All', exact: true }).getAttribute('aria-pressed')) === 'true');

  await page.evaluate(() => window.localStorage.removeItem('saloni.city'));
  await page.close();
}

// ---------------------------------------------------------------------------
// The service sheet: typing stays where it was typed, and fields are named.
// ---------------------------------------------------------------------------

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await start(page, arabic, /I own a salon|أملك صالون/i);
  // The owner's way in lands on registration; the sample portal is behind it.
  await page.getByRole('button', { name: arabic ? 'رجوع' : 'Back' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: arabic ? /الخدمات/ : /Services/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: arabic ? /إضافة خدمة/ : /Add a service/ }).click();
  await page.waitForTimeout(400);

  const inputs = page.getByRole('dialog').locator('input');
  // Type into the second field one key at a time, as a person does.
  await inputs.nth(1).click();
  await page.keyboard.type('150', { delay: 40 });
  const first = await inputs.nth(0).inputValue();
  const second = await inputs.nth(1).inputValue();
  check(`${L}: typing a price stays in the price field`, second === '150', `price="${second}"`);
  check(`${L}: and does not land in the name field`, first === '', `name="${first}"`);

  const labels = await page.getByRole('dialog').locator('label').evaluateAll((els) =>
    els.map((el) => ({ text: el.textContent, visible: el.getBoundingClientRect().height > 4 })));
  check(`${L}: every field has a visible name`,
        labels.length >= 3 && labels.every((l) => l.visible && l.text.trim()), JSON.stringify(labels));
  await page.close();
}

// ---------------------------------------------------------------------------
// Registering a salon: categories and cities are lists, in both languages.
// ---------------------------------------------------------------------------

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await start(page, arabic, /I own a salon|أملك صالون/i);

  let body = await text(page);
  check(`${L}: categories are offered as a list`,
        body.includes(arabic ? 'حلاق رجالي' : "Men's barber") && body.includes(arabic ? 'أظافر' : 'Nails'),
        body.slice(0, 300).replace(/\n/g, ' '));
  check(`${L}: with "Other" among them`, body.includes(arabic ? 'أخرى' : 'Other'));
  check(`${L}: the free-text category fields are hidden until "Other"`,
        !body.includes(arabic ? 'الفئة (بالإنجليزية)' : 'Category (English)'));
  await page.getByRole('button', { name: arabic ? 'أخرى' : 'Other', exact: true }).click();
  await page.waitForTimeout(200);
  body = await text(page);
  check(`${L}: "Other" opens both languages to type`,
        body.includes(arabic ? 'الفئة (بالإنجليزية)' : 'Category (English)')
        && body.includes(arabic ? 'الفئة (بالعربية)' : 'Category (Arabic)'));

  check(`${L}: cities are a list in the reader's language`,
        arabic ? body.includes('مكة المكرمة') && body.includes('الخبر') : body.includes('Makkah') && body.includes('Khobar'));
  const riyadh = page.getByRole('button', { name: arabic ? 'الرياض' : 'Riyadh', exact: true });
  const jeddah = page.getByRole('button', { name: arabic ? 'جدة' : 'Jeddah', exact: true });
  await riyadh.click(); await jeddah.click();
  await page.waitForTimeout(200);
  check(`${L}: more than one city can be chosen`,
        (await page.getByRole('button', { name: arabic ? '✓ الرياض' : '✓ Riyadh' }).getAttribute('aria-pressed')) === 'true'
        && (await page.getByRole('button', { name: arabic ? '✓ جدة' : '✓ Jeddah' }).getAttribute('aria-pressed')) === 'true');

  const link = page.getByLabel(arabic ? 'رابط خرائط Google' : 'Google Maps link');
  await link.fill('https://example.com/maps/salon');
  await page.waitForTimeout(200);
  body = await text(page);
  check(`${L}: a link that is not Google Maps is refused on the field`,
        body.includes(arabic ? 'هذا ليس رابطًا من خرائط Google' : 'This is not a Google Maps link'));
  await link.fill('https://maps.app.goo.gl/AbC123');
  await page.waitForTimeout(200);
  body = await text(page);
  check(`${L}: a Google Maps share link is accepted`,
        !body.includes(arabic ? 'هذا ليس رابطًا من خرائط Google' : 'This is not a Google Maps link'));
  check(`${L}: and can be checked on the map`,
        (await page.getByRole('link', { name: arabic ? /عرض على الخريطة/ : /Check on the map/ }).getAttribute('href'))
        === 'https://maps.app.goo.gl/AbC123');
  await page.close();
}

// ---------------------------------------------------------------------------
// Live, stubbed: why every time showed as taken.
// ---------------------------------------------------------------------------

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'me@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};
const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

function slots(free) {
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  for (let m = 10 * 60; m + 45 <= 13 * 60; m += 30) {
    out.push({ slot_at: new Date(d.getTime() + (m - 180) * 60000).toISOString(), is_free: free, staff_free: free ? 1 : 0 });
  }
  return out;
}

const salonRow = (id, en, ar, extra = {}) => ({ id, slug: en.toLowerCase(), name_en: en, name_ar: ar,
  tags_en: 'Hair', tags_ar: 'شعر', category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya',
  area_ar: 'العليا', phone: '+966112004477', city: 'Riyadh', is_published: true, slot_step_minutes: 30, ...extra });

async function live(page, { staff, bookings = [], rpc }) {
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);
    if (url.includes('rpc/available_slots')) {
      // Answers as available_slots() does: a time is free only if somebody
      // on THIS salon's team — the named one, if one is named — could take it.
      const asked = JSON.parse(req.postData() || '{}');
      rpc.push(asked);
      const team = staff.filter((person) => person.salon_id === asked.p_salon_id);
      const free = asked.p_staff_id == null ? team.length > 0 : team.some((person) => person.id === asked.p_staff_id);
      return ok(route, slots(free));
    }
    if (url.includes('rpc/')) return ok(route, []);
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'customer', full_name: 'Nora', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) {
      if (url.includes('select=id%2Ccities') || url.includes('select=id,cities')) {
        return ok(route, [{ id: SALON_A, cities: ['Riyadh'], maps_url: 'https://maps.app.goo.gl/xyz', latitude: null, longitude: null },
                          { id: SALON_B, cities: ['Riyadh', 'Jeddah'], maps_url: null, latitude: 21.5, longitude: 39.2 }]);
      }
      return ok(route, [salonRow(SALON_A, 'Maison Noir', 'ميزون نوار'), salonRow(SALON_B, 'Rose & Oud', 'وردة وعود', { phone: null })]);
    }
    if (url.includes('/rest/v1/services')) return ok(route, [SALON_A, SALON_B].map((salon, i) => ({ id: `cccccccc-0000-0000-0000-00000000000${i + 1}`, salon_id: salon,
      name_en: 'Signature Haircut', name_ar: 'قص شعر', duration_minutes: 45, price_halalas: 15000, discount_percent: 0,
      is_active: true, is_archived: false, sort_order: 0 })));
    if (url.includes('/rest/v1/staff')) return ok(route, staff);
    if (url.includes('/rest/v1/bookings')) return ok(route, bookings);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) => window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

// A salon whose team is empty is not "fully booked".
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  const rpc = [];
  // Salon B has a stylist; salon A has nobody. The staff picker then has
  // nothing for A — so the only way into A's time picker is by rescheduling.
  await live(page, {
    staff: [{ id: 'stB', salon_id: SALON_B, name_en: 'Hana', name_ar: 'هناء', role_en: 'Stylist', role_ar: 'مصففة',
              initials: 'H', is_active: true, is_archived: false, sort_order: 0 }],
    rpc,
    bookings: [{ id: 'bk1', reference: 'SL-11112222', salon_id: SALON_A, staff_id: 'stOld', staff_requested: false,
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), ends_at: new Date(Date.now() + 3 * 86400000 + 2700000).toISOString(),
      status: 'confirmed', total_halalas: 15000, booking_items: [{ name_en: 'Signature Haircut', name_ar: 'قص شعر',
      duration_minutes: 45, unit_price_halalas: 15000, discount_percent: 0, quantity: 1 }],
      salons: { name_en: 'Maison Noir', name_ar: 'ميزون نوار' }, staff: { name_en: 'Old', name_ar: 'قديم' } }],
  });
  await start(page, arabic);

  // Browse salon B and pick its stylist — this is the choice that used to
  // leak into the reschedule.
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(600);
  let body = await text(page);
  check(`${L}: a salon with no number offers no Call button`, !body.includes(arabic ? 'اتصال' : 'Call'), '');
  const dir = page.getByRole('link', { name: arabic ? /الاتجاهات/ : /Directions/ });
  check(`${L}: a pinned salon offers Directions to its pin`,
        ((await dir.getAttribute('href')) || '').includes('query=21.5,39.2'), await dir.getAttribute('href'));
  await page.locator('.scr button').filter({ hasText: /Signature Haircut|قص شعر/ }).first().click();
  await page.getByRole('button', { name: /Continue|متابعة/i }).last().click();
  await page.waitForTimeout(500);
  await page.locator('.scr button').filter({ hasText: /Hana|هناء/ }).first().click();
  await page.getByRole('button', { name: /Pick a time|اختر الوقت/i }).click();
  await page.waitForTimeout(1200);
  check(`${L}: booking at B asks about B's stylist`, rpc.at(-1)?.p_staff_id === 'stB', JSON.stringify(rpc.at(-1)));

  // Now move the booking at A.
  // Back out to the tabs the way a person would; a reload would forget the
  // stylist and hide the bug.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: arabic ? 'رجوع' : 'Back' }).first().click();
    await page.waitForTimeout(350);
  }
  await page.getByRole('button', { name: /^(Bookings|الحجوزات)$/ }).first().click();
  await page.waitForTimeout(800);
  body = await text(page);
  check(`${L}: Directions on a booking is a real link`,
        (await page.getByRole('link', { name: arabic ? /الاتجاهات/ : /Directions/ }).first().getAttribute('href')) === 'https://maps.app.goo.gl/xyz');
  await page.getByRole('button', { name: arabic ? /إعادة جدولة/ : /Reschedule/ }).first().click();
  await page.waitForTimeout(1200);
  const asked = rpc.at(-1);
  check(`${L}: rescheduling asks about this booking's specialist, not the last one tapped`,
        asked?.p_salon_id === SALON_A && asked?.p_staff_id === null, JSON.stringify(asked));

  body = await text(page);
  check(`${L}: a salon with no team says it is not taking bookings`,
        body.includes(arabic ? 'هذا الصالون لا يستقبل الحجوزات عبر التطبيق بعد' : 'This salon is not taking online bookings yet'),
        body.slice(0, 500).replace(/\n/g, ' '));
  check(`${L}: rather than "fully booked"`, !body.includes(arabic ? 'هذا اليوم محجوز بالكامل' : 'This day is fully booked'));
  await page.close();
}

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
