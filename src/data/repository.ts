import { supabase } from '../lib/supabase';
import type { SalonRatingRow, SalonRow, ServiceRow, StaffRow } from '../lib/database.types';
import type { Salon, Service, StaffMember } from '../types';
import { tile } from '../theme';
import { SALONS } from './salons';
import { SERVICES } from './services';
import { ANY_PROFESSIONAL, STAFF } from './staff';

export interface Catalog {
  salons: Salon[];
  servicesBySalon: Record<string, Service[]>;
  staffBySalon: Record<string, StaffMember[]>;
}

/** Placeholder artwork, assigned per salon until real photos are uploaded. */
const TILES = [tile.sand, tile.taupe, tile.blush, tile.stone];
const STAFF_TILES = [tile.sandFine, tile.taupeFine, tile.blushFine];

/** Prices are stored as integer halalas; the UI works in whole riyals. */
function halalasToRiyals(halalas: number): number {
  return Math.round(halalas / 100);
}

function mapService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name_en,
    ar: row.name_ar,
    dur: `${row.duration_minutes} min`,
    price: halalasToRiyals(row.price_halalas),
    discount: row.discount_percent,
    // Kept exact alongside the rounded display price, for booking snapshots.
    priceHalalas: row.price_halalas,
    durationMinutes: row.duration_minutes,
  };
}

function mapStaff(row: StaffRow, index: number): StaffMember {
  return {
    id: row.id,
    name: row.name_en,
    arName: row.name_ar,
    role: row.role_en,
    arRole: row.role_ar,
    // Ratings per staff member are not modelled yet.
    rating: null,
    years: '',
    initials: row.initials,
    tile: STAFF_TILES[index % STAFF_TILES.length],
  };
}

/** The "first available, no preference" option is a UI affordance, not a row. */
function anyProfessionalOption(): StaffMember {
  return {
    id: 'any',
    name: ANY_PROFESSIONAL.en,
    arName: ANY_PROFESSIONAL.ar,
    role: 'First available — no preference',
    arRole: 'أول متاح — بدون تفضيل',
    rating: null,
    years: '',
    initials: '✦',
    tile: tile.plain,
  };
}

function mapSalon(
  row: SalonRow,
  index: number,
  services: Service[],
  rating: SalonRatingRow | undefined,
): Salon {
  // The salon-level badge and "from" price are derived from its live services.
  const discount = services.reduce((max, service) => Math.max(max, service.discount), 0);
  const priceFrom = services.length
    ? services.reduce((min, service) => Math.min(min, service.price), Number.POSITIVE_INFINITY)
    : 0;

  return {
    id: row.id,
    name: row.name_en,
    ar: row.name_ar,
    tags: row.tags_en,
    tagsAr: row.tags_ar,
    cat: row.category_en,
    catAr: row.category_ar,
    rating: rating?.rating ?? null,
    reviews: rating?.review_count ?? 0,
    // Distance needs the customer's location, which the app does not ask for yet.
    distance: '',
    area: row.area_en,
    arArea: row.area_ar,
    discount,
    priceFrom,
    tile: TILES[index % TILES.length],
  };
}

/** The bundled demo data, shaped like a catalog, for when there is no backend. */
export function demoCatalog(): Catalog {
  const servicesBySalon: Record<string, Service[]> = {};
  const staffBySalon: Record<string, StaffMember[]> = {};
  for (const salon of SALONS) {
    servicesBySalon[salon.id] = SERVICES;
    staffBySalon[salon.id] = STAFF;
  }
  return { salons: SALONS, servicesBySalon, staffBySalon };
}

/**
 * How long to wait for the catalogue before giving up and showing demo data.
 * supabase-js retries a failed request several times of its own accord, which
 * can stretch an unreachable database into a long silent wait; this caps it.
 */
const LOAD_TIMEOUT_MS = 6000;

/**
 * Reads the published catalog. Anonymous visitors are allowed to see exactly
 * this much by the row-level security policies — published salons and their
 * live services and staff, and nothing else.
 */
export async function loadCatalog(): Promise<Catalog> {
  if (!supabase) throw new Error('Supabase is not configured');

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  // The signal cancels the network work; the race is what actually bounds the
  // wait, because supabase-js retries internally and does not always give up
  // when the signal fires.
  const expiry = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fetchCatalog(controller.signal), expiry]);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCatalog(signal: AbortSignal): Promise<Catalog> {
  if (!supabase) throw new Error('Supabase is not configured');

  const [salonsResult, servicesResult, staffResult, ratingsResult] = await Promise.all([
    supabase
      .from('salons')
      .select('*')
      .eq('is_published', true)
      .order('name_en')
      .abortSignal(signal)
      .returns<SalonRow[]>(),
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .eq('is_archived', false)
      .order('sort_order')
      .abortSignal(signal)
      .returns<ServiceRow[]>(),
    supabase
      .from('staff')
      .select('*')
      .eq('is_active', true)
      .eq('is_archived', false)
      .order('sort_order')
      .abortSignal(signal)
      .returns<StaffRow[]>(),
    supabase.from('salon_ratings').select('*').abortSignal(signal).returns<SalonRatingRow[]>(),
  ]);

  const failure =
    salonsResult.error ?? servicesResult.error ?? staffResult.error ?? ratingsResult.error;
  if (failure) throw new Error(failure.message);

  const serviceRows = servicesResult.data ?? [];
  const staffRows = staffResult.data ?? [];
  const ratingRows = ratingsResult.data ?? [];

  const servicesBySalon: Record<string, Service[]> = {};
  for (const row of serviceRows) {
    (servicesBySalon[row.salon_id] ??= []).push(mapService(row));
  }

  const staffBySalon: Record<string, StaffMember[]> = {};
  for (const row of staffRows) {
    const list = (staffBySalon[row.salon_id] ??= []);
    list.push(mapStaff(row, list.length));
  }
  // Every salon offers the "any professional" choice.
  for (const salonId of Object.keys(staffBySalon)) {
    staffBySalon[salonId].push(anyProfessionalOption());
  }

  const ratingBySalon = new Map(ratingRows.map((row) => [row.salon_id, row]));

  const salons = (salonsResult.data ?? []).map((row, index) =>
    mapSalon(row, index, servicesBySalon[row.id] ?? [], ratingBySalon.get(row.id)),
  );

  return { salons, servicesBySalon, staffBySalon };
}
