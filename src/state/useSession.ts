import { useCallback, useEffect, useState } from 'react';
import {
  currentSession,
  fetchProfile,
  onAuthChange,
  saveProfileLocale,
  saveProfileName,
  signOut as signOutRequest,
  userFromSession,
  type AuthUser,
  type Profile,
} from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Lang } from '../types';

/**
 * unavailable — no backend configured, so signing in is not possible at all
 * loading     — checking whether a stored session is still valid
 * signedOut   — browsing anonymously, which the catalogue policies allow
 * signedIn    — `user` is set; `profile` follows a moment later
 */
export type AuthStatus = 'unavailable' | 'loading' | 'signedOut' | 'signedIn';

export interface SessionValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** The `profiles` row. Null while it loads, or if the read failed. */
  profile: Profile | null;
  signOut: () => Promise<void>;
  /** Writes the language choice to the profile so it follows the account. */
  setProfileLocale: (locale: Lang) => void;
  /**
   * Writes the name the customer gave. True once it is stored — the caller
   * closes its form on true and leaves it open, with the value intact, on false.
   */
  setProfileName: (fullName: string) => Promise<boolean>;
}

/**
 * Tracks who is signed in. supabase-js restores and refreshes the session from
 * storage on its own; this listens rather than driving it, so a sign-in from
 * another tab lands here too.
 */
export function useSession(): SessionValue {
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? 'loading' : 'unavailable',
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    const apply = (nextUser: AuthUser | null) => {
      if (cancelled) return;
      setUser((previous) => (previous?.id === nextUser?.id ? previous : nextUser));
      setStatus(nextUser ? 'signedIn' : 'signedOut');
    };

    // The listener fires with the restored session as soon as it is attached,
    // but only once storage has been read — this settles the status even if
    // that read is slow or there was never a session to restore.
    const unsubscribe = onAuthChange((session) => apply(userFromSession(session)));
    void currentSession().then((session) => apply(userFromSession(session)));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Deliberately a separate effect: Supabase holds an internal lock while an
  // auth-change callback runs, and querying from inside one can deadlock.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void fetchProfile(user.id).then((row) => {
      if (!cancelled) setProfile(row);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const signOut = useCallback(async () => {
    await signOutRequest();
    // Not strictly needed — the listener reports it — but it makes the screen
    // change over immediately rather than after a round trip.
    setUser(null);
    setProfile(null);
    setStatus(isSupabaseConfigured ? 'signedOut' : 'unavailable');
  }, []);

  const setProfileLocale = useCallback(
    (locale: Lang) => {
      if (!profile || profile.locale === locale) return;
      setProfile({ ...profile, locale });
      void saveProfileLocale(profile.id, locale);
    },
    [profile],
  );

  const setProfileName = useCallback(
    async (fullName: string): Promise<boolean> => {
      if (!profile) return false;
      const failure = await saveProfileName(profile.id, fullName);
      if (failure) return false;
      // Only after the write: showing the new name and then losing it on the
      // next profile read would be worse than the form staying open.
      setProfile({ ...profile, fullName: fullName.trim() });
      return true;
    },
    [profile],
  );

  return { status, user, profile, signOut, setProfileLocale, setProfileName };
}
