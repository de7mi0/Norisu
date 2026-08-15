import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { appReducer, initialState } from './appReducer';
import { AppContext, dateAtOffset, type AppContextValue, type CatalogSource } from './context';
import { BOT_TOPICS, REPLY_DELAY, SALON_AUTO_REPLY, botReplyFor, type BotTopicKey } from './replies';
import { useSession } from './useSession';
import { demoCatalog, loadCatalog, type Catalog } from '../data/repository';
import { SLOTS, VAT_RATE, priceNow } from '../data/services';
import { ANY_PROFESSIONAL } from '../data/staff';
import { isSupabaseConfigured } from '../lib/supabase';
import { CODE_LENGTH, normalizeIdentifier, sendPasscode, verifyPasscode } from '../lib/auth';
import { dictionaryFor, formatMoney } from '../i18n';
import type { Booking, CustomerScreen, Lang } from '../types';

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // The catalogue starts as the bundled sample data so the app renders
  // immediately, then swaps to live rows once they arrive.
  const [catalog, setCatalog] = useState<Catalog>(() => demoCatalog());
  const [catalogSource, setCatalogSource] = useState<CatalogSource>(
    isSupabaseConfigured ? 'loading' : 'demo',
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    loadCatalog()
      .then((loaded) => {
        if (cancelled) return;
        // An empty database means the seed has not been run; keep the demo
        // data rather than showing an empty app.
        if (loaded.salons.length === 0) {
          setCatalogSource('demo');
          return;
        }
        setCatalog(loaded);
        setCatalogSource('live');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCatalogError(error instanceof Error ? error.message : String(error));
        setCatalogSource('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Every simulated delay is tracked so it can be cancelled on unmount.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const later = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, delay);
    timers.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const isArabic = state.lang === 'ar';
  const t = useMemo(() => dictionaryFor(state.lang), [state.lang]);
  const money = useCallback(
    (amount: number) => formatMoney(amount, state.lang),
    [state.lang],
  );

  const salon = useMemo(
    () => catalog.salons.find((item) => item.id === state.salonId) ?? catalog.salons[0],
    [catalog.salons, state.salonId],
  );

  const salonServices = useMemo(
    () => catalog.servicesBySalon[salon?.id] ?? [],
    [catalog.servicesBySalon, salon],
  );

  const salonStaff = useMemo(
    () => catalog.staffBySalon[salon?.id] ?? [],
    [catalog.staffBySalon, salon],
  );

  const selectedServices = useMemo(
    () => salonServices.filter((service) => state.selected[service.id]),
    [salonServices, state.selected],
  );

  const totals = useMemo(() => {
    const subtotal = selectedServices.reduce((sum, service) => sum + service.price, 0);
    const total = selectedServices.reduce((sum, service) => sum + priceNow(service), 0);
    const vat = Math.round(total * VAT_RATE);
    return { subtotal, total, savings: subtotal - total, vat, grandTotal: total + vat };
  }, [selectedServices]);

  const staffMember = useMemo(
    () => salonStaff.find((person) => person.id === state.staffId),
    [salonStaff, state.staffId],
  );

  const staffName = staffMember
    ? isArabic
      ? staffMember.arName
      : staffMember.name
    : isArabic
      ? ANY_PROFESSIONAL.ar
      : ANY_PROFESSIONAL.en;

  const dateSummary = useMemo(
    () =>
      dateAtOffset(state.dateIdx).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [state.dateIdx],
  );

  const slotSummary = state.slotIdx != null ? SLOTS[state.slotIdx] : '—';

  const flash = useCallback((message: string) => {
    dispatch({ type: 'setToast', message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(
      () => dispatch({ type: 'setToast', message: '' }),
      REPLY_DELAY.toast,
    );
  }, []);

  const session = useSession();
  const { profile, setProfileLocale, signOut: endSession } = session;

  // A signed-in customer's language belongs to their account, not to this
  // browser, so it follows them to a new phone. The ref remembers what has
  // already been reconciled for this account — without it the write-back would
  // race the adoption and immediately overwrite the stored choice with
  // whatever this browser happened to be set to.
  const adopted = useRef<{ id: string; locale: Lang } | null>(null);
  useEffect(() => {
    if (!profile) {
      // Cleared on sign-out, so signing back in adopts afresh.
      adopted.current = null;
      return;
    }
    if (adopted.current?.id !== profile.id) {
      adopted.current = { id: profile.id, locale: profile.locale };
      dispatch({ type: 'setLang', lang: profile.locale });
      return;
    }
    if (state.lang !== adopted.current.locale) {
      adopted.current = { id: profile.id, locale: state.lang };
      setProfileLocale(state.lang);
    }
  }, [profile, setProfileLocale, state.lang]);

  const requestPasscode = useCallback(() => {
    const { channel, identifier, pending } = state.authForm;
    if (pending) return;
    const normalized = normalizeIdentifier(channel, identifier);
    if (!normalized) {
      const code = channel === 'phone' ? 'invalidPhone' : 'invalidEmail';
      dispatch({ type: 'authFailed', failure: { code } });
      return;
    }
    dispatch({ type: 'authPending' });
    void sendPasscode(channel, normalized).then((failure) => {
      if (failure) dispatch({ type: 'authFailed', failure });
      else dispatch({ type: 'authCodeSent', identifier: normalized, at: Date.now() });
    });
  }, [state.authForm]);

  const submitPasscode = useCallback(() => {
    const { channel, identifier, code, pending } = state.authForm;
    if (pending) return;
    const normalized = normalizeIdentifier(channel, identifier);
    if (!normalized) {
      dispatch({ type: 'authEditIdentifier' });
      return;
    }
    if (code.length !== CODE_LENGTH) {
      dispatch({ type: 'authFailed', failure: { code: 'invalidCode' } });
      return;
    }
    dispatch({ type: 'authPending' });
    void verifyPasscode(channel, normalized, code).then((failure) => {
      if (failure) {
        dispatch({ type: 'authFailed', failure });
        return;
      }
      dispatch({ type: 'authSucceeded' });
      flash(isArabic ? 'تم تسجيل الدخول ✓' : 'Signed in ✓');
    });
  }, [flash, isArabic, state.authForm]);

  const signOut = useCallback(() => {
    void endSession().then(() => flash(isArabic ? 'تم تسجيل الخروج' : 'Signed out'));
  }, [endSession, flash, isArabic]);

  const sendChat = useCallback(() => {
    if (!state.chatInput.trim()) return;
    dispatch({ type: 'sendChat' });
    later(() => dispatch({ type: 'pushChat', message: SALON_AUTO_REPLY }), REPLY_DELAY.salon);
  }, [later, state.chatInput]);

  const sendBot = useCallback(() => {
    const text = state.botInput.trim();
    if (!text) return;
    dispatch({ type: 'sendBot' });
    const reply = botReplyFor(text);
    later(() => dispatch({ type: 'pushBot', message: reply }), REPLY_DELAY.bot);
  }, [later, state.botInput]);

  const pickBotTopic = useCallback(
    (key: BotTopicKey) => {
      // "Message the salon" hands the conversation over instead of answering.
      if (key === 'salon') {
        dispatch({ type: 'go', screen: 'chat' });
        return;
      }
      const topic = BOT_TOPICS.find((candidate) => candidate.key === key);
      if (!topic?.user || !topic.bot) return;
      dispatch({ type: 'pushBot', message: { who: 'me', ...topic.user } });
      later(
        () => dispatch({ type: 'pushBot', message: { who: 'bot', ...topic.bot } }),
        REPLY_DELAY.botTopic,
      );
    },
    [later],
  );

  const joinWaitlist = useCallback(() => {
    dispatch({ type: 'joinWaitlist' });
    flash(isArabic ? 'أضفناك لقائمة الانتظار ✓' : 'You’re on the waitlist ✓');
    // A seat frees up shortly afterwards, demonstrating the notification.
    // TODO(roadmap A3): simulated. Really this is a server-side reaction to a cancellation
    // that offers the slot to the first matching entry and holds it for a fixed window.
    later(() => {
      dispatch({ type: 'seatOpened' });
      flash(isArabic ? 'تفرّغ موعد! اضغط للحجز' : 'A spot opened! Tap to book');
    }, REPLY_DELAY.seatOpens);
  }, [flash, isArabic, later]);

  const confirmBooking = useCallback(() => {
    const booking: Booking = {
      tile: salon.tile,
      salon: salon.name,
      salonAr: salon.ar,
      services: selectedServices.map((service) => service.name).join(' · ') || 'Appointment',
      servicesAr: selectedServices.map((service) => service.ar).join(' · ') || 'موعد',
      when: `${dateSummary} · ${slotSummary}`,
      staff: staffMember?.name ?? ANY_PROFESSIONAL.en,
      staffAr: staffMember?.arName ?? ANY_PROFESSIONAL.ar,
      status: 'CONFIRMED',
    };
    dispatch({ type: 'confirmBooking', booking });
  }, [dateSummary, salon, selectedServices, slotSummary, staffMember]);

  const openConversation = useCallback(
    (target: 'chat' | 'bot') => {
      dispatch({ type: 'openConversation', target, from: state.screen as CustomerScreen });
    },
    [state.screen],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      dispatch,
      t,
      isArabic,
      dir: isArabic ? 'rtl' : 'ltr',
      backIcon: isArabic ? '→' : '←',
      arrow: isArabic ? '←' : '→',
      chevron: isArabic ? '‹' : '›',
      money,
      catalogSource,
      catalogError,
      salons: catalog.salons,
      salonServices,
      salonStaff,
      salon,
      selectedServices,
      totals,
      staffName,
      dateSummary,
      slotSummary,
      session,
      requestPasscode,
      submitPasscode,
      signOut,
      flash,
      sendChat,
      sendBot,
      pickBotTopic,
      joinWaitlist,
      confirmBooking,
      openConversation,
    }),
    [
      catalog.salons,
      catalogError,
      catalogSource,
      confirmBooking,
      dateSummary,
      flash,
      isArabic,
      joinWaitlist,
      money,
      openConversation,
      pickBotTopic,
      requestPasscode,
      salon,
      salonServices,
      salonStaff,
      selectedServices,
      sendBot,
      sendChat,
      session,
      signOut,
      slotSummary,
      submitPasscode,
      staffName,
      state,
      t,
      totals,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
