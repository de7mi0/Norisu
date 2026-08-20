import type {
  ChatMessage,
  CustomerScreen,
  Lang,
  Mode,
  Screen,
  VendorScreen,
  VendorService,
  VendorStaff,
} from '../types';
import { BOT_GREETING, MAX_FIELD_LENGTH, MAX_MESSAGE_LENGTH, SALON_GREETING } from './replies';
import {
  defaultChannel,
  normalizeCode,
  NAME_MAX_LENGTH,
  type AuthChannel,
  type AuthFailure,
} from '../lib/auth';
import { tile } from '../theme';

export interface ServiceForm {
  name: string;
  price: string;
  dur: string;
}

/**
 * The sign-in sheet's own state. The session itself is not here — it lives with
 * Supabase and is read through `useSession` — this is only what the two steps
 * of the form need to draw themselves.
 */
export interface AuthForm {
  channel: AuthChannel;
  /** What the customer typed: a mobile number or an e-mail address. */
  identifier: string;
  code: string;
  step: 'identifier' | 'code';
  /** A request is in flight; the buttons are disabled while it is. */
  pending: boolean;
  error: AuthFailure | null;
  /** When the last passcode went out, so the screen can time the resend. */
  sentAt: number;
}

const emptyAuthForm: AuthForm = {
  channel: defaultChannel,
  identifier: '',
  code: '',
  step: 'identifier',
  pending: false,
  error: null,
  sentAt: 0,
};

/** An identifier is longer than a service name but still worth capping. */
const MAX_IDENTIFIER_LENGTH = 80;

export interface StaffForm {
  name: string;
  role: string;
}

export interface AppState {
  /** `null` until the visitor picks customer or vendor on the chooser screen. */
  mode: Mode | null;
  screen: Screen;
  lang: Lang;

  salonId: string;
  /** Service ids the customer has added to the current booking. */
  selected: Record<string, boolean>;
  staffId: string | null;
  dateIdx: number;
  /**
   * The chosen time as the customer reads it, "14:30". Held as the time
   * itself rather than a position in a list, because the list of offered times
   * now changes with the day, the staff member and the services chosen — an
   * index into it would quietly come to mean a different time.
   */
  slotTime: string | null;
  payId: string;
  activeCat: string;
  saved: Record<string, boolean>;
  bookTab: 'upcoming' | 'past';
  /** True while the time picker is moving an existing booking. */
  reschedule: boolean;
  /**
   * Which booking is being moved. Without this the flow could only ever create
   * a new appointment, which is exactly the bug: the old one stayed booked.
   */
  rescheduleId: string | null;
  /** Booking awaiting a "yes, really" before it is cancelled. */
  cancelingId: string | null;

  /** Screen to return to when leaving chat or the assistant. */
  retScreen: CustomerScreen;
  /** Screen to return to when leaving vendor onboarding. */
  obBack: 'chooser' | 'v_more';

  chatMsgs: ChatMessage[];
  chatInput: string;
  botMsgs: ChatMessage[];
  botInput: string;

  waitlistOn: boolean;
  waitlistJoined: boolean;
  seatOpen: boolean;
  /** Hides the released-seat banner while leaving the slot bookable. */
  seatBannerDismissed: boolean;

  /** The "your name" sheet. UI state only — the value itself lives on the profile. */
  nameModal: boolean;
  nameForm: string;

  vDay: number;
  /** Vendor services switched off (hidden from customers), keyed by service id. */
  vOff: Record<string, boolean>;
  extraServices: VendorService[];
  extraStaff: VendorStaff[];
  svcModal: boolean;
  svcForm: ServiceForm;
  staffModal: boolean;
  staffForm: StaffForm;

  /** The sign-in sheet, which floats over whichever screen is showing. */
  authOpen: boolean;
  /**
   * Why the sheet opened. 'booking' means the customer was interrupted at
   * checkout and needs telling why, rather than being shown a bare form.
   */
  authReason: 'booking' | 'vendor' | null;
  authForm: AuthForm;

  toast: string;
}

export const initialState: AppState = {
  mode: null,
  screen: 'home',
  lang: 'en',

  salonId: 'maison',
  selected: {},
  staffId: null,
  dateIdx: 1,
  slotTime: null,
  payId: 'applepay',
  activeCat: 'All',
  saved: {},
  bookTab: 'upcoming',
  reschedule: false,
  rescheduleId: null,
  cancelingId: null,

  retScreen: 'home',
  obBack: 'chooser',

  chatMsgs: [SALON_GREETING],
  chatInput: '',
  botMsgs: [BOT_GREETING],
  botInput: '',

  waitlistOn: true,
  waitlistJoined: false,
  seatOpen: false,
  seatBannerDismissed: false,

  // Today. The strip used to be four fixed dates in July 2026, where 3 was the
  // last of them; it is now the week from today, so the owner opens on today.
  vDay: 0,
  vOff: {},
  extraServices: [],
  extraStaff: [],
  nameModal: false,
  nameForm: '',
  svcModal: false,
  svcForm: { name: '', price: '', dur: '' },
  staffModal: false,
  staffForm: { name: '', role: '' },

  authOpen: false,
  authReason: null,
  authForm: emptyAuthForm,

  toast: '',
};

/** Where the back arrow leads from each customer screen. */
const BACK_MAP: Partial<Record<Screen, CustomerScreen>> = {
  salon: 'home',
  staff: 'salon',
  time: 'staff',
  pay: 'time',
  reviews: 'salon',
};

export type Action =
  | { type: 'setLang'; lang: Lang }
  | { type: 'pickMode'; mode: Mode }
  | { type: 'go'; screen: Screen }
  | { type: 'back' }
  | { type: 'openSalon'; salonId: string }
  | { type: 'setCategory'; category: string }
  | { type: 'toggleService'; serviceId: string }
  | { type: 'toggleSaved'; salonId: string }
  | { type: 'pickStaff'; staffId: string }
  | { type: 'pickDate'; dateIdx: number }
  | { type: 'pickSlot'; time: string }
  | { type: 'clearSlot' }
  | { type: 'pickPayment'; payId: string }
  | { type: 'bookingConfirmed' }
  | { type: 'setBookTab'; tab: 'upcoming' | 'past' }
  | { type: 'startReschedule'; salonId: string; bookingId: string }
  | { type: 'cancelRescheduling' }
  | { type: 'askCancel'; bookingId: string }
  | { type: 'dismissCancel' }
  | { type: 'openConversation'; target: 'chat' | 'bot'; from: CustomerScreen }
  | { type: 'setChatInput'; value: string }
  | { type: 'setBotInput'; value: string }
  | { type: 'pushChat'; message: ChatMessage }
  | { type: 'pushBot'; message: ChatMessage }
  | { type: 'sendChat' }
  | { type: 'sendBot' }
  | { type: 'joinWaitlist' }
  | { type: 'seatOpened' }
  | { type: 'dismissSeatBanner' }
  | { type: 'bookFromWaitlist' }
  | { type: 'toggleWaitlistAcceptance' }
  | { type: 'openNameSheet'; current: string }
  | { type: 'setNameForm'; value: string }
  | { type: 'closeNameSheet' }
  | { type: 'pickVendorDay'; index: number }
  | { type: 'toggleVendorService'; serviceId: string }
  | { type: 'openServiceModal' }
  | { type: 'closeServiceModal' }
  | { type: 'setServiceForm'; field: keyof ServiceForm; value: string }
  | { type: 'saveService' }
  | { type: 'openStaffModal' }
  | { type: 'closeStaffModal' }
  | { type: 'setStaffForm'; field: keyof StaffForm; value: string }
  | { type: 'saveStaff' }
  | { type: 'goOnboarding'; from: 'chooser' | 'v_more' }
  | { type: 'openAuth'; reason?: 'booking' | 'vendor' }
  | { type: 'closeAuth' }
  | { type: 'setAuthChannel'; channel: AuthChannel }
  | { type: 'setAuthIdentifier'; value: string }
  | { type: 'setAuthCode'; value: string }
  | { type: 'authPending' }
  | { type: 'authCodeSent'; identifier: string; at: number }
  | { type: 'authFailed'; failure: AuthFailure }
  | { type: 'authEditIdentifier' }
  | { type: 'authSucceeded' }
  | { type: 'setToast'; message: string };

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Derives up to two initials from a person's name, e.g. "Sara Malik" → "SM". */
function initialsFrom(name: string): string {
  const derived = name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return derived || 'NM';
}

function assertNever(action: never): never {
  throw new Error(`Unhandled action: ${JSON.stringify(action)}`);
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setLang':
      return { ...state, lang: action.lang };

    case 'pickMode':
      return action.mode === 'customer'
        ? { ...state, mode: 'customer', screen: 'home' }
        : { ...state, mode: 'vendor', screen: 'v_onboard', obBack: 'chooser' };

    case 'go':
      return { ...state, screen: action.screen };

    case 'back': {
      const { screen, reschedule, retScreen } = state;
      // Abandoning a reschedule returns to the bookings list, not the flow.
      if (screen === 'time' && reschedule) {
        return { ...state, screen: 'bookings', reschedule: false, rescheduleId: null };
      }
      if (screen === 'chat' || screen === 'bot') {
        return { ...state, screen: retScreen || 'home' };
      }
      return { ...state, screen: BACK_MAP[screen] ?? 'home' };
    }

    case 'openSalon':
      return {
        ...state,
        salonId: action.salonId,
        screen: 'salon',
        selected: {},
        staffId: null,
        slotTime: null,
        reschedule: false,
        rescheduleId: null,
      };

    case 'setCategory':
      return { ...state, activeCat: action.category };

    case 'toggleService':
      return {
        ...state,
        selected: { ...state.selected, [action.serviceId]: !state.selected[action.serviceId] },
      };

    case 'toggleSaved':
      return { ...state, saved: { ...state.saved, [action.salonId]: !state.saved[action.salonId] } };

    case 'pickStaff':
      return { ...state, staffId: action.staffId };

    case 'pickDate':
      return { ...state, dateIdx: action.dateIdx };

    case 'pickSlot':
      return { ...state, slotTime: action.time };

    // The offered times reloaded and no longer include what was chosen, so the
    // selection is dropped rather than carried unbookable into checkout.
    case 'clearSlot':
      return state.slotTime == null ? state : { ...state, slotTime: null };

    case 'pickPayment':
      return { ...state, payId: action.payId };

    case 'bookingConfirmed':
      // The booking itself lives with Supabase, not here — this only moves the
      // customer on and clears the waitlist state the booking resolves.
      return {
        ...state,
        screen: 'confirm',
        reschedule: false,
        rescheduleId: null,
        seatOpen: false,
        seatBannerDismissed: false,
        waitlistJoined: false,
      };

    case 'setBookTab':
      return { ...state, bookTab: action.tab };

    case 'startReschedule':
      return {
        ...state,
        salonId: action.salonId,
        screen: 'time',
        reschedule: true,
        rescheduleId: action.bookingId,
        slotTime: null,
        cancelingId: null,
      };

    case 'cancelRescheduling':
      return { ...state, reschedule: false, rescheduleId: null };

    case 'askCancel':
      return { ...state, cancelingId: action.bookingId };

    case 'dismissCancel':
      return { ...state, cancelingId: null };

    case 'openConversation':
      return { ...state, retScreen: action.from, screen: action.target };

    case 'setChatInput':
      return { ...state, chatInput: clamp(action.value, MAX_MESSAGE_LENGTH) };

    case 'setBotInput':
      return { ...state, botInput: clamp(action.value, MAX_MESSAGE_LENGTH) };

    case 'pushChat':
      return { ...state, chatMsgs: [...state.chatMsgs, action.message] };

    case 'pushBot':
      return { ...state, botMsgs: [...state.botMsgs, action.message] };

    case 'sendChat': {
      const text = state.chatInput.trim();
      if (!text) return state;
      return { ...state, chatMsgs: [...state.chatMsgs, { who: 'me', text }], chatInput: '' };
    }

    case 'sendBot': {
      const text = state.botInput.trim();
      if (!text) return state;
      return { ...state, botMsgs: [...state.botMsgs, { who: 'me', text }], botInput: '' };
    }

    case 'joinWaitlist':
      return { ...state, waitlistJoined: true };

    case 'seatOpened':
      return { ...state, seatOpen: true, seatBannerDismissed: false };

    case 'dismissSeatBanner':
      return { ...state, seatBannerDismissed: true };

    case 'bookFromWaitlist':
      return { ...state, salonId: 'maison', screen: 'time', dateIdx: 4, slotTime: null };

    case 'toggleWaitlistAcceptance':
      return { ...state, waitlistOn: !state.waitlistOn };

    case 'openNameSheet':
      // Prefilled with whatever is stored, so this edits rather than retypes.
      return { ...state, nameModal: true, nameForm: action.current };
    case 'setNameForm':
      // Capped here as well as on write: the input cannot grow past what the
      // column will keep, so nothing is silently truncated after saving.
      return { ...state, nameForm: action.value.slice(0, NAME_MAX_LENGTH) };
    case 'closeNameSheet':
      return { ...state, nameModal: false, nameForm: '' };
    case 'pickVendorDay':
      return { ...state, vDay: action.index };

    case 'toggleVendorService':
      return { ...state, vOff: { ...state.vOff, [action.serviceId]: !state.vOff[action.serviceId] } };

    case 'openServiceModal':
      return { ...state, svcModal: true, svcForm: { name: '', price: '', dur: '' } };

    case 'closeServiceModal':
      return { ...state, svcModal: false };

    case 'setServiceForm':
      return {
        ...state,
        svcForm: { ...state.svcForm, [action.field]: clamp(action.value, MAX_FIELD_LENGTH) },
      };

    case 'saveService': {
      const name = state.svcForm.name.trim();
      if (!name) return state;
      const parsedPrice = Number.parseInt(state.svcForm.price, 10);
      const price = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 100;
      const newService: VendorService = {
        id: `x${Date.now()}`,
        name,
        ar: name,
        dur: state.svcForm.dur.trim() || '45 min',
        price,
        discount: 0,
        bookings: 'New',
      };
      return {
        ...state,
        extraServices: [...state.extraServices, newService],
        svcModal: false,
        svcForm: { name: '', price: '', dur: '' },
      };
    }

    case 'openStaffModal':
      return { ...state, staffModal: true, staffForm: { name: '', role: '' } };

    case 'closeStaffModal':
      return { ...state, staffModal: false };

    case 'setStaffForm':
      return {
        ...state,
        staffForm: { ...state.staffForm, [action.field]: clamp(action.value, MAX_FIELD_LENGTH) },
      };

    case 'saveStaff': {
      const name = state.staffForm.name.trim();
      if (!name) return state;
      const role = state.staffForm.role.trim();
      const newStaff: VendorStaff = {
        id: `x${Date.now()}`,
        name,
        arName: name,
        role: role || 'Team member',
        arRole: role || 'عضو فريق',
        rating: '—',
        todayCount: '0 today',
        initials: initialsFrom(name),
        tile: tile.sandFine,
      };
      return {
        ...state,
        extraStaff: [...state.extraStaff, newStaff],
        staffModal: false,
        staffForm: { name: '', role: '' },
      };
    }

    case 'goOnboarding':
      return { ...state, screen: 'v_onboard', obBack: action.from };

    case 'openAuth':
      // A fresh form each time: a half-typed number from a dismissed attempt
      // is never what the next one wants.
      return { ...state, authOpen: true, authReason: action.reason ?? null, authForm: emptyAuthForm };

    case 'closeAuth':
      return { ...state, authOpen: false, authReason: null, authForm: emptyAuthForm };

    case 'setAuthChannel':
      // Changing channel invalidates the identifier — a number is not an e-mail.
      return {
        ...state,
        authForm: { ...emptyAuthForm, channel: action.channel },
      };

    case 'setAuthIdentifier':
      return {
        ...state,
        authForm: {
          ...state.authForm,
          identifier: clamp(action.value, MAX_IDENTIFIER_LENGTH),
          error: null,
        },
      };

    case 'setAuthCode':
      return {
        ...state,
        authForm: { ...state.authForm, code: normalizeCode(action.value), error: null },
      };

    case 'authPending':
      return { ...state, authForm: { ...state.authForm, pending: true, error: null } };

    case 'authCodeSent':
      return {
        ...state,
        authForm: {
          ...state.authForm,
          step: 'code',
          // Show the normalised form — the customer typed "0512 345 678" but
          // the message went to "+966512345678", and that is what to confirm.
          identifier: action.identifier,
          // A resend clears digits already typed against the old passcode.
          code: '',
          pending: false,
          error: null,
          sentAt: action.at,
        },
      };

    case 'authFailed':
      return { ...state, authForm: { ...state.authForm, pending: false, error: action.failure } };

    case 'authEditIdentifier':
      return {
        ...state,
        authForm: { ...state.authForm, step: 'identifier', code: '', pending: false, error: null },
      };

    case 'authSucceeded':
      // The sheet floats over whatever screen opened it, so closing it is all
      // there is to do — the customer carries on where they left off.
      return { ...state, authOpen: false, authReason: null, authForm: emptyAuthForm };

    case 'setToast':
      return { ...state, toast: action.message };

    default:
      // Exhaustiveness guard: TypeScript errors here if an action is unhandled.
      return assertNever(action);
  }
}

/** Screens that show the customer tab bar and floating help button. */
export const CUSTOMER_TAB_SCREENS: CustomerScreen[] = ['home', 'bookings', 'profile', 'reviews'];

/** Screens that show the vendor tab bar. */
export const VENDOR_TAB_SCREENS: VendorScreen[] = [
  'v_dash',
  'v_calendar',
  'v_services',
  'v_more',
  'v_gallery',
  'v_staff',
  'v_reviews',
  'v_waitlist',
];
