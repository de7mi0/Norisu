import { createContext, useContext, type Dispatch } from 'react';
import type { Action, AppState } from './appReducer';
import type { Dictionary } from '../i18n';
import type { Salon, Service } from '../types';
import type { BotTopicKey } from './replies';

/** The prototype's calendar starts on 31 July 2026. */
const CALENDAR_START = { year: 2026, month: 6, day: 31 } as const;

/** The bookable date `offset` days after the start of the calendar. */
export function dateAtOffset(offset: number): Date {
  const date = new Date(CALENDAR_START.year, CALENDAR_START.month, CALENDAR_START.day);
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

  salon: Salon;
  selectedServices: Service[];
  totals: { subtotal: number; total: number; savings: number; vat: number; grandTotal: number };
  staffName: string;
  dateSummary: string;
  slotSummary: string;

  /** Shows a transient toast; a second call replaces the first. */
  flash: (message: string) => void;
  sendChat: () => void;
  sendBot: () => void;
  pickBotTopic: (key: BotTopicKey) => void;
  joinWaitlist: () => void;
  confirmBooking: () => void;
  openConversation: (target: 'chat' | 'bot') => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}
