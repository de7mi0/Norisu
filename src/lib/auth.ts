/**
 * Authentication against Supabase Auth.
 *
 * The flow is one-time-passcode only — no passwords, nothing to reset, nothing
 * to leak. Saudi Arabia's norm is an SMS code to a mobile number, so that is
 * what the screens are shaped around; e-mail is the same two steps and is what
 * runs until an SMS provider is paid for. Switching over is a matter of the
 * `VITE_AUTH_PHONE_OTP` flag, because both channels take the identical
 * "send a code, then verify it" path through this module.
 *
 * Every call here answers with `AuthFailure | null` rather than throwing:
 * a wrong passcode is an ordinary outcome of signing in, not an exception.
 */
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserProfileRow } from './database.types';
import type { Lang } from '../types';

/** Whether the SMS channel is offered. See supabase/README.md, "Turn on sign-in". */
export const isPhoneOtpEnabled = import.meta.env.VITE_AUTH_PHONE_OTP === 'true';

export type AuthChannel = 'phone' | 'email';

/** The channel to open on, given what the project actually has switched on. */
export const defaultChannel: AuthChannel = isPhoneOtpEnabled ? 'phone' : 'email';

/**
 * Why an attempt did not work, as a code the dictionaries can translate.
 * `detail` carries Supabase's own wording, and is only shown for `unknown`,
 * where an untranslated message beats a shrug.
 */
export interface AuthFailure {
  code:
    | 'notConfigured'
    | 'invalidEmail'
    | 'invalidPhone'
    | 'invalidCode'
    | 'expiredCode'
    | 'rateLimited'
    | 'providerDisabled'
    | 'network'
    | 'unknown';
  detail?: string;
}

export interface Profile {
  id: string;
  role: 'customer' | 'vendor' | 'admin';
  fullName: string;
  phone: string | null;
  locale: Lang;
}

/** The signed-in user, reduced to what the app displays. */
export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Saudi mobile numbers are nine digits beginning with 5, after the country code. */
const SAUDI_MOBILE = /^5\d{8}$/;

export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  return EMAIL.test(trimmed) ? trimmed : null;
}

/**
 * Accepts the forms a Saudi customer actually types — `05x xxx xxxx`,
 * `5xxxxxxxx`, `+966 5x xxx xxxx`, `00966…` — and returns E.164, which is the
 * only form Supabase accepts. `null` means it is not a Saudi mobile number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input
    .replace(/[\s()‎‏-]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.startsWith('966') ? digits.slice(3) : digits.replace(/^0/, '');
  return SAUDI_MOBILE.test(local) ? `+966${local}` : null;
}

export function normalizeIdentifier(channel: AuthChannel, input: string): string | null {
  return channel === 'phone' ? normalizePhone(input) : normalizeEmail(input);
}

/** Passcodes are six digits; anything else is not worth a round trip. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}

export const CODE_LENGTH = 6;

/**
 * Where the magic link in the e-mail should land. The build uses relative asset
 * paths, so the app can live at a sub-path (`/Norisu/`) — this reconstructs the
 * directory it is actually being served from rather than assuming the root.
 */
function appUrl(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/[^/]*$/, '');
}

/** Maps a Supabase error onto a code the dictionaries carry a sentence for. */
function classify(error: AuthError): AuthFailure {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'otp_expired' || /expired/i.test(message)) return { code: 'expiredCode' };
  if (code.startsWith('over_') || error.status === 429) return { code: 'rateLimited', detail: message };
  if (code.endsWith('_provider_disabled') || /provider.*(disabled|not enabled)|unsupported phone/i.test(message)) {
    return { code: 'providerDisabled', detail: message };
  }
  if (code === 'otp_disabled') return { code: 'providerDisabled', detail: message };
  if (/invalid|incorrect|token/i.test(message)) return { code: 'invalidCode' };
  // supabase-js surfaces an unreachable backend as a fetch failure with no status.
  if (error.status === 0 || /fetch|network/i.test(message)) return { code: 'network', detail: message };
  return { code: 'unknown', detail: message };
}

/** Anything thrown out of a call — usually the browser refusing to reach the host. */
function classifyThrown(thrown: unknown): AuthFailure {
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return { code: 'network', detail };
}

/**
 * Sends a passcode to `identifier`, which must already be normalised.
 * Creates the account if there isn't one — signing up and signing in are the
 * same act when there is no password to choose.
 */
export async function sendPasscode(
  channel: AuthChannel,
  identifier: string,
): Promise<AuthFailure | null> {
  if (!supabase) return { code: 'notConfigured' };
  try {
    const { error } =
      channel === 'phone'
        ? await supabase.auth.signInWithOtp({ phone: identifier })
        : await supabase.auth.signInWithOtp({
            email: identifier,
            // The same mail can carry a link as well as a code, so a customer
            // who taps the link instead of typing the digits still gets in.
            options: { emailRedirectTo: appUrl() },
          });
    return error ? classify(error) : null;
  } catch (thrown) {
    return classifyThrown(thrown);
  }
}

/** Exchanges a passcode for a session. supabase-js then persists it itself. */
export async function verifyPasscode(
  channel: AuthChannel,
  identifier: string,
  code: string,
): Promise<AuthFailure | null> {
  if (!supabase) return { code: 'notConfigured' };
  try {
    const { error } = await supabase.auth.verifyOtp(
      channel === 'phone'
        ? { phone: identifier, token: code, type: 'sms' }
        : { email: identifier, token: code, type: 'email' },
    );
    return error ? classify(error) : null;
  } catch (thrown) {
    return classifyThrown(thrown);
  }
}

export async function signOut(): Promise<AuthFailure | null> {
  if (!supabase) return { code: 'notConfigured' };
  try {
    const { error } = await supabase.auth.signOut();
    return error ? classify(error) : null;
  } catch (thrown) {
    return classifyThrown(thrown);
  }
}

export function userFromSession(session: Session | null): AuthUser | null {
  const user: User | undefined = session?.user;
  if (!user) return null;
  return { id: user.id, email: user.email ?? null, phone: user.phone || null };
}

function mapProfile(row: UserProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    locale: row.locale === 'ar' ? 'ar' : 'en',
  };
}

/**
 * The signed-in user's own profile row. A trigger on `auth.users` creates it,
 * so it exists by the time the first session does; `null` here means the read
 * itself failed, and the app falls back to what the session already tells it.
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, locale')
    .eq('id', userId)
    .maybeSingle<UserProfileRow>();
  if (error || !data) return null;
  return mapProfile(data);
}

/** Persists the language the user picked, so it follows them to another device. */
export async function saveProfileLocale(userId: string, locale: Lang): Promise<void> {
  if (!supabase) return;
  await supabase.from('profiles').update({ locale }).eq('id', userId);
}

/**
 * The longest name the app will store. Long enough for a full Arabic name with
 * patronymics, short enough that a paste of something else cannot fill a
 * salon's calendar with a wall of text.
 */
export const NAME_MAX_LENGTH = 60;

/**
 * Persists the name the customer chose to give.
 *
 * `profiles.full_name` had never been written by anything: every account signed
 * in with a blank name, so the vendor calendar had nobody to put against an
 * appointment. profiles_update_own already permits this — it is the user's own
 * row — so no policy work was needed, only somewhere to type it.
 */
export async function saveProfileName(
  userId: string,
  fullName: string,
): Promise<AuthFailure | null> {
  if (!supabase) return { code: 'notConfigured' };
  const trimmed = fullName.trim().slice(0, NAME_MAX_LENGTH);
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', userId);
  return error ? { code: 'network', detail: error.message } : null;
}

/** Registers for sign-in and sign-out, including those from another tab. */
export function onAuthChange(handler: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
