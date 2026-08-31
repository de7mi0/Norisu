// Push notifications: installable, registers a worker, says only what is true,
// and sends the right thing to register_push_device().
//
// Needs a build made WITH a key, because everything here is switched off
// without one — see this directory's README:
//
//   VITE_VAPID_PUBLIC_KEY=<any base64url string> npm run build
//   npx vite preview --port 4173 &
//   BASE=http://localhost:4173/ node scripts/browser-tests/05-push.mjs
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000001';
const SERVICE = 'cccccccc-0000-0000-0000-000000000001';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/stub-endpoint-123';

function sess(id, email) {
  return {
    access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
    expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
    user: { id, aud: 'authenticated', role: 'authenticated', email, phone: '',
            app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

const db = { mine: [], rpc: [], claimFails: false };

function slots() {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  for (let m = 10 * 60; m + 45 <= 22 * 60; m += 30) {
    const at = new Date(d.getTime() + (m - 180) * 60000);
    out.push({ slot_at: at.toISOString(), is_free: m !== 15 * 60, staff_free: m === 15 * 60 ? 0 : 2 });
  }
  return out;
}

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page, session) {
  // A blank screen otherwise looks like a timeout on a selector, which sends
  // you hunting in the wrong place. Ask the page why it died.
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    const body = req.postData() ? JSON.parse(req.postData()) : {};

    if (url.includes('rpc/register_push_device')) {
      db.rpc.push({ fn: 'register_push_device', body });
      return ok(route, 'dev-1');
    }
    if (url.includes('rpc/forget_push_device')) {
      db.rpc.push({ fn: 'forget_push_device', body });
      return ok(route, 1);
    }
    if (url.includes('rpc/join_waitlist')) {
      db.rpc.push({ fn: 'join_waitlist', body });
      db.mine = [{ entry_id: 'e1', salon_id: SALON, salon_name_en: 'Maison Noir',
        salon_name_ar: 'ميزون نوار', requested_date: body.p_requested_date,
        earliest_time: body.p_earliest_time, latest_time: body.p_latest_time,
        status: 'waiting', offer_id: null, offer_starts_at: null, offer_expires_at: null,
        claimable: false, service_names_en: ['Signature Haircut'], service_names_ar: ['قص شعر'] }];
      return ok(route, [{ entry_id: 'e1' }]);
    }
    if (url.includes('rpc/claim_offer_by_token')) {
      db.rpc.push({ fn: 'claim_offer_by_token', body });
      if (db.claimFails) {
        return route.fulfill({ status: 400, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ code: 'SL012', message: 'that offer is no longer open' }) });
      }
      return ok(route, [{ booking_id: 'b1', reference: 'SL-7788' }]);
    }
    if (url.includes('rpc/my_waitlist')) return ok(route, db.mine);
    if (url.includes('rpc/available_slots')) return ok(route, slots());
    if (url.includes('/rest/v1/salons')) return ok(route, [{
      id: SALON, slug: 'maison-noir', name_en: 'Maison Noir', name_ar: 'ميزون نوار',
      city_en: 'Riyadh', city_ar: 'الرياض', district_en: 'Olaya', district_ar: 'العليا',
      tags_en: 'Hair · Skin · Bridal', tags_ar: 'شعر · بشرة · عرائس',
      category_en: 'Hair', category_ar: 'شعر', rating: 4.9,
      is_published: true, is_verified: true, slot_step_minutes: 30, accepts_waitlist: true }]);
    if (url.includes('/rest/v1/services')) return ok(route, [{
      id: SERVICE, salon_id: SALON, name_en: 'Signature Haircut', name_ar: 'قص شعر',
      duration_minutes: 45, price_halalas: 15000, discount_percent: 20, is_archived: false }]);
    if (url.includes('/rest/v1/staff')) return ok(route, [{
      id: 'dddddddd-0000-0000-0000-000000000001', salon_id: SALON, name_en: 'Layla A.',
      name_ar: 'ليلى ع.', initials: 'LA', is_archived: false }]);
    if (url.includes('/rest/v1/profiles')) return ok(route, [{
      id: CUSTOMER, role: 'customer', full_name: 'Huda', phone: null, locale: 'en' }]);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

/**
 * Forces one branch of pushState(). Real Chromium always supports push, so the
 * cases that matter on a customer's phone — a denial, and an iPhone in an
 * ordinary tab — can only be reached by saying so.
 */
async function stubPush(page, { permission = 'default', supported = true, ios = false } = {}) {
  await page.addInitScript(([perm, sup, isIos, endpoint]) => {
    if (isIos) {
      Object.defineProperty(navigator, 'userAgent', { configurable: true,
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' });
    }
    if (!sup) { delete window.PushManager; return; }

    Object.defineProperty(window.Notification, 'permission', {
      configurable: true, get: () => perm,
    });
    window.Notification.requestPermission = () =>
      Promise.resolve(perm === 'default' ? 'granted' : perm);

    const sub = {
      endpoint,
      getKey: (name) => new TextEncoder().encode(name === 'p256dh' ? 'p256dh-bytes' : 'auth-bytes').buffer,
      unsubscribe: () => Promise.resolve(true),
    };
    const registration = {
      pushManager: {
        getSubscription: () => Promise.resolve(window.__subscribed ? sub : null),
        subscribe: () => { window.__subscribed = true; return Promise.resolve(sub); },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        register: () => Promise.resolve(registration),
        getRegistration: () => Promise.resolve(registration),
        ready: Promise.resolve(registration),
        addEventListener() {},
      }),
    });
  }, [permission, supported, ios, ENDPOINT]);
}

/**
 * A toast lives for 1.7 seconds, so sleeping and then reading the page is a
 * race that is lost about as often as it is won. Poll for it instead.
 */
async function sawToast(page, pattern, timeout = 9000) {
  try {
    await page.waitForFunction(
      (src) => new RegExp(src).test(document.body.innerText),
      pattern.source,
      { timeout, polling: 100 },
    );
    return true;
  } catch {
    return false;
  }
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

async function toWaitlistSheet(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByText(/Maison Noir|ميزون نوار/).first().click();
  await page.waitForTimeout(600);
  await page.locator('.scr button').filter({ hasText: /Signature Haircut|قص شعر/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Continue|متابعة/i }).last().click();
  await page.waitForTimeout(600);
  await page.locator('.scr button').filter({ hasText: /Any professional|أي مختص/ }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Pick a time|اختر الوقت/i }).click();
  await page.waitForTimeout(1000);
  await page.locator('.hscroll button').nth(1).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button').filter({ hasText: '15:00' }).first().click();
  await page.waitForTimeout(500);
}

// -------------------------------------------------------------------------
// Installable, and a worker that really registers
// -------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const href = await page.getAttribute('link[rel=manifest]', 'href');
  check('the page links a manifest', Boolean(href), String(href));

  const manifest = await page.evaluate(async (h) => {
    const res = await fetch(new URL(h, location.href));
    return res.ok ? await res.json() : null;
  }, href);
  check('the manifest parses', Boolean(manifest));
  check('it is standalone, so it opens as an app', manifest?.display === 'standalone');
  check('it has a name and a short name',
        Boolean(manifest?.name) && Boolean(manifest?.short_name), JSON.stringify(manifest?.name));
  check('it declares a maskable icon',
        (manifest?.icons ?? []).some((i) => i.purpose === 'maskable'));

  const icons = await page.evaluate(async ([h, list]) => {
    const out = [];
    for (const icon of list) {
      const res = await fetch(new URL(icon.src, new URL(h, location.href)));
      out.push({ src: icon.src, ok: res.ok, type: res.headers.get('content-type') });
    }
    return out;
  }, [href, manifest?.icons ?? []]);
  check('every icon it names actually loads',
        icons.length === 3 && icons.every((i) => i.ok && i.type?.includes('png')),
        JSON.stringify(icons));

  const touch = await page.evaluate(async () => {
    const el = document.querySelector('link[rel="apple-touch-icon"]');
    if (!el) return null;
    const res = await fetch(el.href);
    return res.ok;
  });
  check('the iPhone home-screen icon loads', touch === true);

  // The real thing, not a stub: registration is what makes push possible at all.
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register(
      new URL('sw.js', document.baseURI).toString(),
      { scope: new URL('.', document.baseURI).toString() });
    await navigator.serviceWorker.ready;
    return (reg.active || reg.installing || reg.waiting)?.state ?? 'none';
  });
  check('the service worker registers and activates',
        ['activated', 'activating', 'installed'].includes(state), state);

  await page.close();
}

// -------------------------------------------------------------------------
// It says only what is true, in both languages
// -------------------------------------------------------------------------
const NOTE = {
  ask:     { en: 'We’ll ask to send you a notification', ar: 'سنطلب إذنك بإرسال إشعار' },
  on:      { en: 'We’ll notify you the moment a seat opens', ar: 'سنُشعرك فور توفّر موعد' },
  denied:  { en: 'Notifications are turned off for Saloni', ar: 'الإشعارات موقوفة لتطبيق صالوني' },
  install: { en: 'Add Saloni to your home screen', ar: 'أضف صالوني إلى الشاشة الرئيسية' },
};

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const lang = arabic ? 'ar' : 'en';

  for (const [name, opts] of [
    ['ask', { permission: 'default' }],
    ['on', { permission: 'granted' }],
    ['denied', { permission: 'denied' }],
    ['install', { supported: false, ios: true }],
  ]) {
    db.mine = []; db.rpc = [];
    const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
    await install(page, sess(CUSTOMER, 'huda@example.com'));
    await stubPush(page, opts);
    await toWaitlistSheet(page, arabic);
    const body = await page.locator('body').innerText();
    check(`${L}: "${name}" says the one true thing`, body.includes(NOTE[name][lang]),
          body.slice(0, 200).replace(/\n/g, ' '));
    if (!arabic && name === 'ask') await page.screenshot({ path: 'shots/push-sheet.png' });
    await page.close();
  }
}

// -------------------------------------------------------------------------
// Joining asks, subscribes, and registers the device
// -------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.mine = []; db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await stubPush(page, { permission: 'default' });
  await toWaitlistSheet(page, arabic);
  await page.getByRole('button', { name: arabic ? 'أضفني للقائمة' : 'Add me to the list' }).click();
  await page.waitForTimeout(1200);

  const joined = db.rpc.find((r) => r.fn === 'join_waitlist');
  check(`${L}: joining still goes to join_waitlist()`, Boolean(joined));

  const reg = db.rpc.find((r) => r.fn === 'register_push_device');
  check(`${L}: and registers this browser to be notified`, Boolean(reg));
  check(`${L}: it sends the endpoint the push service gave it`,
        reg?.body.p_endpoint === ENDPOINT, JSON.stringify(reg?.body?.p_endpoint));
  check(`${L}: it sends both keys, base64url encoded`,
        Boolean(reg?.body.p_p256dh) && Boolean(reg?.body.p_auth) &&
        !/[+/=]/.test(reg.body.p_p256dh + reg.body.p_auth),
        JSON.stringify([reg?.body?.p_p256dh, reg?.body?.p_auth]));
  check(`${L}: it says which kind of device`, reg?.body.p_platform === 'web');
  check(`${L}: it labels the device so one can be told from another`,
        typeof reg?.body.p_label === 'string' && reg.body.p_label.length > 0,
        JSON.stringify(reg?.body?.p_label));

  const body = await page.locator('body').innerText();
  check(`${L}: it confirms it will notify them`,
        body.includes(arabic ? 'سنُشعرك ✓' : 'We’ll notify you ✓'),
        body.slice(0, 200).replace(/\n/g, ' '));
  await page.close();
}

// The state a real phone got stuck in: permission granted in an earlier
// attempt, no subscription ever saved, and every later join concluding there
// was nothing to do. Six waitlist offers produced no notifications and no
// error. Joining must register the device, not assume it already is.
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.mine = []; db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  // granted, but __subscribed is never set, so getSubscription() returns null.
  await stubPush(page, { permission: 'granted' });
  await toWaitlistSheet(page, arabic);
  await page.getByRole('button', { name: arabic ? 'أضفني للقائمة' : 'Add me to the list' }).click();
  await page.waitForTimeout(1200);

  const reg = db.rpc.find((r) => r.fn === 'register_push_device');
  check(`${L}: permission already granted but no device on file still registers one`,
        Boolean(reg), JSON.stringify(db.rpc.map((r) => r.fn)));
  check(`${L}: and it registers the real endpoint, not a placeholder`,
        reg?.body.p_endpoint === ENDPOINT, JSON.stringify(reg?.body?.p_endpoint));
  await page.close();
}

// A refusal must not promise anything, and must register nothing.
{
  db.mine = []; db.rpc = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await stubPush(page, { permission: 'denied' });
  await toWaitlistSheet(page, false);
  await page.getByRole('button', { name: 'Add me to the list' }).click();
  await page.waitForTimeout(1200);
  check('a refusal registers no device',
        !db.rpc.some((r) => r.fn === 'register_push_device'),
        JSON.stringify(db.rpc.map((r) => r.fn)));
  check('a refusal still puts them on the list',
        db.rpc.some((r) => r.fn === 'join_waitlist'));
  await page.close();
}

// -------------------------------------------------------------------------
// Following the link in a notification lands on the seat, not the front door
// -------------------------------------------------------------------------
const TOKEN = '3f9a1c72-58d4-4a2e-9b61-0c7e5d2a8f14';

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.mine = []; db.rpc = []; db.claimFails = false;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await stubPush(page, { permission: 'granted' });

  await page.goto(`${BASE}?claim=${TOKEN}${arabic ? '&lang=ar' : ''}`, { waitUntil: 'networkidle' });

  // Caught while it is on screen rather than after it has faded.
  const confirmed = await sawToast(page, /The seat is yours|تم حجز الموعد/);
  check(`${L}: it confirms the seat is theirs`, confirmed);

  const sent = db.rpc.find((r) => r.fn === 'claim_offer_by_token');
  check(`${L}: the link claims through claim_offer_by_token()`, Boolean(sent));
  check(`${L}: it sends the token from the URL`, sent?.body.p_token === TOKEN,
        JSON.stringify(sent?.body));

  // Landing on the chooser would be the old two-tap behaviour with extra steps.
  const body = await page.locator('body').innerText();
  check(`${L}: it lands in the app rather than on the chooser`,
        !body.includes("I'm a customer") && !body.includes('أنا عميل'),
        body.slice(0, 120).replace(/\n/g, ' '));
  check(`${L}: and on the bookings screen, where the seat is`,
        /My bookings|حجوزاتي/.test(body), body.slice(0, 120).replace(/\n/g, ' '));

  // The token must not survive a reload, or tomorrow's refresh re-claims it.
  const stillThere = await page.evaluate(() => window.location.search.includes('claim='));
  check(`${L}: the token is stripped from the address bar`, stillThere === false);

  const before = db.rpc.filter((r) => r.fn === 'claim_offer_by_token').length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const after = db.rpc.filter((r) => r.fn === 'claim_offer_by_token').length;
  check(`${L}: reloading does not claim a second time`, after === before, `${before} then ${after}`);

  await page.close();
}

// A seat that has gone must say so, not fail silently.
{
  db.mine = []; db.rpc = []; db.claimFails = true;
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page, sess(CUSTOMER, 'huda@example.com'));
  await stubPush(page, { permission: 'granted' });
  await page.goto(`${BASE}?claim=${TOKEN}`, { waitUntil: 'networkidle' });
  const told = await sawToast(page, /no longer|gone|taken|Someone else/i);
  check('a seat that has gone says so rather than failing silently', told);
  check('and it still tried, rather than swallowing the link',
        db.rpc.some((r) => r.fn === 'claim_offer_by_token'));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
