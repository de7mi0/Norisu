/**
 * The decisions behind the reviewer sign-in, and nothing else.
 *
 * App Store and Google Play reviewers have to sign in, and Saloni signs people
 * in with a code sent to their e-mail — which a reviewer cannot read. Adding
 * passwords would break the one promise the sign-in makes (CLAUDE.md §6: there
 * is no password anywhere to reset, store or leak), so instead ONE account, the
 * one named in REVIEW_EMAIL, accepts ONE fixed six-digit code, REVIEW_CODE,
 * given to the reviewers in the store's review notes.
 *
 * Pure and dependency-free, like send-notifications/message.ts, so the part
 * that decides who gets in can be tested without Deno, a network or Supabase:
 * scripts/test-review-sign-in.mjs. index.ts does the talking.
 */

export interface ReviewConfig {
  /** Lower-cased. Empty means the feature is off. */
  email: string;
  /** Exactly six digits, or the feature is off. */
  code: string;
}

export type Decision =
  | { kind: 'disabled' }
  | { kind: 'badRequest' }
  | { kind: 'refused' }
  | { kind: 'allowed'; email: string };

/**
 * Off unless BOTH secrets are set, and the code is six digits — the length the
 * app's code field takes (CODE_LENGTH in src/lib/auth.ts). A shorter code would
 * be easier to guess; a longer one could never be typed into the field.
 */
export function readConfig(email: string | undefined, code: string | undefined): ReviewConfig | null {
  const e = (email ?? '').trim().toLowerCase();
  const c = (code ?? '').trim();
  if (!e || !e.includes('@') || !/^\d{6}$/.test(c)) return null;
  return { email: e, code: c };
}

/**
 * Compares without stopping at the first difference, so how long a wrong
 * answer takes says nothing about how much of it was right. Over a network
 * that is a small risk, and five tries an hour (0031) makes it smaller still,
 * but it costs nothing to close.
 */
export function sameSecret(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

/**
 * Who gets in. A wrong e-mail and a wrong code are refused identically, so the
 * answer never confirms which e-mail is the review account.
 */
export function decide(config: ReviewConfig | null, body: unknown): Decision {
  if (!config) return { kind: 'disabled' };
  if (typeof body !== 'object' || body === null) return { kind: 'badRequest' };
  const { email, code } = body as { email?: unknown; code?: unknown };
  if (typeof email !== 'string' || typeof code !== 'string') return { kind: 'badRequest' };
  if (email.length > 320 || code.length > 32) return { kind: 'badRequest' };

  const emailOk = sameSecret(email.trim().toLowerCase(), config.email);
  const codeOk = sameSecret(code.trim(), config.code);
  return emailOk && codeOk ? { kind: 'allowed', email: config.email } : { kind: 'refused' };
}
