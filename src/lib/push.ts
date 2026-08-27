/**
 * Push notifications, so a freed seat reaches the customer rather than waiting
 * for them to open the app.
 *
 * Web Push to begin with: an installed page can be notified while it is
 * closed, which is the whole point, and it needs no app store and no developer
 * account. The Capacitor wrap will register a native device against the same
 * `push_subscriptions` table through the same `register_push_device()` call,
 * so only the sender's last hop changes.
 *
 * Like `lib/auth.ts`, every call answers with `PushFailure | null` rather than
 * throwing. Being refused permission is an ordinary outcome, not an exception,
 * and the codes are translated by the dictionaries so the reasons read in
 * Arabic too.
 *
 * Nothing here promises the customer anything unless `VITE_VAPID_PUBLIC_KEY`
 * is set. Without it there is no key to subscribe with and no worker deployed
 * to send, so the app keeps its existing honest wording instead of offering to
 * notify somebody and then not doing it.
 */
import { supabase } from './supabase';

const vapidPublicKey: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

/** False until VAPID keys exist and the sender is deployed. See supabase/README.md. */
export const isPushConfigured = Boolean(vapidPublicKey);

export interface PushFailure {
  code:
    | 'notConfigured'
    | 'unsupported'
    | 'denied'
    | 'dismissed'
    | 'notSignedIn'
    | 'network'
    | 'unknown';
  detail?: string;
}

/**
 * Whether this browser can do it at all.
 *
 * iOS is the case that matters: Safari only exposes `PushManager` once the
 * page has been added to the home screen, so this is false in the ordinary
 * browser there and true in the installed copy. That is a real limitation to
 * design around, not a bug — see `isInstalled()`.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** True when running from a home screen rather than a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // Safari's own, which predates the standard property.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** What the browser currently thinks, without asking again. */
export function permission(): NotificationPermission | 'unsupported' {
  return isPushSupported() ? Notification.permission : 'unsupported';
}

/**
 * The VAPID public key travels as base64url and the subscribe call wants raw
 * bytes. Public by design — it is the key the push service checks our messages
 * against, and it ships in the bundle like the Supabase publishable key.
 */
function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Registers the worker. Safe to call on every load — the browser only installs
 * it once, and re-registering an unchanged file does nothing.
 */
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    // Relative, so it works from a domain root and from the /Norisu/ sub-path
    // GitHub Pages serves. The scope follows the directory it sits in.
    return await navigator.serviceWorker.register(
      new URL('sw.js', document.baseURI).toString(),
      { scope: new URL('.', document.baseURI).toString() },
    );
  } catch {
    return null;
  }
}

/** A short label so somebody can tell one of their own devices from another. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform =
    /iPhone|iPad|iPod/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : 'Browser';
  return isInstalled() ? `${platform} (installed)` : platform;
}

async function saveSubscription(sub: PushSubscription): Promise<PushFailure | null> {
  if (!supabase) return { code: 'notConfigured' };
  const { error } = await supabase.rpc('register_push_device', {
    p_endpoint: sub.endpoint,
    p_p256dh: encodeKey(sub.getKey('p256dh')),
    p_auth: encodeKey(sub.getKey('auth')),
    p_platform: 'web',
    p_label: deviceLabel(),
  });
  if (!error) return null;
  // 42501 is the function's own "sign in first".
  if (error.code === '42501') return { code: 'notSignedIn' };
  return { code: 'network', detail: error.message };
}

/**
 * Asks permission and registers this browser to be notified.
 *
 * Only ever call this from something the customer just did — joining the
 * waitlist — never on load. A permission prompt that arrives unprompted is the
 * one most people refuse, and a refusal is close to permanent: the browser
 * stops asking, and there is no way back except the site settings menu.
 */
export async function subscribe(): Promise<PushFailure | null> {
  if (!isPushConfigured) return { code: 'notConfigured' };
  if (!isPushSupported()) return { code: 'unsupported' };

  let granted: NotificationPermission;
  try {
    granted = await Notification.requestPermission();
  } catch (e) {
    return { code: 'unknown', detail: e instanceof Error ? e.message : undefined };
  }
  if (granted === 'denied') return { code: 'denied' };
  if (granted !== 'granted') return { code: 'dismissed' };

  const registration = await registerWorker();
  if (!registration) return { code: 'unsupported' };

  try {
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every browser: we may only push something the customer
        // actually sees. Silent background pushes are not on offer.
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidPublicKey) as BufferSource,
      }));
    return await saveSubscription(sub);
  } catch (e) {
    return { code: 'unknown', detail: e instanceof Error ? e.message : undefined };
  }
}

/**
 * Re-registers a subscription this browser already has.
 *
 * Push services rotate endpoints, and a subscription made before the customer
 * signed in belongs to nobody. Calling this after sign-in is what attaches an
 * existing subscription to the right account; `register_push_device()` is
 * idempotent, so doing it on every load costs one request and nothing else.
 */
export async function syncExisting(): Promise<void> {
  if (!isPushConfigured || !isPushSupported()) return;
  if (Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch {
    // A browser that will not tell us is not worth an error on screen.
  }
}

/** Stops this browser being notified, here and in the database. */
export async function unsubscribe(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await supabase?.rpc('forget_push_device', { p_endpoint: endpoint });
  } catch {
    // Nothing useful to say if the browser refuses; the row is harmless.
  }
}

/**
 * What to tell the customer, as one value the screens can switch on.
 *
 * `install` is the iPhone case and the reason this is not a boolean: Safari
 * hides push behind adding the page to the home screen, so the honest thing to
 * say there is "add Saloni to your home screen", not "your browser cannot do
 * this".
 */
export type PushState = 'off' | 'unsupported' | 'install' | 'ask' | 'on' | 'denied';

export function pushState(): PushState {
  if (!isPushConfigured) return 'off';
  if (!isPushSupported()) {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const isApple = /iPhone|iPad|iPod/.test(ua);
    return isApple && !isInstalled() ? 'install' : 'unsupported';
  }
  const current = Notification.permission;
  if (current === 'granted') return 'on';
  if (current === 'denied') return 'denied';
  return 'ask';
}
