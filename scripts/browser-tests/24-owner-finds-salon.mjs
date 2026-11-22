// How the portal finds the owner's salon, on either side of migration 0030.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/24-owner-finds-salon.mjs
//
// 0030 took salons.owner_id out of every SELECT grant — it linked salon owners
// to the reviews they wrote — so "which salon is mine?" is asked of
// my_salon_id() instead. The app ships before the migration is applied, so it
// has to be right three ways: after 0030 (the function answers, and filtering
// on owner_id is refused), before it (the function does not exist yet,
// PGRST202, and the old filter still works), and for an account that owns
// nothing. The other browser checks cannot tell these apart, because their
// stubs answer every salon query with the same salon whatever it asks; this
// one answers only the right question.
import { chromium } from 'playwright';

const BROWSER = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '33333333-3333-3333-3333-333333333324';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000024';
const NAME = { en: 'Lantern Atelier', ar: 'مشغل الفانوس' };

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'owner24@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const salonRow = { id: SALON, name_en: NAME.en, name_ar: NAME.ar, category_en: 'Salon',
  category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا', city: 'Riyadh', cities: ['Riyadh'],
  maps_url: null, latitude: null, longitude: null, phone: null, is_verified: true,
  is_published: true, slot_step_minutes: 30, waitlist_enabled: false };

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page, world) {
  const asked = { rpc: 0, byOwner: 0, byId: 0 };
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = decodeURIComponent(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return json(route, 200, session.user);
    if (url.includes('/auth/v1/token')) return json(route, 200, session);
    if (url.includes('rpc/my_salon_id')) {
      asked.rpc += 1;
      if (world === 'before') return json(route, 404, { code: 'PGRST202',
        message: 'Could not find the function public.my_salon_id without parameters in the schema cache' });
      return json(route, 200, world === 'after' ? SALON : null);
    }
    if (url.includes('/rest/v1/salons')) {
      if (url.includes('owner_id=eq.')) {
        asked.byOwner += 1;
        // After 0030 the column is in no SELECT grant, and PostgREST says so.
        if (world !== 'before') return json(route, 401, { code: '42501',
          message: 'permission denied for table salons' });
        return json(route, 200, [salonRow]);
      }
      if (url.includes(`id=eq.${SALON}`)) { asked.byId += 1; return json(route, 200, [salonRow]); }
      return json(route, 200, []);
    }
    if (url.includes('rpc/salon_stats')) return json(route, 200, [{ bookings_today: 0,
      bookings_yesterday: 0, booked_halalas: 0, occupancy_percent: 0, is_open: true,
      rating: null, review_count: 0 }]);
    if (url.includes('rpc/my_closed_salon')) return json(route, 200, []);
    if (url.includes('/rest/v1/profiles')) return json(route, 200, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    return json(route, 200, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
  return asked;
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const browser = await chromium.launch({ executablePath: BROWSER });

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const name = arabic ? NAME.ar : NAME.en;
  for (const world of ['after', 'before', 'none']) {
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    const asked = await install(page, world);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
    await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
    await page.waitForTimeout(1500);
    // The name may be on the page or inside the Business details fields,
    // whose contents innerText does not include.
    const fields = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
    const body = `${await page.locator('body').innerText()} ${fields.join(' ')}`;

    if (world === 'after') {
      check(`${L} after 0030: the portal opens the owner's own salon`, body.includes(name),
            body.slice(0, 200).replace(/\n/g, ' '));
      check(`${L} after 0030: found through my_salon_id()`, asked.rpc > 0 && asked.byId > 0);
      check(`${L} after 0030: and never by filtering on owner_id`, asked.byOwner === 0,
            `${asked.byOwner} owner_id queries`);
    } else if (world === 'before') {
      check(`${L} before 0030: the portal still opens the owner's salon`, body.includes(name),
            body.slice(0, 200).replace(/\n/g, ' '));
      check(`${L} before 0030: by the old owner_id filter`, asked.byOwner > 0);
    } else {
      check(`${L} owning nothing: no salon is invented`, !body.includes(name));
      check(`${L} owning nothing: and owner_id is not asked about`, asked.byOwner === 0);
    }
    await page.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
