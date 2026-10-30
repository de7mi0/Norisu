// Signing in and out from the salon owner's side.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/18-vendor-account.mjs
//
// Reported by the owner: the vendor portal had no sign-in and no sign-out.
// A signed-out visitor landed on "Register your salon" with no way to reach
// a salon that already existed, and a signed-in owner had to go through the
// customer side to change account — which is the whole of testing a
// conversation between a customer account and a salon account.
import { chromium } from 'playwright';
const BASE = process.env.BASE || BASE;
const REF='nicdmspejrvruszlwhvm', USER='44444444-4444-4444-4444-444444444444';
const session={access_token:'stub',refresh_token:'stub',token_type:'bearer',expires_in:360000,expires_at:Math.floor(Date.now()/1000)+360000,user:{id:USER,aud:'authenticated',role:'authenticated',email:'owner@kingdom.test',phone:'',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
const ok=(r,b)=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let fails=0; const check=(n,v)=>{console.log((v?'PASS ':'FAIL ')+n); if(!v)fails++;};
for (const [ar, signed] of [[false,true],[true,true],[false,false],[true,false]]) {
 const p=await b.newPage({viewport:{width:420,height:900}});
 let loggedOut=false;
 await p.route(`**/${REF}.supabase.co/**`,(route)=>{const req=route.request(),url=req.url();
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(url.includes('/auth/v1/logout')){loggedOut=true;return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});}
  if(url.includes('/auth/v1/user'))return ok(route,session.user);
  if(url.includes('/rest/v1/profiles'))return ok(route,{id:USER,role:'vendor',full_name:'',phone:null,locale:'en'});
  if(url.includes('/rest/v1/salons'))return ok(route,[{id:'s1',owner_id:USER,slug:'k',name_en:'Kingdom Cuts',name_ar:'كينغدم',is_verified:true,is_published:true,closed_at:null,waitlist_enabled:true,slot_step_minutes:30,city:'Riyadh',area_en:'',area_ar:'',tags_en:'',tags_ar:'',category_en:'',category_ar:'',phone:null,latitude:null,longitude:null}]);
  return ok(route,[]);});
 if (signed) await p.addInitScript(([r,v])=>localStorage.setItem(`sb-${r}-auth-token`,JSON.stringify(v)),[REF,session]);
 await p.goto(BASE,{waitUntil:'networkidle'});
 if(ar){await p.getByRole('button',{name:'العربية'}).click();await p.waitForTimeout(300);}
 await p.getByRole('button',{name:/I own a salon|أملك صالون/i}).first().click();await p.waitForTimeout(900);
 if (signed) { await p.getByRole('button',{name:/^(Back|رجوع)$/}).first().click();await p.waitForTimeout(1000); }
 const more = p.getByRole('button',{name:/More|المزيد/i}).last();
 if (await more.count()) { await more.click(); } else { await p.evaluate(()=>0); }
 await p.waitForTimeout(600);
 const body=(await p.locator('body').innerText()).replace(/\n/g,' ');
 const L=(ar?'AR':'EN')+(signed?' signed in':' signed out');
 if (signed) {
  check(`${L}: shows the account`, body.includes('owner@kingdom.test') && body.includes(ar?'مسجّل الدخول باسم':'Signed in as'));
  await p.getByRole('button',{name:ar?/^تسجيل الخروج$/:/^Sign out$/}).click(); await p.waitForTimeout(800);
  check(`${L}: sign out signs out`, loggedOut);
 } else {
  check(`${L}: the registration form offers sign in`, body.includes(ar?'سجّلت صالونك من قبل':'Already registered your salon'));
  await p.getByRole('button',{name:ar?/^تسجيل الدخول$/:/^Sign in$/}).first().click(); await p.waitForTimeout(500);
  const b2=(await p.locator('body').innerText());
  check(`${L}: sign-in sheet opens, saying why`, /salon|صالون/i.test(b2) && /six-digit|code|رمز/i.test(b2));
 }
 await p.close();
}
await b.close(); console.log(fails?`${fails} failed`:'all passed');
process.exit(fails ? 1 : 0);
