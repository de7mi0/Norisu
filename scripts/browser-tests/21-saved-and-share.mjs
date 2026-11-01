// Saved salons and sharing a salon.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/21-saved-and-share.mjs
//
// The heart on a salon's page remembered nothing past a refresh and no screen
// listed what had been saved; the share button said "Link copied" and copied
// nothing. Both looked like they worked. These check they do, in both
// languages. That a saved list is private to its account is assertion 138's
// business; the stub here agrees to anything.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '99999999-9999-9999-9999-999999999999';
const SALON = 'bbbbbbbb-0000-0000-0000-000000000002';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'me@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const db = { saved: [], writes: [] };
const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page, signedIn) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/rest/v1/saved_salons')) {
      if (req.method() === 'GET') return ok(route, db.saved.map((salon_id) => ({ salon_id })));
      db.writes.push({ method: req.method(), url, body: req.postData() });
      if (req.method() === 'POST') db.saved.unshift(SALON);
      if (req.method() === 'DELETE') db.saved = db.saved.filter((id) => id !== SALON);
      return ok(route, []);
    }
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'customer', full_name: '', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, owner_id: 'x', slug: 'r',
      name_en: 'Rose & Oud', name_ar: 'وردة وعود', is_verified: true, is_published: true, closed_at: null,
      waitlist_enabled: true, slot_step_minutes: 30, city: 'Riyadh', area_en: 'Al Olaya', area_ar: 'العليا',
      tags_en: '', tags_ar: '', category_en: '', category_ar: '', phone: null, latitude: null, longitude: null }]);
    return ok(route, []);
  });
  if (signedIn) await page.addInitScript(([r, v]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const text = async (page) => (await page.locator('body').innerText()).replace(/\n/g, ' ');
const browser = await chromium.launch({ executablePath: BROWSER });

async function toSalon(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(600);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const heart = arabic ? 'حفظ الصالون' : 'Save salon';

  // Signed out: the heart asks to sign in, and says why.
  db.saved = []; db.writes = [];
  let page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, false);
  await toSalon(page, arabic);
  await page.getByRole('button', { name: heart }).click();
  await page.waitForTimeout(500);
  let body = await text(page);
  check(`${L}: a signed-out heart asks to sign in, and says why`,
        (arabic ? /لحفظ الصالونات/ : /Sign in to save salons/).test(body) && db.writes.length === 0, body.slice(0, 300));
  await page.close();

  // Signed in: saving writes to the account, and survives a reload.
  page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, true);
  await toSalon(page, arabic);
  await page.getByRole('button', { name: heart }).click();
  await page.waitForTimeout(600);
  check(`${L}: the heart saves the salon to the account`,
        db.writes.some((w) => w.method === 'POST' && (w.body || '').includes(SALON)), JSON.stringify(db.writes));
  check(`${L}: and shows as saved`,
        (await page.getByRole('button', { name: heart }).getAttribute('aria-pressed')) === 'true');

  await page.reload({ waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: arabic ? /^حسابي$/ : /^Profile$/ }).first().click();
  await page.waitForTimeout(600);
  body = await text(page);
  check(`${L}: after a reload, Profile counts it`,
        (arabic ? /الصالونات المحفوظة\s*1/ : /Saved salons\s*1/).test(body), body.slice(0, 500));
  await page.getByRole('button', { name: arabic ? /^الصالونات المحفوظة/ : /^Saved salons/ }).first().click();
  await page.waitForTimeout(500);
  body = await text(page);
  check(`${L}: and the saved list shows it`, body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'), body.slice(0, 300));
  await page.getByRole('button', { name: new RegExp(arabic ? 'إزالة من المحفوظات' : 'Remove from saved') }).click();
  await page.waitForTimeout(600);
  check(`${L}: removing it deletes it from the account`,
        db.writes.some((w) => w.method === 'DELETE'), JSON.stringify(db.writes.map((w) => w.method)));
  await page.close();
}

// Sharing produces a real link, and the link opens that salon.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.addInitScript(() => {
    // No share sheet in a headless browser; record what would be shared.
    navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };
  });
  await install(page, false);
  await toSalon(page, false);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared);
  check('share hands over a link to this salon', Boolean(shared?.url?.includes(`?salon=${SALON}`)), JSON.stringify(shared));
  await page.goto(shared?.url ?? BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const body = await text(page);
  check('opening that link lands on the salon page', /Rose & Oud/.test(body) && /Message/.test(body), body.slice(0, 300));
  check('and the parameter is taken out of the address bar', !page.url().includes('salon='), page.url());
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
