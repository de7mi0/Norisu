// Saloni's own back office: reviewing, approving, turning down and closing.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/14-admin.mjs
//
// Until 0021 this work happened in the Supabase table editor: approving meant
// ticking two boxes, denying meant doing nothing at all, and closing somebody
// else's salon was not possible by any route. These drive the screens that
// replaced that, and the two halves worth most are not about data arriving:
// that the option is absent for an account that is not an administrator, and
// that a refusal cannot be sent without a reason the owner will read.
//
// The stub answers whatever it is told to, so nothing here proves the database
// would allow any of it — assertions 121–127 are the evidence for that half.
// What these prove is that the app sends the right call and renders the answer
// correctly in both languages. Confirmed to fail against the code before 0021.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '99999999-9999-9999-9999-999999999999';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'admin@saloni.test',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const REGISTER = [
  { id: 'aaa', name_en: 'Noor Salon', name_ar: 'صالون نور', cr_number: '1010101010',
    status: 'awaiting', owner_email: 'noor@salon.test', registered_at: '2026-09-19T08:00:00Z',
    reviewed_at: null, reviewed_by_email: null, rejection_reason: null, closed_at: null,
    closed_reason: null, commission_bps: 500, services: 4, team: 2, upcoming: 3 },
  { id: 'bbb', name_en: 'Rose & Oud', name_ar: 'وردة وعود', cr_number: '2020202020',
    status: 'live', owner_email: 'rose@salon.test', registered_at: '2026-08-02T08:00:00Z',
    reviewed_at: '2026-08-03T08:00:00Z', reviewed_by_email: 'admin@saloni.test',
    rejection_reason: null, closed_at: null, closed_reason: null,
    commission_bps: 500, services: 9, team: 5, upcoming: 11 },
];

// `role` decides whether the back office is offered at all; `register` is how
// admin_salons() answers.
const db = { role: 'admin', register: 'live', calls: [] };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const fail = (route, code, message) => route.fulfill({ status: code === '42501' ? 403 : 500,
  contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify({ code, message }) });

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });

    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    const rpc = url.match(/\/rpc\/([a-z_]+)/)?.[1];
    if (rpc) {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
      db.calls.push({ rpc, body });

      if (rpc === 'admin_salons') {
        if (db.register === 'denied') return fail(route, '42501', 'not an administrator');
        if (db.register === 'error') return fail(route, 'XX000', 'boom');
        if (db.register === 'empty') return ok(route, []);
        return ok(route, REGISTER);
      }
      // Every decision answers success; what is being checked is the call.
      return ok(route, null);
    }

    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: db.role,
      full_name: 'Saloni Admin', phone: null, locale: 'en' });
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toRegister(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Saloni admin|إدارة صالوني/ }).first().click();
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// The register and one salon, in both languages.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.role = 'admin'; db.register = 'live'; db.calls = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toRegister(page, arabic);

  let body = await page.locator('body').innerText();

  check(`${L}: the register is asked for`,
        db.calls.some((c) => c.rpc === 'admin_salons'), JSON.stringify(db.calls.map((c) => c.rpc)));

  check(`${L}: it lists the salons`,
        body.includes(arabic ? 'صالون نور' : 'Noor Salon')
        && body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'),
        body.slice(0, 400).replace(/\n/g, ' '));

  // The count is the reason somebody opens this screen at all.
  check(`${L}: it says how many are waiting on a decision`,
        new RegExp(`1 ${arabic ? 'بانتظار المراجعة' : 'awaiting review'}`).test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  await page.getByRole('button', { name: new RegExp(arabic ? 'صالون نور' : 'Noor Salon') }).first().click();
  await page.waitForTimeout(700);
  body = await page.locator('body').innerText();

  // The whole reason an administrator can see more than anybody else.
  check(`${L}: the commercial registration number is shown`,
        body.includes('1010101010'), body.slice(0, 500).replace(/\n/g, ' '));

  check(`${L}: and says to check it before approving`,
        arabic ? /سجل وزارة التجارة/.test(body) : /Ministry of Commerce/.test(body),
        body.slice(0, 600).replace(/\n/g, ' '));

  check(`${L}: the owner's address is shown, for replying to a bad registration`,
        body.includes('noor@salon.test'), body.slice(0, 600).replace(/\n/g, ' '));

  // Publishing is a second decision and is refused until the first is made.
  const publish = page.getByRole('button', { name: arabic ? /^نشر في الدليل$/ : /^Put in the catalogue$/ });
  check(`${L}: an unapproved salon cannot be put in the catalogue`,
        await publish.isDisabled(), 'button was enabled');
  check(`${L}: and says why not`,
        arabic ? /اعتمد السجل التجاري أولاً/.test(body) : /Approve the registration first/.test(body),
        body.slice(0, 700).replace(/\n/g, ' '));

  // Approving must not publish. Two statements, two taps.
  db.calls = [];
  await page.getByRole('button', { name: arabic ? /^اعتماد السجل التجاري$/ : /^Approve registration$/ }).click();
  await page.waitForTimeout(700);
  const verify = db.calls.find((c) => c.rpc === 'admin_verify_salon');
  check(`${L}: approving calls admin_verify_salon for this salon`,
        Boolean(verify) && verify.body?.p_salon_id === 'aaa' && verify.body?.p_verified === true,
        JSON.stringify(verify));
  check(`${L}: and never publishes in the same breath`,
        !db.calls.some((c) => c.rpc === 'admin_publish_salon'),
        JSON.stringify(db.calls.map((c) => c.rpc)));

  await page.close();
}

// ---------------------------------------------------------------------------
// A refusal has to say why. This is the point of moving denial into the app.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.role = 'admin'; db.register = 'live'; db.calls = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toRegister(page, arabic);
  await page.getByRole('button', { name: new RegExp(arabic ? 'صالون نور' : 'Noor Salon') }).first().click();
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: arabic ? /^رفض$/ : /^Turn down$/ }).click();
  await page.waitForTimeout(500);

  const go = page.getByRole('button', { name: arabic ? /^ارفضه$/ : /^Turn it down$/ });
  check(`${L}: a refusal cannot be sent with nothing written`,
        await go.isDisabled(), 'the button was enabled with an empty reason');

  const sheet = await page.locator('body').innerText();
  check(`${L}: the sheet says the owner will read it`,
        arabic ? /يقرأ المالك ما تكتبه هنا/.test(sheet) : /The owner reads what you write here/.test(sheet),
        sheet.slice(-600).replace(/\n/g, ' '));

  db.calls = [];
  await page.locator('#admin-reason').fill('The number does not match the business name.');
  await page.waitForTimeout(250);
  check(`${L}: and can be sent once it does`, !(await go.isDisabled()), 'still disabled');

  await go.click();
  await page.waitForTimeout(700);
  const rejected = db.calls.find((c) => c.rpc === 'admin_reject_salon');
  check(`${L}: the reason is what gets sent`,
        rejected?.body?.p_reason === 'The number does not match the business name.',
        JSON.stringify(rejected));

  await page.close();
}

// ---------------------------------------------------------------------------
// Closing cancels other people's appointments, so it says how many.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.role = 'admin'; db.register = 'live'; db.calls = [];
  await install(page);
  await toRegister(page, false);
  await page.getByRole('button', { name: /Noor Salon/ }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Close this salon$/ }).click();
  await page.waitForTimeout(500);

  const sheet = await page.locator('body').innerText();
  check('closing warns how many appointments it cancels',
        /3 appointments still to come will be cancelled/.test(sheet),
        sheet.slice(-700).replace(/\n/g, ' '));
  check('and says the owner is released and their records kept',
        /delete their account/.test(sheet) && /other people’s records/.test(sheet),
        sheet.slice(-700).replace(/\n/g, ' '));
  await page.close();
}

// ---------------------------------------------------------------------------
// The option itself. Hiding it is a courtesy, not the boundary — but an
// ordinary account must never be shown a door it cannot walk through.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.role = 'customer'; db.register = 'live'; db.calls = [];
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();

  check('a customer is not offered the back office',
        !/Saloni admin/.test(body), body.slice(0, 300).replace(/\n/g, ' '));
  check('and the register is never even asked for',
        !db.calls.some((c) => c.rpc === 'admin_salons'),
        JSON.stringify(db.calls.map((c) => c.rpc)));
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.role = 'vendor'; db.register = 'live'; db.calls = [];
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check('nor is a salon owner — owning a salon is not running the platform',
        !/Saloni admin/.test(await page.locator('body').innerText()));
  await page.close();
}

// ---------------------------------------------------------------------------
// A failed read must never read as "no salons have registered".
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.role = 'admin'; db.register = 'error'; db.calls = [];
  await install(page);
  await toRegister(page, false);
  const body = await page.locator('body').innerText();
  check('a failed register says so rather than showing an empty list',
        /Could not load the register/.test(body) && !/No salon has registered/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  db.role = 'admin'; db.register = 'empty'; db.calls = [];
  await install(page);
  await toRegister(page, false);
  const body = await page.locator('body').innerText();
  check('and a genuinely empty register says that instead',
        /No salon has registered/.test(body), body.slice(0, 400).replace(/\n/g, ' '));
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  // The profile says admin but the database disagrees — a role changed under
  // them. The screen must say what happened rather than look broken.
  db.role = 'admin'; db.register = 'denied'; db.calls = [];
  await install(page);
  await toRegister(page, false);
  const body = await page.locator('body').innerText();
  check('a refused register says the account is not an administrator',
        /not a Saloni administrator/.test(body), body.slice(0, 400).replace(/\n/g, ' '));
  await page.close();
}

// ---------------------------------------------------------------------------
// The other half: what a refusal looks like to the salon that got it.
//
// A denial the owner cannot see is the Supabase dashboard's silence with more
// machinery behind it, so this is the check that the feature is worth having.
// The reason is written by an administrator and read here through
// my_salon_review(), because the column is in no SELECT grant.
// ---------------------------------------------------------------------------
const OWNER = '55555555-5555-5555-5555-555555555555';
const ownerSession = {
  ...session,
  user: { ...session.user, id: OWNER, email: 'noor@salon.test' },
};

async function installOwner(page, review) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, ownerSession.user);
    if (url.includes('/auth/v1/token')) return ok(route, ownerSession);
    if (url.includes('rpc/my_salon_review')) return ok(route, [review]);
    if (url.includes('rpc/my_salon_cr')) return ok(route, '1010101010');
    if (url.includes('rpc/')) return ok(route, null);
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: OWNER, role: 'vendor',
      full_name: 'Noor Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: 'aaa', owner_id: OWNER,
      slug: 'noor-salon', name_en: 'Noor Salon', name_ar: 'صالون نور', category_en: 'Ladies salon',
      category_ar: 'صالون سيدات', area_en: 'Al Olaya', area_ar: 'العليا', city: 'Riyadh',
      phone: '+966500000000', is_verified: false, is_published: false,
      slot_step_minutes: 30, waitlist_enabled: true }]);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, ownerSession]);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await installOwner(page, { reviewed_at: '2026-09-20T10:00:00Z', rejected_at: '2026-09-20T10:00:00Z',
    rejection_reason: 'The registration number does not match the business name.' });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(1400);
  const body = await page.locator('body').innerText();

  check(`${L}: a turned-down salon is told so`,
        arabic ? /لم يُعتمد بعد/.test(body) : /Not approved yet/.test(body),
        body.slice(0, 600).replace(/\n/g, ' '));

  // The sentence an administrator typed, reaching the person it is about.
  check(`${L}: and reads the reason it was given`,
        /The registration number does not match the business name/.test(body),
        body.slice(0, 700).replace(/\n/g, ' '));

  // Without this the refusal is a dead end one layer further in.
  check(`${L}: and is told how to get back in the queue`,
        arabic ? /صحّح رقم السجل التجاري/.test(body) : /Correct your commercial registration number/.test(body),
        body.slice(0, 800).replace(/\n/g, ' '));

  // The old banner must not also be showing: two answers is worse than one.
  check(`${L}: and is not also told it is merely awaiting review`,
        arabic ? !/قيد المراجعة/.test(body) : !/awaiting review/i.test(body),
        body.slice(0, 800).replace(/\n/g, ' '));

  await page.close();
}

{
  // A salon nobody has turned down keeps the banner it always had. This fix
  // must not spread into the ordinary case.
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await installOwner(page, { reviewed_at: null, rejected_at: null, rejection_reason: null });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /I own a salon/i }).first().click();
  await page.waitForTimeout(1400);
  const body = await page.locator('body').innerText();
  check('a salon awaiting review is not told it was turned down',
        !/Not approved yet/.test(body), body.slice(0, 500).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
