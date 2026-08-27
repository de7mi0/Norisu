// Saloni — the worker that drains the notifications outbox.
//
// Claims a batch of due messages, pushes each to every device its owner has
// registered, and marks it sent or failed. All three steps go through database
// functions granted to service_role alone (0010, 0011), because draining the
// outbox means reading who is waiting and how to reach them.
//
// HONESTY ABOUT WHAT IS TESTED. This file has never run: the sandbox it was
// written in reaches neither supabase.co nor a push service. Two of its three
// parts were checked properly and one was not:
//
//   * The words a customer reads are composed in ./message.ts, which is pure
//     and is covered by scripts/test-notification-text.mjs — 17 checks in both
//     languages, including the Gregorian calendar and Latin digits that have
//     gone wrong in this project before.
//   * The encryption and VAPID signing are web-push's, and its API was checked
//     rather than recalled: generateRequestDetails() on a real P-256
//     subscription returns a POST with Content-Encoding aes128gcm and a
//     `vapid t=` Authorization header, which is the protocol.
//   * The loop below — claiming, sending, marking, retiring dead devices — is
//     the part that has only been reasoned about. Watch the first real run.
//
// Deploy:   supabase functions deploy send-notifications
// Schedule: every minute or two. Holds are 15 minutes, so anything slower
//           wastes them.
//
// Secrets (supabase secrets set NAME=value). None belong in .env, which is
// committed and inlined into the browser bundle:
//
//   SUPABASE_URL                the project URL
//   SUPABASE_SERVICE_ROLE_KEY   the sb_secret_ key. Bypasses every policy.
//   VAPID_PUBLIC_KEY            the public half — the same value as the app's
//                               VITE_VAPID_PUBLIC_KEY, or nothing will decrypt
//   VAPID_PRIVATE_KEY           the private half. Never anywhere else.
//   VAPID_SUBJECT               a mailto: or https: URL identifying you, which
//                               push services require so they can complain
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { composeMessage, type Locale, type OfferPayload } from './message.ts';

const BATCH = 20;

interface Device {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: 'web' | 'ios' | 'android';
}

interface Claimed {
  id: string;
  channel: 'push' | 'whatsapp' | 'sms';
  template: string;
  locale: Locale;
  payload: OfferPayload & { expires_at?: string };
  attempts: number;
  to_phone: string | null;
  to_name: string | null;
  devices: Device[];
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

/**
 * How long the push service should keep trying, in seconds.
 *
 * Bounded by the hold: a notification delivered after the seat has passed to
 * the next person is worse than none, because it is the kind that teaches
 * people to stop opening them. A phone that has been off for the whole hold
 * should simply never receive this.
 */
function ttlSeconds(payload: { expires_at?: string }): number {
  if (!payload.expires_at) return 600;
  const left = Math.floor((new Date(payload.expires_at).getTime() - Date.now()) / 1000);
  return Math.max(60, Math.min(left, 3600));
}

/** True when the push service says this endpoint is gone for good. */
function isDead(status: number): boolean {
  return status === 404 || status === 410;
}

async function pushToDevices(n: Claimed): Promise<void> {
  if (n.devices.length === 0) throw new Error('no registered device');

  const message = JSON.stringify(composeMessage(n.payload, n.locale));
  const ttl = ttlSeconds(n.payload);

  let delivered = 0;
  const problems: string[] = [];

  for (const device of n.devices) {
    // Native devices will register here too once the Capacitor wrap exists,
    // and they do not speak Web Push. Skipping rather than failing keeps one
    // old iPhone from blocking the laptop that would have worked.
    if (device.platform !== 'web') {
      problems.push(`${device.platform}: no sender yet`);
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        message,
        { TTL: ttl },
      );
      delivered += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      if (isDead(status)) {
        // Uninstalled, or permission revoked. The browser never tells us, so
        // this is the only moment we find out. Clear it out rather than
        // retrying it every offer forever.
        await admin.rpc('retire_push_device', { p_endpoint: device.endpoint });
        problems.push(`${status} gone, retired`);
      } else {
        problems.push(`${status || 'error'}: ${(e as Error).message}`.slice(0, 120));
      }
    }
  }

  // One device reached is a notification delivered. Only a clean sweep of
  // failures is a failure, or a customer with a dead old device would never be
  // told anything.
  if (delivered === 0) throw new Error(problems.join('; ') || 'no device accepted it');
}

Deno.serve(async () => {
  // Rows whose hold has lapsed or whose seat has been taken are filtered out
  // here rather than sent — see claim_pending_notifications().
  const { data, error } = await admin.rpc('claim_pending_notifications', { p_limit: BATCH });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const claimed = (data ?? []) as Claimed[];
  let sent = 0;
  let failed = 0;

  for (const n of claimed) {
    try {
      if (n.channel !== 'push') {
        // WhatsApp is built in the database and switched off in
        // notification_settings.channels. If it is ever switched back on, this
        // is the branch to write — see docs/whatsapp-waitlist-template.md.
        // Saying so beats retrying a row five times in silence.
        throw new Error(`no sender for channel ${n.channel}`);
      }
      await pushToDevices(n);
      await admin.rpc('mark_notification_sent', { p_id: n.id });
      sent += 1;
    } catch (e) {
      await admin.rpc('mark_notification_failed', {
        p_id: n.id,
        p_error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  return Response.json({ claimed: claimed.length, sent, failed });
});
