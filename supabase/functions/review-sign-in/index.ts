// Saloni — signing in an app-store reviewer.
//
// Reviewers cannot read the e-mail a passcode goes to, so the account named in
// REVIEW_EMAIL accepts the fixed code in REVIEW_CODE instead, and only that
// account. The app sends the e-mail and code here (src/lib/auth.ts) rather than
// to Supabase Auth; this checks them and hands back an ordinary session for
// that one account. Who gets in is decided in ./review.ts, which is pure and
// tested by scripts/test-review-sign-in.mjs.
//
// Off unless both secrets are set — and then it answers 404, as if absent.
//
// What stops it being a back door:
//   * One account. The e-mail is a secret beside the code, and a wrong e-mail
//     and a wrong code are refused with the same answer.
//   * Five wrong attempts in an hour, from anybody, and it stops for the rest
//     of that hour (migration 0031). A six-digit code is a million guesses;
//     at five an hour that is twenty-three years.
//   * Never an administrator. If REVIEW_EMAIL were ever set to a Saloni admin's
//     address by mistake, the fixed code would open the back office; it is
//     refused instead, before any session is made.
//   * It creates no account. The review account is made the ordinary way, by
//     signing in once with a real code; if it does not exist, this says so.
//
// Secrets (Edge Functions → Secrets), none of them in .env:
//   REVIEW_EMAIL   the review account's address, e.g. review@your-domain
//   REVIEW_CODE    six digits, given to Apple and Google in the review notes
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SALONI_SERVICE_KEY) — as the
//                  notification worker; see its header
//
// The app needs the same address in VITE_REVIEW_EMAIL (.env), so it knows not
// to send that account a code. That address is not a secret worth keeping —
// without REVIEW_CODE it opens nothing — but the code is.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decide, readConfig } from './review.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey =
  Deno.env.get('SALONI_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// The app calls this from a browser (and from the Android WebView), which asks
// first with OPTIONS. Any origin: the answer is only useful to whoever holds
// the code, and the app is served from github.io, a custom domain later, and
// https://localhost inside the native shell.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

// A fresh client per use: verifyOtp stores the session it receives in the
// client that made the call, and every request that client makes afterwards
// goes out as that user. The privileged calls must never share one with it.
const client = () =>
  createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const config = readConfig(Deno.env.get('REVIEW_EMAIL'), Deno.env.get('REVIEW_CODE'));
  if (!config || !serviceKey) return reply(404, { error: 'not_enabled' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'bad_request' });
  }

  const admin = client();

  // The lock is checked before the code, so a locked hour answers the same
  // whether the guess was right or wrong.
  const { data: open, error: lockError } = await admin.rpc('review_sign_in_allowed');
  if (lockError) return reply(500, { error: 'unavailable' });
  if (open !== true) return reply(429, { error: 'too_many_attempts' });

  const decision = decide(config, body);
  if (decision.kind === 'badRequest') return reply(400, { error: 'bad_request' });
  if (decision.kind === 'disabled') return reply(404, { error: 'not_enabled' });
  if (decision.kind === 'refused') {
    await admin.rpc('review_sign_in_failed');
    return reply(401, { error: 'invalid_code' });
  }

  // A one-time code for the account, made here rather than e-mailed. A
  // magiclink for an address with no account fails, so nothing is created.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: decision.email,
  });
  const otp = link?.properties?.email_otp;
  const userId = link?.user?.id;
  if (linkError || !otp || !userId) return reply(404, { error: 'review_account_missing' });

  const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
  if (!profile) return reply(404, { error: 'review_account_missing' });
  if (profile.role === 'admin') return reply(403, { error: 'review_account_is_admin' });

  const signer = client();
  let { data: verified, error: verifyError } = await signer.auth.verifyOtp({
    email: decision.email,
    token: otp,
    type: 'email',
  });
  if (verifyError || !verified.session) {
    // Older Auth servers expect a magic link's code to be verified as one.
    ({ data: verified, error: verifyError } = await signer.auth.verifyOtp({
      email: decision.email,
      token: otp,
      type: 'magiclink',
    }));
  }
  const session = verified?.session;
  if (verifyError || !session) return reply(500, { error: 'unavailable' });

  return reply(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
});
