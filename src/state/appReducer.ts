import type {
  Booking,
  ChatMessage,
  CustomerScreen,
  Lang,
  Mode,
  Screen,
  VendorScreen,
  VendorService,
  VendorStaff,
} from '../types';
import { INITIAL_BOOKINGS } from '../data/reviews';
import { BOT_GREETING, MAX_FIELD_LENGTH, MAX_MESSAGE_LENGTH, SALON_GREETING } from './replies';
import { tile } from '../theme';

export interface ServiceForm {
  name: string;
  price: string;
  dur: string;
}

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
  slotIdx: number | null;
  payId: string;
  activeCat: string;
  saved: Record<string, boolean>;
  bookTab: 'upcoming' | 'past';
  bookings: Booking[];
  reschedule: boolean;

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

  vDay: number;
  /** Vendor services switched off (hidden from customers), keyed by service id. */
  vOff: Record<string, boolean>;
  extraServices: VendorService[];
  extraStaff: VendorStaff[];
  svcModal: boolean;
  svcForm: ServiceForm;
  staffModal: boolean;
  staffForm: StaffForm;

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
  slotIdx: null,
  payId: 'applepay',
  activeCat: 'All',
  saved: {},
  bookTab: 'upcoming',
  bookings: INITIAL_BOOKINGS,
  reschedule: false,

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

  vDay: 3,
  vOff: {},
  extraServices: [],
  extraStaff: [],
  svcModal: false,
  svcForm: { name: '', price: '', dur: '' },
  staffModal: false,
  staffForm: { name: '', role: '' },

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
  | { type: 'pickSlot'; slotIdx: number }
  | { type: 'pickPayment'; payId: string }
  | { type: 'confirmBooking'; booking: Booking }
  | { type: 'setBookTab'; tab: 'upcoming' | 'past' }
  | { type: 'startReschedule'; salonId: string }
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
        return { ...state, screen: 'bookings', reschedule: false };
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
        slotIdx: null,
        reschedule: false,
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
      return { ...state, slotIdx: action.slotIdx };

    case 'pickPayment':
      return { ...state, payId: action.payId };

    case 'confirmBooking':
      return {
        ...state,
        bookings: [action.booking, ...state.bookings],
        screen: 'confirm',
        reschedule: false,
        seatOpen: false,
        seatBannerDismissed: false,
        waitlistJoined: false,
      };

    case 'setBookTab':
      return { ...state, bookTab: action.tab };

    case 'startReschedule':
      return { ...state, salonId: action.salonId, screen: 'time', reschedule: true };

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
      return { ...state, salonId: 'maison', screen: 'time', dateIdx: 4, slotIdx: null };

    case 'toggleWaitlistAcceptance':
      return { ...state, waitlistOn: !state.waitlistOn };

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
