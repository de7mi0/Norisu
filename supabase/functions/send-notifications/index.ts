// Saloni — the worker that drains the notifications outbox.
//
// NEVER RUN. Not once, not against a stub. The development sandbox cannot reach
// supabase.co or graph.facebook.com, and there is no approved WhatsApp template
// and no provider account to send through yet. Treat every line below as a
// starting point to verify, not as working code — in particular sendWhatsApp(),
// which is the only part shaped by somebody else's API.
//
// What it does: claims a batch of due messages, sends each, marks it sent or
// failed. All three steps go through database functions granted to service_role
// only (migration 0010), because draining the outbox means reading the phone
// number and name of everybody with a message waiting.
//
// Deploy:   supabase functions deploy send-notifications
// Schedule: every minute or two, via pg_cron or an external scheduler. Holds
//           are 15 minutes, so anything slower than a few minutes wastes them.
//
// Secrets it needs (supabase secrets set NAME=value) — none of these belong in
// .env, which is committed and inlined into the browser bundle:
//
//   SUPABASE_URL                  the project URL
//   SUPABASE_SERVICE_ROLE_KEY     the sb_secret_ key. This bypasses every
//                                 policy. It lives here and nowhere else.
//   WHATSAPP_PHONE_NUMBER_ID      from Meta's WhatsApp Manager
//   WHATSAPP_TOKEN                the permanent access token for that number
//
// See docs/whatsapp-waitlist-template.md for the template this sends and how
// to get it approved.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const BATCH = 20

type Claimed = {
  id: string
  channel: 'push' | 'whatsapp' | 'sms'
  template: string
  locale: 'en' | 'ar'
  payload: Record<string, unknown>
  attempts: number
  to_phone: string | null
  to_name: string | null
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// The five template variables, in the order the approved template declares
// them. Change one and the other must change with it, or Meta rejects the send.
function templateVariables(n: Claimed): string[] {
  const p = n.payload as {
    salon?: Record<string, string>
    services?: Record<string, string>
    starts_at?: string
    hold_minutes?: number
  }
  const locale = n.locale === 'ar' ? 'ar-SA' : 'en-GB'
  const starts = p.starts_at ? new Date(p.starts_at) : new Date()

  // Gregorian and Latin digits, for the same reasons src/i18n/index.ts forces
  // them: every stored date is Gregorian, and the rest of the message is in
  // Latin digits, so an Arabic locale would otherwise mix two numbering systems.
  const opts = { timeZone: 'Asia/Riyadh' } as const
  const date = starts.toLocaleDateString(`${locale}-u-ca-gregory-nu-latn`, {
    ...opts, weekday: 'long', day: 'numeric', month: 'long',
  })
  const time = starts.toLocaleTimeString(`${locale}-u-nu-latn`, {
    ...opts, hour: 'numeric', minute: '2-digit',
  })

  return [
    p.salon?.[n.locale] ?? '',
    p.services?.[n.locale] ?? '',
    date,
    time,
    String(p.hold_minutes ?? 15),
  ]
}

// The claim token, which is the whole point of the button: one tap opens the
// app at that seat. The database put the full URL in the payload; Meta wants
// only the part after the template's fixed prefix.
function claimSuffix(n: Claimed): string {
  const url = String((n.payload as { claim_url?: string }).claim_url ?? '')
  return url.split('claim=')[1] ?? ''
}

// VERIFY THIS AGAINST YOUR PROVIDER'S CURRENT DOCUMENTATION. The shape below is
// Meta's Cloud API. Unifonic, Twilio and 360dialog each wrap it differently —
// if you go through one of them, this function is the only one to rewrite.
async function sendWhatsApp(n: Claimed): Promise<void> {
  if (!n.to_phone) throw new Error('no phone number on the profile')

  const id = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const token = Deno.env.get('WHATSAPP_TOKEN')
  if (!id || !token) throw new Error('WhatsApp credentials are not configured')

  const res = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: n.to_phone,
      type: 'template',
      template: {
        name: n.template,
        language: { code: n.locale === 'ar' ? 'ar' : 'en' },
        components: [
          {
            type: 'body',
            parameters: templateVariables(n).map((text) => ({ type: 'text', text })),
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: claimSuffix(n) }],
          },
        ],
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

Deno.serve(async () => {
  // Claims the batch and counts an attempt against each, so a worker that dies
  // mid-send cannot spin on the same row forever. Rows whose hold has since
  // lapsed, or whose seat has been taken, are skipped here rather than sent.
  const { data, error } = await admin.rpc('claim_pending_notifications', { p_limit: BATCH })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const claimed = (data ?? []) as Claimed[]
  let sent = 0
  let failed = 0

  for (const n of claimed) {
    try {
      if (n.channel === 'whatsapp') {
        await sendWhatsApp(n)
      } else {
        // Push arrives with the Capacitor wrap and a device-token table; 0010
        // does not queue it, so reaching here means somebody added a channel
        // without adding a way to send it.
        throw new Error(`no sender for channel ${n.channel}`)
      }
      await admin.rpc('mark_notification_sent', { p_id: n.id })
      sent++
    } catch (e) {
      // Recorded, retried after five minutes, and given up on after five
      // attempts — a number that has been disconnected should stop costing
      // requests.
      await admin.rpc('mark_notification_failed', {
        p_id: n.id,
        p_error: e instanceof Error ? e.message : String(e),
      })
      failed++
    }
  }

  return new Response(JSON.stringify({ claimed: claimed.length, sent, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
