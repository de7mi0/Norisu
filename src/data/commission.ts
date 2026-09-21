/**
 * What the salon owes Saloni, and why it can see it at all.
 *
 * Saloni takes a percentage of each booking rather than a subscription, so
 * every salon receives an invoice. This reads the same figure the invoice will
 * be built from — `commission_statement()` (migration 0018), which sums the
 * per-booking snapshot rather than re-deriving from the current rate, so a
 * salon's history never re-prices when its deal changes.
 *
 * **Why the owner sees it rather than only Saloni.** A bill the payer cannot
 * check before it arrives is a bill they have to take on trust, and the first
 * one is exactly when a salon decides whether this is a business they want to
 * be in. The function answers to Saloni's admin and to that salon's own owner
 * from the identical rows, so the two sides cannot disagree about the number.
 *
 * It counts `completed` bookings only — a cancellation and a no-show gave no
 * service, and a future appointment has not happened yet — and walk-ins carry
 * no commission at all, because Saloni introduced nobody. Both of those are
 * the database's decisions, not this module's; see the migration header.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';

/**
 * `loading` — the answer is on its way.
 * `live`    — this salon's real figures.
 * `demo`    — no backend, or this account owns no salon.
 * `error`   — the query failed or timed out.
 *
 * Deliberately the same union the rest of the vendor portal uses, minus
 * `'closed'`: a period with no completed visits is a real answer worth zero,
 * not a failure to load one.
 */
export type CommissionSource = 'loading' | 'live' | 'demo' | 'error';

export interface CommissionPeriod {
  /** First instant of the period, inclusive. */
  from: Date;
  /** First instant of the next period, exclusive. */
  to: Date;
  /** Completed visits in the window. */
  bookings: number;
  /** What those visits billed, in whole riyals. */
  gross: number;
  /** What Saloni is owed for them, in whole riyals. */
  commission: number;
}

export interface CommissionState {
  thisMonth: CommissionPeriod | null;
  lastMonth: CommissionPeriod | null;
  source: CommissionSource;
}

/** Races a call against the shared timeout rather than hanging on it. */
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

/**
 * The first instant of the month `back` months before the one `now` is in.
 *
 * Built from the browser's own calendar rather than from a date string, so the
 * boundary is a real month boundary in the viewer's clock. The statement is
 * billed in Riyadh time, which is where every salon is; a month boundary is
 * the one place that distinction is small enough not to matter, and a salon
 * reading this from another timezone sees its own month rather than a window
 * silently shifted by three hours.
 */
function monthStart(now: Date, back: number): Date {
  return new Date(now.getFullYear(), now.getMonth() - back, 1, 0, 0, 0, 0);
}

interface StatementRow {
  bookings_count: number;
  gross_halalas: number | string;
  commission_halalas: number | string;
}

/**
 * Halalas to whole riyals. The screen never shows halalas: an invoice total
 * with two decimal places invites somebody to check the arithmetic on a phone,
 * and the figure that settles the invoice is the database's, not this one.
 */
function toRiyals(halalas: number | string): number {
  return Math.round(Number(halalas ?? 0) / 100);
}

async function readPeriod(
  salonId: string,
  from: Date,
  to: Date,
): Promise<CommissionPeriod | null> {
  if (!supabase) return null;

  const { data, error } = await withTimeout(
    supabase.rpc('commission_statement', {
      p_salon_id: salonId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
  );
  if (error) throw new Error(error.message);

  // The function returns one row. An empty period still returns it, with
  // zeroes — so nothing here should treat "no rows" as "no data".
  const row = (Array.isArray(data) ? data[0] : data) as StatementRow | undefined;

  return {
    from,
    to,
    bookings: Number(row?.bookings_count ?? 0),
    gross: toRiyals(row?.gross_halalas ?? 0),
    commission: toRiyals(row?.commission_halalas ?? 0),
  };
}

/**
 * This month and last, for a salon the caller owns.
 *
 * Both periods are asked for together because the screen shows them together,
 * and a salon comparing the two is the whole reason last month is there: the
 * question an owner actually has is "is this more than I paid before?".
 */
export async function loadCommission(salonId: string): Promise<CommissionState> {
  if (!supabase) return { thisMonth: null, lastMonth: null, source: 'demo' };

  const now = new Date();
  const thisStart = monthStart(now, 0);
  const lastStart = monthStart(now, 1);
  const nextStart = monthStart(now, -1);

  try {
    const [thisMonth, lastMonth] = await Promise.all([
      readPeriod(salonId, thisStart, nextStart),
      readPeriod(salonId, lastStart, thisStart),
    ]);
    return { thisMonth, lastMonth, source: 'live' };
  } catch {
    // A salon that cannot read its own statement is shown nothing rather than
    // a zero. Zero is a figure, and an invoice that says nothing is owed when
    // the query merely failed is the worst possible way to be wrong here.
    return { thisMonth: null, lastMonth: null, source: 'error' };
  }
}
