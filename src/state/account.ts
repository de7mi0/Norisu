import type { SessionValue } from './useSession';

/**
 * How to address the signed-in user on screen.
 *
 * Two sources, and they fill in at different moments: the session arrives
 * first and knows the mobile number or e-mail, while the `profiles` row —
 * which carries the name — follows a round trip later. These helpers always
 * have something to show, so nothing flickers through a blank.
 */

/**
 * What they signed in with: the mobile number, or the e-mail address. The
 * session is asked before the profile, so this stays the identity that was
 * actually used — a profile may carry a contact number that never signed
 * anything in.
 */
export function accountLabel(session: SessionValue, isArabic: boolean): string {
  const { user, profile } = session;
  const identifier = user?.phone || user?.email || profile?.phone || '';
  return identifier || (isArabic ? 'حساب' : 'Account');
}

/** Their name if the profile has one, otherwise what they signed in with. */
export function accountName(session: SessionValue, isArabic: boolean): string {
  return session.profile?.fullName.trim() || accountLabel(session, isArabic);
}

/** Two letters for the avatar circle; falls back to a neutral mark. */
export function accountInitials(session: SessionValue): string {
  const name = session.profile?.fullName.trim();
  if (name) {
    const letters = name
      .split(/\s+/)
      .map((word) => word[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    if (letters) return letters;
  }
  const email = session.user?.email;
  // An e-mail's first letter is still better than a shrug; a phone number's
  // first digit is not, so numbers get the mark instead.
  return email ? email.slice(0, 2).toUpperCase() : '✦';
}
