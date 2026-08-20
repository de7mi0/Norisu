import { createContext, useContext, type Dispatch } from 'react';
import type { Availability } from '../data/availability';
import type {
  DayHours,
  OwnerState,
  SalonDraft,
  ServiceDraft,
  StaffDraft,
} from '../data/owner';
import type { Action, AppState } from './appReducer';
import type { Dictionary } from '../i18n';
import type { Booking, Salon, Service, StaffMember } from '../types';
import type { BotTopicKey } from './replies';
import type { SessionValue } from './useSession';

/**
 * Where the catalogue on screen came from:
 *   demo    — the bundled sample data; no backend configured
 *   loading — the first fetch is in flight
 *   live    — read from Supabase
 *   error   — the backend was configured but unreachable, showing demo data
 */
export type CatalogSource = 'demo' | 'loading' | 'live' | 'error';

/**
 * The bookable date `offset` days from today, at midnight local time.
 *
 * This used to be a fixed 31 July 2026, which was harmless while bookings only
 * lived in the browser. Now that they are written to the database with real
 * timestamps, a frozen calendar would file every new appointment weeks in the
 * past and put it straight into the "past" tab.
 */
export function dateAtOffset(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

export interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;

  /** Active dictionary and direction helpers. */
  t: Dictionary;
  isArabic: boolean;
  dir: 'rtl' | 'ltr';
  backIcon: string;
  arrow: string;
  chevron: string;
  money: (amount: number) => string;

  /** Where the salon catalogue currently comes from. */
  catalogSource: CatalogSource;
  /** Set when the backend was configured but could not be reached. */
  catalogError: string | null;
  salons: Salon[];
  /** Services and staff offered by the salon currently being viewed. */
  salonServices: Service[];
  salonStaff: StaffMember[];

  salon: Salon;
  selectedServices: Service[];
  totals: { subtotal: number; total: number; savings: number; vat: number; grandTotal: number };
  staffName: string;
  dateSummary: string;
  slotSummary: string;
  /** The times the salon can actually take, for the chosen day and staff. */
  availability: Availability;

  /** The salon the signed-in user owns, if any. Drives the vendor portal. */
  owner: OwnerState;
  /** Changes the spacing between the times the booking screen offers. */
  setSlotStep: (minutes: number) => Promise<void>;
  /** Replaces one weekday's opening hours, or closes that day. */
  setDayHours: (day: DayHours) => Promise<void>;
  /** Registers a salon for the signed-in user. True once it exists. */
  registerSalon: (draft: SalonDraft) => Promise<boolean>;
  /** Adds a service, or updates the one named. */
  saveService: (draft: ServiceDraft, serviceId?: string) => Promise<boolean>;
  /** Archives a service. Never deletes: bookings reference it. */
  removeService: (serviceId: string) => Promise<boolean>;
  /** The Live / Hidden switch. */
  toggleServiceLive: (serviceId: string, isActive: boolean) => Promise<boolean>;
  /** Adds a team member, or updates the one named. */
  saveStaff: (draft: StaffDraft, staffId?: string) => Promise<boolean>;
  /** Archives a team member. */
  removeStaff: (staffId: string) => Promise<boolean>;

  /** Who is signed in, and the profile row that goes with them. */
  session: SessionValue;
  /** Sends a passcode to the identifier currently typed into the sign-in sheet. */
  requestPasscode: () => void;
  /** Exchanges the typed passcode for a session. */
  submitPasscode: () => void;
  signOut: () => void;

  /** The two tabs of "My bookings", already split and sorted. */
  upcomingBookings: Booking[];
  pastBookings: Booking[];
  /**
   * True when bookings are being written to the database. False means there is
   * no backend or nobody signed in, and they live only in this browser.
   */
  bookingsPersisted: boolean;
  bookingsLoading: boolean;
  /** Reference of the booking just made, for the confirmation screen. */
  lastReference: string;
  /** Moves the booking being rescheduled to the slot now selected. */
  rescheduleBooking: () => Promise<void>;
  cancelBooking: (bookingId: string) => Promise<void>;

  /** Shows a transient toast; a second call replaces the first. */
  flash: (message: string) => void;
  sendChat: () => void;
  sendBot: () => void;
  pickBotTopic: (key: BotTopicKey) => void;
  joinWaitlist: () => void;
  confirmBooking: () => void | Promise<void>;
  openConversation: (target: 'chat' | 'bot') => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}
