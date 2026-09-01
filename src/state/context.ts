import { createContext, useContext, type Dispatch } from 'react';
import type { Availability } from '../data/availability';
import type {
  AppointmentStatus,
  VendorDay,
  VendorReviews,
} from '../data/vendorBookings';
import type { SalonPhoto } from '../data/photos';
import type { TimeBlock } from '../data/timeOff';
import type { MyWaitlist, SalonWaitlist, WaitlistRequest } from '../data/waitlist';
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
  /** That salon's photographs, cover first. Empty for a salon with none. */
  salonPhotos: SalonPhoto[];

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
  /**
   * That salon's appointments and figures for the day on screen — today on the
   * dashboard, the selected day on the calendar. `source` is `'demo'` when the
   * viewer owns no salon, which is what keeps the portal browsable for demos.
   */
  vendorDay: VendorDay;
  /** What the salon has taken off sale on the day being looked at. */
  timeBlocks: TimeBlock[];
  /** Marks a period unavailable. staffId null blocks the whole salon. */
  blockTime: (staffId: string | null, startsAt: Date, endsAt: Date, reason: string) => Promise<void>;
  /** Puts a blocked period back on sale. */
  unblockTime: (id: string) => Promise<void>;
  /** The salon's photographs, cover first. */
  photos: SalonPhoto[];
  /** True while one is being prepared and uploaded. */
  photoBusy: boolean;
  addPhoto: (file: File) => Promise<void>;
  removePhoto: (photo: SalonPhoto) => Promise<void>;
  setCoverPhoto: (photoId: string) => Promise<void>;
  /** That salon's own reviews, unpublished ones included. */
  vendorReviews: VendorReviews;
  /**
   * Moves one of the owner's appointments through its lifecycle. Which moves
   * are legal is decided by the database, not by the caller.
   */
  setAppointment: (bookingId: string, status: AppointmentStatus) => Promise<void>;
  /** Hands an appointment to another specialist; null means "any professional". */
  reassignTo: (bookingId: string, staffId: string | null) => Promise<void>;
  /** Answers a review. True once stored, so the form can close on success only. */
  answerReview: (reviewId: string, reply: string) => Promise<boolean>;

  /** What the signed-in customer is waiting for, and anything held for them. */
  myWaitlist: MyWaitlist;
  /** The owner's queue. `'demo'` when the viewer owns no salon. */
  salonWaitlist: SalonWaitlist;
  /** Puts the customer in the queue for a day, or a window inside it. */
  joinWaitlist: (request: WaitlistRequest) => Promise<void>;
  leaveWaitlist: (entryId: string) => Promise<void>;
  /** Takes an offered seat, booking it for real. */
  claimSeat: (offerId: string) => Promise<void>;
  /** The salon giving somebody longer. Refused when others are queued behind. */
  extendHold: (offerId: string) => Promise<void>;
  /** The salon sending a lapsed offer round again. */
  reoffer: (entryId: string) => Promise<void>;
  /**
   * Stores the signed-in customer's name on their profile. True once written;
   * the sheet stays open on false so nothing is typed twice.
   */
  saveMyName: (fullName: string) => Promise<boolean>;
  /** Changes the spacing between the times the booking screen offers. */
  setSlotStep: (minutes: number) => Promise<void>;
  /** Turns the salon's waitlist on or off. */
  setWaitlistEnabled: (enabled: boolean) => Promise<void>;
  /** Replaces one weekday's opening hours, or closes that day. */
  setDayHours: (day: DayHours) => Promise<void>;
  /** Registers a salon for the signed-in user. True once it exists. */
  registerSalon: (draft: SalonDraft) => Promise<boolean>;
  /** Updates the business profile of the salon they already own. */
  saveBusinessProfile: (draft: SalonDraft) => Promise<boolean>;
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
  confirmBooking: () => void | Promise<void>;
  openConversation: (target: 'chat' | 'bot') => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}
