/**
 * Whether Saloni is running inside the native shell rather than a browser.
 *
 * Capacitor puts this same build inside a WebView, so almost nothing needs to
 * know the difference — that is the point of wrapping rather than rewriting.
 * Three things do:
 *
 *   * The Android hardware back button, which has no web equivalent and which
 *     closes the app outright if nobody handles it (`hooks/useHardwareBack`).
 *   * Web push, which the system WebView does not provide. Saying so is better
 *     than a permission prompt that leads nowhere — see `lib/push.ts`.
 *   * Safe areas, because a native app draws under the status bar and the
 *     gesture line where a browser tab does not.
 *
 * Detected from the global Capacitor injects rather than from the user agent,
 * which lies. On the web the global is absent and every check below is false,
 * so the browser build is untouched.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the Android or iOS shell, false in any browser. */
export function isNativeApp(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    // A malformed global is not worth taking the app down for: treat anything
    // unreadable as the web, which is the behaviour that has always worked.
    return false;
  }
}

/** `'android'`, `'ios'`, or `'web'` — including for a browser with no Capacitor. */
export function nativePlatform(): string {
  try {
    return capacitor()?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}

/** True only in the Android shell, where the hardware back button exists. */
export function isAndroidApp(): boolean {
  return isNativeApp() && nativePlatform() === 'android';
}
