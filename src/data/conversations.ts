/**
 * Talking to a person: a customer and a salon, or a customer and Saloni.
 *
 * The app's side of migration 0025. Every call is an RPC and none is a table
 * read, because neither `conversations` nor `messages` is readable by any
 * browser role: who may write depends on which side of the conversation you
 * are on, and the database works that out from who you are rather than from
 * anything this module sends. So there is no `side` parameter anywhere here —
 * a side the caller chose would be a side the caller could lie about.
 *
 * There is no realtime subscription. The thread is re-read every few seconds
 * while it is open (see AppContext), which is plain and cheap at this size;
 * Supabase Realtime would need row policies these tables deliberately do not
 * have.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';

/**
 * `loading` — on its way.
 * `live`    — the real thing.
 * `demo`    — no backend configured, or nobody signed in.
 * `error`   — the query failed or timed out. Never shown as "no messages".
 */
export type MessagingSource = 'loading' | 'live' | 'demo' | 'error';

/** Who the other party is, from the reader's side. */
export interface ConversationSummary {
  id: string;
  /** The salon, for a customer's own list. Null for Saloni support. */
  salonId: string | null;
  /** The salon's name (customer's list) or the customer's (an inbox). */
  name: string;
  nameAr: string;
  /** False once a salon has closed: the thread stays readable, nobody answers. */
  canReply: boolean;
  lastBody: string;
  /** True when the last word was the reader's own. */
  lastMine: boolean;
  lastAt: string;
  unread: boolean;
}

export interface ThreadMessage {
  id: string;
  body: string;
  mine: boolean;
  at: string;
}

export interface Inbox {
  items: ConversationSummary[];
  source: MessagingSource;
}

export interface Thread {
  messages: ThreadMessage[];
  source: MessagingSource;
}

/**
 * Why a message did not go.
 *
 * `signedOut` — nobody is signed in; the app opens the sign-in sheet.
 * `closed`    — the salon has closed, or cannot be messaged by this account.
 * `ownSalon`  — an owner writing to their own salon.
 * `tooMany`   — the per-account limits in 0025.
 * `length`    — empty, or over 1000 characters.
 * `noBackend` — sample data only; nothing can be sent.
 * `failed`    — anything else, network included.
 */
export type MessageFailure =
  | 'signedOut'
  | 'closed'
  | 'ownSalon'
  | 'tooMany'
  | 'length'
  | 'noBackend'
  | 'failed';

/** The longest message 0025 accepts. The composer caps it as well. */
export const MESSAGE_MAX_LENGTH = 1000;

function failureFrom(error: { code?: string } | null): MessageFailure {
  switch (error?.code) {
    case 'SL040':
      return 'closed';
    case 'SL041':
      return 'tooMany';
    case 'SL042':
      return 'length';
    case 'SL044':
      return 'ownSalon';
    case '42501':
      return 'signedOut';
    default:
      return 'failed';
  }
}

// The same race as data/admin.ts: supabase-js retries internally and an
// abort signal does not stop it (CLAUDE.md §5).
async function withTimeout<T>(call: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

interface CustomerRow {
  conversation_id: string;
  salon_id: string | null;
  name_en: string;
  name_ar: string;
  can_reply: boolean;
  last_body: string | null;
  last_side: string;
  last_message_at: string;
  unread: boolean;
}

interface StaffRow {
  conversation_id: string;
  customer_name: string | null;
  last_body: string | null;
  last_side: string;
  last_message_at: string;
  unread: boolean;
}

interface MessageRow {
  id: string;
  body: string;
  mine: boolean;
  created_at: string;
}

/**
 * The reader's conversations. `customer` is the account's own list; `salon`
 * the owner's inbox; `support` Saloni's, for an administrator.
 *
 * A customer with no name given is shown to the salon as null, and the screen
 * says "Customer" — the same thing the calendar does — rather than inventing
 * one or showing anything else about them.
 */
export async function loadInbox(
  as: 'customer' | 'salon' | 'support',
  customerFallback: { en: string; ar: string },
): Promise<Inbox> {
  if (!supabase) return { items: [], source: 'demo' };

  try {
    if (as === 'customer') {
      const { data, error } = await withTimeout(supabase.rpc('my_conversations'));
      if (error) return { items: [], source: 'error' };
      const rows = (data ?? []) as CustomerRow[];
      return {
        source: 'live',
        items: rows.map((row) => ({
          id: row.conversation_id,
          salonId: row.salon_id,
          name: row.name_en,
          nameAr: row.name_ar,
          canReply: row.can_reply,
          lastBody: row.last_body ?? '',
          lastMine: row.last_side === 'customer',
          lastAt: row.last_message_at,
          unread: row.unread,
        })),
      };
    }

    const { data, error } = await withTimeout(
      supabase.rpc('staff_inbox', { p_support: as === 'support' }),
    );
    if (error) return { items: [], source: 'error' };
    const rows = (data ?? []) as StaffRow[];
    return {
      source: 'live',
      items: rows.map((row) => ({
        id: row.conversation_id,
        salonId: null,
        name: row.customer_name ?? customerFallback.en,
        nameAr: row.customer_name ?? customerFallback.ar,
        canReply: true,
        lastBody: row.last_body ?? '',
        lastMine: row.last_side !== 'customer',
        lastAt: row.last_message_at,
        unread: row.unread,
      })),
    };
  } catch {
    return { items: [], source: 'error' };
  }
}

/** One conversation, oldest first. Reading it marks it read for the reader. */
export async function loadThread(conversationId: string): Promise<Thread> {
  if (!supabase) return { messages: [], source: 'demo' };
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('conversation_messages', { p_conversation_id: conversationId }),
    );
    if (error) return { messages: [], source: 'error' };
    return {
      source: 'live',
      messages: ((data ?? []) as MessageRow[]).map((row) => ({
        id: row.id,
        body: row.body,
        mine: row.mine,
        at: row.created_at,
      })),
    };
  } catch {
    return { messages: [], source: 'error' };
  }
}

/**
 * Opens or continues a conversation with a salon — or with Saloni when
 * `salonId` is null — and says the first thing in it. The database reuses an
 * existing thread, so calling this twice never makes two.
 */
export async function startConversation(
  salonId: string | null,
  body: string,
): Promise<{ conversationId: string } | { failure: MessageFailure }> {
  if (!supabase) return { failure: 'noBackend' };
  const text = body.trim();
  if (!text || text.length > MESSAGE_MAX_LENGTH) return { failure: 'length' };
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('start_conversation', { p_salon_id: salonId, p_body: text }),
    );
    if (error || typeof data !== 'string') return { failure: failureFrom(error) };
    return { conversationId: data };
  } catch {
    return { failure: 'failed' };
  }
}

/** Adds a message to a conversation the caller is already part of. */
export async function postMessage(
  conversationId: string,
  body: string,
): Promise<MessageFailure | null> {
  if (!supabase) return 'noBackend';
  const text = body.trim();
  if (!text || text.length > MESSAGE_MAX_LENGTH) return 'length';
  try {
    const { error } = await withTimeout(
      supabase.rpc('post_message', { p_conversation_id: conversationId, p_body: text }),
    );
    return error ? failureFrom(error) : null;
  } catch {
    return 'failed';
  }
}
