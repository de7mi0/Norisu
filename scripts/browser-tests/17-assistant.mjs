// The Saloni Assistant, and the people behind it.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/17-assistant.mjs
//
// Until 0025 the assistant was a script that told customers "I've flagged this
// for the salon manager" when nothing had been sent, and the salon chat
// answered itself. These check three things, in both languages:
//
//   1. The assistant answers what it knows — including Arabic typed with or
//      without hamza, which is where a keyword match quietly fails — and says
//      it is not sure rather than guessing, and never claims to have passed
//      anything on.
//   2. Handing over opens a REAL conversation: the call goes to
//      start_conversation with the right salon (or none, for Saloni), the
//      customer's question travels with them, and no side is sent — the
//      database decides who is speaking.
//   3. The people answering can: a salon owner from the portal, an
//      administrator from the back office.
//
// The stub agrees to anything, so who may read or write what is for
// assertions 131-136 to prove. These prove the app asks the right thing.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '44444444-4444-4444-4444-444444444444';
const SALON = 'bbbbbbbb-0000-0000-0000-000000000002';
const CONV = 'cccccccc-1111-2222-3333-444444444444';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'someone@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

// role: whose profile this is. owns: whether they own the salon.
const db = { role: 'customer', owns: false, signedIn: true, calls: [], threadFails: false, unread: true };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const fail = (route, code) => route.fulfill({ status: 400, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code, message: 'no' }) });

function salonRow() {
  return [{
    id: SALON, owner_id: db.owns ? USER : '55555555-5555-5555-5555-555555555555', slug: 'rose-oud',
    name_en: 'Rose & Oud', name_ar: 'وردة وعود', is_verified: true, is_published: true,
    closed_at: null, waitlist_enabled: true, slot_step_minutes: 30, city: 'Riyadh',
    area_en: 'Al Olaya', area_ar: 'العليا', tags_en: '', tags_ar: '', category_en: '',
    category_ar: '', phone: null, latitude: null, longitude: null,
  }];
}

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
      if (rpc === 'start_conversation') return ok(route, CONV);
      if (rpc === 'post_message') return ok(route, 'dddddddd-0000-0000-0000-000000000001');
      if (rpc === 'conversation_messages') {
        if (db.threadFails) return fail(route, 'XX000');
        return ok(route, [
          { id: 'm1', side: 'customer', body: 'Do you have parking?', created_at: '2026-10-07T09:00:00Z', mine: db.role === 'customer' },
          { id: 'm2', side: 'salon', body: 'Yes, behind the building.', created_at: '2026-10-07T09:05:00Z', mine: db.role !== 'customer' },
        ]);
      }
      if (rpc === 'my_conversations') return ok(route, [{
        conversation_id: CONV, salon_id: SALON, name_en: 'Rose & Oud', name_ar: 'وردة وعود',
        can_reply: true, last_body: 'Yes, behind the building.', last_side: 'salon',
        last_message_at: '2026-10-07T09:05:00Z', unread: db.unread }]);
      if (rpc === 'staff_inbox') return ok(route, [{
        conversation_id: CONV, customer_name: body?.p_support ? 'Huda S.' : 'Nora',
        last_body: 'Do you have parking?', last_side: 'customer',
        last_message_at: '2026-10-07T09:00:00Z', unread: true }]);
      if (rpc === 'admin_salons') return ok(route, []);
      return ok(route, []);
    }
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: db.role,
      full_name: 'Someone', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, salonRow());
    return ok(route, []);
  });
  await page.addInitScript(([r, v, signedIn]) => {
    if (signedIn) window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v));
  }, [REF, session, db.signedIn]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const text = async (page) => (await page.locator('body').innerText()).replace(/\n/g, ' ');

const browser = await chromium.launch({ executablePath: BROWSER });

async function open(arabic, mode = /I'm a customer|أنا عميل/i) {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: mode }).first().click();
  await page.waitForTimeout(900);
  return page;
}

async function ask(page, words) {
  await page.getByPlaceholder(/Type a message|اكتب رسالة/).fill(words);
  await page.getByRole('button', { name: /^(Send|إرسال)$/ }).click();
  await page.waitForTimeout(800);
}

async function openAssistant(page) {
  await page.getByRole('button', { name: /Saloni Assistant|مساعد صالوني/ }).first().click();
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// 1. What it says.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  Object.assign(db, { role: 'customer', owns: false, signedIn: true, calls: [], threadFails: false, unread: true });
  const page = await open(arabic);
  await openAssistant(page);
  let body = await text(page);

  check(`${L}: it introduces itself and says it can put you through to a person`,
        arabic ? /أوصلك بالصالون أو بفريقنا/.test(body) : /put you through to the salon or to our team/.test(body), body.slice(0, 300));
  check(`${L}: it no longer calls itself AI`,
        !/\bAI\b|دعم ذكي/.test(body), body.slice(0, 200));

  await page.getByRole('button', { name: arabic ? /^إلغاء أو تغيير موعد$/ : /^Cancel or change$/ }).click();
  await page.waitForTimeout(800);
  body = await text(page);
  check(`${L}: a topic chip answers with the real button names`,
        arabic ? /«إعادة جدولة»/.test(body) && /«إلغاء»/.test(body) : /“Reschedule”/.test(body) && /“Cancel”/.test(body),
        body.slice(-500));

  // The Arabic that a raw includes() would miss: إلغاء typed with hamza, the
  // keyword stored without it.
  await ask(page, arabic ? 'أبي إلغاء موعدي' : 'how can I cancel my appointment?');
  body = await text(page);
  const cancels = (body.match(arabic ? /«إعادة جدولة»/g : /“Reschedule”/g) || []).length;
  check(`${L}: a typed question about cancelling finds the cancelling answer`, cancels >= 2, String(cancels));

  await ask(page, arabic ? 'كيف أدفع؟ هل تاخذون بطاقة' : 'Do I pay by card in the app?');
  body = await text(page);
  check(`${L}: payment is answered truthfully — nothing is paid in the app`,
        arabic ? /لا يتم أي دفع عبر صالوني/.test(body) : /Nothing is paid through Saloni/.test(body), body.slice(-400));

  await ask(page, 'zzqx blorp');
  body = await text(page);
  check(`${L}: something it does not recognise is not guessed at`,
        arabic ? /ما أنا متأكد/.test(body) : /not sure I understood/.test(body), body.slice(-300));

  // The sentence the old assistant said, and the reason it was replaced.
  check(`${L}: it never claims to have passed anything on`,
        !/flagged|logged that|shared it with the salon|رفعت طلبك|سجّلت ملاحظتك/.test(body), body.slice(-400));

  await page.getByRole('button', { name: arabic ? /^افتح حجوزاتي$/ : /^Open my bookings$/ }).first().click();
  await page.waitForTimeout(600);
  body = await text(page);
  check(`${L}: "Open my bookings" goes to Bookings`,
        arabic ? /القادمة/.test(body) : /Upcoming/.test(body), body.slice(0, 200));
  await page.close();
}

// ---------------------------------------------------------------------------
// 2. Handing over to a person.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  Object.assign(db, { role: 'customer', owns: false, signedIn: true, calls: [], threadFails: false });
  const page = await open(arabic);
  await openAssistant(page);
  const question = arabic ? 'أبي أكلم شخص من خدمة العملاء' : 'I want to talk to a human please';
  await ask(page, question);
  let body = await text(page);
  check(`${L}: asking for a person offers Saloni's team`,
        body.includes(arabic ? 'فريق صالوني' : 'Saloni’s team'), body.slice(-400));

  await page.getByRole('button', { name: arabic ? /^فريق صالوني$/ : /^Saloni’s team$/ }).click();
  await page.waitForTimeout(800);
  body = await text(page);
  check(`${L}: it opens a conversation with Saloni support`,
        body.includes(arabic ? 'دعم صالوني' : 'Saloni support'), body.slice(0, 300));
  const box = page.getByPlaceholder(/Type a message|اكتب رسالة/);
  check(`${L}: what they asked the assistant is ready to send, not sent`,
        (await box.inputValue()) === question
        && !db.calls.some((c) => c.rpc === 'start_conversation'),
        await box.inputValue());

  await page.getByRole('button', { name: /^(Send|إرسال)$/ }).click();
  await page.waitForTimeout(900);
  const start = db.calls.find((c) => c.rpc === 'start_conversation');
  check(`${L}: sending starts a real conversation with Saloni (no salon)`,
        start && start.body.p_salon_id === null && start.body.p_body === question, JSON.stringify(start));
  check(`${L}: and the browser never says which side it is speaking for`,
        db.calls.every((c) => !c.body || !('side' in c.body) && !('p_side' in c.body)));
  body = await text(page);
  check(`${L}: the conversation is read back from the database`,
        body.includes('Yes, behind the building.') && db.calls.some((c) => c.rpc === 'conversation_messages' && c.body.p_conversation_id === CONV),
        body.slice(0, 400));
  check(`${L}: the box empties once it is sent`, (await box.inputValue()) === '');

  // From a salon's own page.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(700);
  db.calls = [];
  await page.getByRole('button', { name: arabic ? /^مراسلة$/ : /^Message$/ }).click();
  await page.waitForTimeout(900);
  body = await text(page);
  check(`${L}: "Message" on a salon page opens that salon's conversation, history included`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud') && body.includes('Do you have parking?'), body.slice(0, 300));
  check(`${L}: and it no longer promises "replies in ~10 min"`,
        !/10 min|10 دقائق/.test(body));
  await ask(page, arabic ? 'هل عندكم موقف؟' : 'Is there parking?');
  const post = db.calls.find((c) => c.rpc === 'post_message');
  check(`${L}: a reply in an existing thread posts to that thread`,
        post && post.body.p_conversation_id === CONV, JSON.stringify(db.calls.map((c) => c.rpc)));

  // The thread failing to load is said, not shown as an empty conversation.
  db.threadFails = true;
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: arabic ? /^حسابي$/ : /^Profile$/ }).first().click();
  await page.waitForTimeout(500);
  body = await text(page);
  check(`${L}: Profile shows an unread reply`,
        arabic ? /الرسائل\s*1 جديدة/.test(body) : /Messages\s*1 new/.test(body), body.slice(0, 600));
  await page.getByRole('button', { name: arabic ? /^الرسائل/ : /^Messages/ }).first().click();
  await page.waitForTimeout(700);
  body = await text(page);
  check(`${L}: the list shows the conversation and what was said last`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud') && body.includes('Yes, behind the building.'), body.slice(0, 400));
  await page.getByRole('button', { name: arabic ? /وردة وعود/ : /Rose & Oud/ }).first().click();
  await page.waitForTimeout(900);
  body = await text(page);
  check(`${L}: a conversation that fails to load says so`,
        arabic ? /تعذّر تحميل المحادثة/.test(body) : /couldn’t be loaded/.test(body), body.slice(0, 400));
  await page.getByRole('button', { name: arabic ? 'رجوع' : 'Back' }).first().click();
  await page.waitForTimeout(400);
  body = await text(page);
  check(`${L}: back from a conversation returns to the list`,
        body.includes(arabic ? 'محادثاتك مع الصالونات' : 'Your conversations with salons'), body.slice(0, 200));
  await page.close();
}

// ---------------------------------------------------------------------------
// 3. Signed out: nothing is lost by being asked to sign in.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  Object.assign(db, { role: 'customer', owns: false, signedIn: false, calls: [], threadFails: false });
  const page = await open(arabic);
  await page.getByText(arabic ? 'وردة وعود' : 'Rose & Oud').first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: arabic ? /^مراسلة$/ : /^Message$/ }).click();
  await page.waitForTimeout(600);
  let body = await text(page);
  check(`${L}: a signed-out visitor is told who reads it and that sign-in comes at send`,
        arabic ? /يقرأها المالك/.test(body) && /سيُطلب منك تسجيل الدخول/.test(body)
               : /The owner reads it/.test(body) && /asked to sign in when you send/.test(body), body.slice(0, 400));
  await ask(page, 'Hello?');
  body = await text(page);
  check(`${L}: sending opens sign-in and says why`,
        arabic ? /ليصلك الرد/.test(body) : /so the reply can reach you/.test(body), body.slice(0, 400));
  check(`${L}: nothing is sent, and the words are kept`,
        !db.calls.some((c) => c.rpc === 'start_conversation')
        && (await page.getByPlaceholder(/Type a message|اكتب رسالة/).inputValue()) === 'Hello?');
  await page.close();
}

// ---------------------------------------------------------------------------
// 4. The people answering.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  Object.assign(db, { role: 'vendor', owns: true, signedIn: true, calls: [], threadFails: false });
  const page = await open(arabic, /I own a salon|أملك صالون/i);
  // The portal opens on Business details; back is the way to the dashboard.
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(700);
  let body = await text(page);
  check(`${L}: a salon owner sees Messages, with what is new`,
        arabic ? /الرسائل\s*1 جديدة/.test(body) : /Messages\s*1 new/.test(body), body.slice(0, 500));
  await page.getByRole('button', { name: arabic ? /^الرسائل/ : /^Messages/ }).first().click();
  await page.waitForTimeout(700);
  check(`${L}: the salon's inbox asks for the salon's threads, not support's`,
        db.calls.some((c) => c.rpc === 'staff_inbox' && c.body.p_support === false));
  body = await text(page);
  check(`${L}: and shows the customer by name and nothing else`,
        body.includes('Nora') && !body.includes('@'), body.slice(0, 300));
  await page.getByRole('button', { name: /Nora/ }).first().click();
  await page.waitForTimeout(800);
  body = await text(page);
  check(`${L}: the owner is told they reply as the salon`,
        arabic ? /ترد باسم صالونك/.test(body) : /You reply as your salon/.test(body), body.slice(0, 300));
  db.calls = [];
  await ask(page, 'Yes — see you at 6.');
  const post = db.calls.find((c) => c.rpc === 'post_message');
  check(`${L}: the owner's reply goes to that conversation`,
        post && post.body.p_conversation_id === CONV && post.body.p_body === 'Yes — see you at 6.', JSON.stringify(post));
  await page.close();

  Object.assign(db, { role: 'admin', owns: false, signedIn: true, calls: [] });
  const admin = await open(arabic, /Saloni admin|إدارة صالوني/);
  await admin.getByRole('button', { name: arabic ? /^الدعم/ : /^Support/ }).first().click();
  await admin.waitForTimeout(700);
  check(`${L}: an administrator's inbox is Saloni's support threads`,
        db.calls.some((c) => c.rpc === 'staff_inbox' && c.body.p_support === true));
  body = await text(admin);
  check(`${L}: and lists who asked`, body.includes('Huda S.'), body.slice(0, 300));
  await admin.getByRole('button', { name: /Huda S\./ }).first().click();
  await admin.waitForTimeout(700);
  body = await text(admin);
  check(`${L}: the administrator is told they reply as Saloni`,
        arabic ? /ترد باسم صالوني/.test(body) : /You reply as Saloni/.test(body), body.slice(0, 300));
  await admin.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
