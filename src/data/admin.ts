/**
 * Saloni's own back office.
 *
 * Approving a salon used to mean ticking two boxes in the Supabase table
 * editor, denying one meant doing nothing at all, and closing somebody else's
 * was not possible by any route. This module is the app's side of migration
 * 0021, which moved all of it in.
 *
 * **Why every call here is an RPC and none is a table write.** An
 * administrator signs in as `authenticated`, exactly like a customer or a
 * salon owner, and column privileges are granted to database roles rather than
 * to people — so there is no grant that says "authenticated may write
 * is_verified, but only when their profile says admin". 0004 revoked those
 * columns from `authenticated` outright, and that revocation is what makes a
 * salon unable to verify itself. The guard is therefore `is_admin()` inside
 * each function, and this module cannot route round it even by accident,
 * because there is nothing here it has the privilege to write directly.
 *
 * The same goes for reading: `cr_number` is in no SELECT grant (0015) and
 * `commission_bps` is in no grant at all (0018), so `admin_salons()` is the
 * only way either reaches a screen.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';

/**
 * `loading` — the answer is on its way.
 * `live`    — the real register.
 * `demo`    — no backend configured.
 * `denied`  — signed in, but not an administrator. Distinct from `error`
 *             because it is not a fault and the screen says something else.
 * `error`   — the query failed or timed out.
 */
export type AdminSource = 'loading' | 'live' | 'demo' | 'denied' | 'error';

/** Where a salon stands. Derived by the database, not by this module. */
export type AdminStatus = 'awaiting' | 'verified' | 'live' | 'rejected' | 'closed';

export interface AdminSalon {
  id: string;
  name: string;
  nameAr: string;
  /** The commercial registration number to check. Null only if never given. */
  crNumber: string | null;
  status: AdminStatus;
  /** The owner's sign-in address, for replying to a registration that is wrong. */
  ownerEmail: string | null;
  registeredAt: string;
  reviewedAt: string | null;
  /** Which administrator decided, so two people do not review the same salon. */
  reviewedByEmail: string | null;
  rejectionReason: string | null;
  closedAt: string | null;
  closedReason: string | null;
  /** Saloni's cut, in basis points. 500 = 5.00%. */
  commissionBps: number;
  services: number;
  team: number;
  /** Appointments still to come — what closing this salon would cancel. */
  upcoming: number;
}

export interface AdminState {
  salons: AdminSalon[];
  source: AdminSource;
}

/**
 * Why an action did not happen.
 *
 * `notAdmin`  — the guard refused. Someone's role changed under them.
 * `needsVerify` — publishing a salon nobody has checked.
 * `needsReason` — denying or closing without saying why.
 * `closed`    — the salon is already closed.
 * `range`     — a commission rate outside 0–100%.
 */
export type AdminFailure =
  | 'notAdmin'
  | 'needsVerify'
  | 'needsReason'
  | 'closed'
  | 'range'
  | 'network';

/** The longest reason the app will send. The database caps it again at 500. */
export const REASON_MAX_LENGTH = 500;

async function withTimeout<T>(call: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

interface AdminSalonRow {
  id: string;
  name_en: string;
  name_ar: string;
  cr_number: string | null;
  status: string;
  owner_email: string | null;
  registered_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  rejection_reason: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  commission_bps: number | string;
  services: number | string;
  team: number | string;
  upcoming: number | string;
}

const STATUSES: AdminStatus[] = ['awaiting', 'verified', 'live', 'rejected', 'closed'];

function mapSalon(row: AdminSalonRow): AdminSalon {
  return {
    id: row.id,
    name: row.name_en,
    nameAr: row.name_ar,
    crNumber: row.cr_number,
    // An unknown status reads as awaiting rather than throwing: a salon the
    // screen cannot label is still a salon somebody has to look at.
    status: STATUSES.includes(row.status as AdminStatus) ? (row.status as AdminStatus) : 'awaiting',
    ownerEmail: row.owner_email,
    registeredAt: row.registered_at,
    reviewedAt: row.reviewed_at,
    reviewedByEmail: row.reviewed_by_email,
    rejectionReason: row.rejection_reason,
    closedAt: row.closed_at,
    closedReason: row.closed_reason,
    commissionBps: Number(row.commission_bps ?? 0),
    services: Number(row.services ?? 0),
    team: Number(row.team ?? 0),
    upcoming: Number(row.upcoming ?? 0),
  };
}

/**
 * Every salon on the platform, awaiting-review first.
 *
 * The ordering is the database's, because the order somebody works through
 * these in is part of what the register is for.
 */
export async function loadAdminSalons(): Promise<AdminState> {
  if (!supabase) return { salons: [], source: 'demo' };

  try {
    const { data, error } = await withTimeout(supabase.rpc('admin_salons'));
    if (error) {
      // Not a fault. Somebody who is not an administrator opened the screen,
      // which the app should not have offered but the database refuses anyway.
      if (error.code === '42501') return { salons: [], source: 'denied' };
      throw new Error(error.message);
    }
    const rows = (data ?? []) as AdminSalonRow[];
    return { salons: rows.map(mapSalon), source: 'live' };
  } catch {
    // An empty register and a failed query look identical on screen unless
    // they are told apart here, and "no salons have registered" is a very
    // different thing to report than "we could not ask".
    return { salons: [], source: 'error' };
  }
}

interface RpcError {
  code?: string;
  message?: string;
}

function mapFailure(error: RpcError | null): AdminFailure | null {
  if (!error) return null;
  if (error.code === '42501') return 'notAdmin';
  if (error.code === 'SL030') return 'needsVerify';
  if (error.code === 'SL031') return 'needsReason';
  if (error.code === 'SL032') return 'closed';
  if (error.code === 'SL033') return 'range';
  return 'network';
}

async function call(name: string, args: Record<string, unknown>): Promise<AdminFailure | null> {
  if (!supabase) return 'network';
  try {
    const { error } = await withTimeout(supabase.rpc(name, args));
    return mapFailure(error);
  } catch {
    return 'network';
  }
}

/** Records that the commercial registration has been checked — or un-checks it. */
export function verifySalon(salonId: string, verified: boolean): Promise<AdminFailure | null> {
  return call('admin_verify_salon', { p_salon_id: salonId, p_verified: verified });
}

/**
 * Puts a verified salon in front of customers, or takes it back out.
 *
 * A second, separate decision from verifying. Taking a salon down stops new
 * bookings and cancels none — the appointments it already has are its
 * customers'.
 */
export function publishSalon(salonId: string, published: boolean): Promise<AdminFailure | null> {
  return call('admin_publish_salon', { p_salon_id: salonId, p_published: published });
}

/**
 * Turns a salon down, with a reason its owner reads.
 *
 * Reversible on purpose: correcting the registration number puts them straight
 * back in the queue, so this is a message rather than an ending.
 */
export function rejectSalon(salonId: string, reason: string): Promise<AdminFailure | null> {
  return call('admin_reject_salon', {
    p_salon_id: salonId,
    p_reason: reason.trim().slice(0, REASON_MAX_LENGTH),
  });
}

/**
 * Closes a salon that is not yours.
 *
 * Terminal, and it cancels other people's appointments — which is why the
 * reason is required by the database and not only by the screen.
 */
export function closeSalonAsAdmin(salonId: string, reason: string): Promise<AdminFailure | null> {
  return call('admin_close_salon', {
    p_salon_id: salonId,
    p_reason: reason.trim().slice(0, REASON_MAX_LENGTH),
  });
}

/**
 * Sets what a salon owes Saloni, in basis points.
 *
 * Applies to bookings made from now on. Every booking snapshots the rate it
 * was made under (0018), so agreeing new terms never re-prices an old invoice.
 */
export function setCommission(salonId: string, bps: number): Promise<AdminFailure | null> {
  return call('admin_set_commission', { p_salon_id: salonId, p_bps: Math.round(bps) });
}
