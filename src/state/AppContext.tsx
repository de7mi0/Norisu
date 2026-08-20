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
import {
  cancelBooking as cancelBookingRow,
  createBooking,
  loadMyBookings,
  rescheduleBooking as moveBooking,
  splitByTime,
  type BookingFailure,
} from '../data/bookings';
import {
  addService,
  addStaff,
  archiveService,
  archiveStaff,
  createSalon,
  loadMySalon,
  setServiceActive,
  updateService,
  updateStaff,
  saveDayHours,
  saveSlotStep,
  type DayHours,
  type OwnerState,
  type CatalogFailure,
  type OwnerWriteFailure,
  type RegisterFailure,
  type SalonDraft,
  type ServiceDraft,
  type StaffDraft,
} from '../data/owner';
import { INITIAL_BOOKINGS, PAST_BOOKINGS } from '../data/reviews';
import {
  demoAvailability,
  loadAvailability,
  totalMinutes,
  type Availability,
} from '../data/availability';
import { VAT_RATE, priceNow } from '../data/services';
import { ANY_PROFESSIONAL } from '../data/staff';
import { isSupabaseConfigured } from '../lib/supabase';
import { CODE_LENGTH, normalizeIdentifier, sendPasscode, verifyPasscode } from '../lib/auth';
import { dayLabel, dictionaryFor, formatMoney } from '../i18n';
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
    () => dayLabel(dateAtOffset(state.dateIdx), state.lang),
    [state.dateIdx, state.lang],
  );

  const slotSummary = state.slotTime ?? '—';

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

  // Bookings are remote state, like the catalogue and the session, so they live
  // here rather than in the reducer. Without a backend or a signed-in customer
  // there is nowhere to persist them, and the app falls back to the browser-only
  // behaviour it had before — still usable, still honest about it.
  const persistBookings = isSupabaseConfigured && session.status === 'signedIn';
  const [savedBookings, setSavedBookings] = useState<Booking[]>([]);
  const [localBookings, setLocalBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [lastReference, setLastReference] = useState('');

  const userId = session.user?.id ?? '';

  const refreshBookings = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) return;
    setBookingsLoading(true);
    const rows = await loadMyBookings();
    setSavedBookings(rows);
    setBookingsLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setSavedBookings([]);
      return;
    }
    void refreshBookings();
  }, [refreshBookings, userId]);

  const { upcomingBookings, pastBookings } = useMemo(() => {
    if (!persistBookings) {
      // No account behind them, so there is no real clock to sort against —
      // the prototype's two fixed sample lists stand in.
      return { upcomingBookings: localBookings, pastBookings: PAST_BOOKINGS };
    }
    const { upcoming, past } = splitByTime(savedBookings);
    return { upcomingBookings: upcoming, pastBookings: past };
  }, [localBookings, persistBookings, savedBookings]);

  // Availability is remote state, like the catalogue and the session, so it
  // lives here rather than in the reducer. The reducer only holds the *choice*
  // the customer made.
  const [availability, setAvailability] = useState<Availability>(() =>
    isSupabaseConfigured ? { slots: [], source: 'loading' } : demoAvailability(),
  );

  // Moving an appointment keeps its original length, which no longer matches
  // whatever is in the cart, so the duration comes from the booking itself.
  const rescheduleMinutes = useMemo(() => {
    if (!state.reschedule || !state.rescheduleId) return 0;
    const target = [...upcomingBookings, ...pastBookings].find(
      (booking) => booking.id === state.rescheduleId,
    );
    if (!target?.startsAt || !target.endsAt) return 0;
    return Math.round(
      (new Date(target.endsAt).getTime() - new Date(target.startsAt).getTime()) / 60000,
    );
  }, [pastBookings, state.reschedule, state.rescheduleId, upcomingBookings]);

  const bookingMinutes = state.reschedule
    ? rescheduleMinutes
    : totalMinutes(selectedServices);

  // "any" is a UI affordance, not a staff row; the database reads null as
  // "any professional" and counts the salon's capacity instead.
  const chosenStaffId = state.staffId && state.staffId !== 'any' ? state.staffId : null;

  useEffect(() => {
    // Only the time picker needs this, and only live rows can be asked about:
    // the demo catalogue's ids are not real salons.
    if (state.screen !== 'time') return;
    if (!isSupabaseConfigured || catalogSource !== 'live') {
      setAvailability(demoAvailability(state.dateIdx));
      return;
    }

    let cancelled = false;
    setAvailability({ slots: [], source: 'loading' });
    void loadAvailability({
      salonId: salon.id,
      day: dateAtOffset(state.dateIdx),
      services: state.reschedule ? [] : selectedServices,
      durationMinutes: bookingMinutes,
      staffId: chosenStaffId,
      excludeBookingId: state.rescheduleId,
    }).then((result) => {
      if (cancelled) return;
      // A failed live lookup falls back to sample times; keep the scripted full
      // day consistent with the demo path above.
      setAvailability(
        result.source === 'error'
          ? { ...demoAvailability(state.dateIdx), source: 'error' }
          : result,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    bookingMinutes,
    catalogSource,
    chosenStaffId,
    salon.id,
    selectedServices,
    state.dateIdx,
    state.reschedule,
    state.rescheduleId,
    state.screen,
  ]);

  // A time chosen before the list reloaded may no longer be on it — the
  // customer changed staff member, or somebody else took it. Dropping it here
  // stops an unbookable choice being carried into checkout.
  useEffect(() => {
    if (state.slotTime == null || availability.source === 'loading') return;
    const stillFree = availability.slots.some(
      (slot) => slot.time === state.slotTime && slot.free,
    );
    if (!stillFree) dispatch({ type: 'clearSlot' });
  }, [availability, state.slotTime]);

  // Which salon the signed-in user owns, if any. Remote state, so it lives here
  // rather than in the reducer — same split as the catalogue and the session.
  // Until this resolves the vendor portal shows sample data and says so.
  const [owner, setOwner] = useState<OwnerState>({
    status: isSupabaseConfigured ? 'loading' : 'unavailable',
    salon: null,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setOwner({ status: 'unavailable', salon: null });
      return;
    }
    if (session.status === 'loading') return;
    if (!userId) {
      setOwner({ status: 'signedOut', salon: null });
      return;
    }

    let cancelled = false;
    setOwner({ status: 'loading', salon: null });
    void loadMySalon(userId).then((result) => {
      if (!cancelled) setOwner(result);
    });

    return () => {
      cancelled = true;
    };
  }, [session.status, userId]);

  const refreshOwner = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) return;
    setOwner(await loadMySalon(userId));
  }, [userId]);

  const ownerFailureText = useCallback(
    (failure: OwnerWriteFailure): string => {
      const messages: Record<OwnerWriteFailure, { en: string; ar: string }> = {
        notConfigured: {
          en: 'Not saved — no database is connected.',
          ar: 'لم يُحفظ — لا توجد قاعدة بيانات متصلة.',
        },
        notOwner: {
          en: 'Only the salon’s owner can change this.',
          ar: 'مالك الصالون وحده يمكنه تغيير هذا.',
        },
        invalid: {
          en: 'Those times don’t work — closing must come after opening.',
          ar: 'الأوقات غير صحيحة — يجب أن يكون الإغلاق بعد الافتتاح.',
        },
        network: {
          en: 'Could not save. Check your connection and try again.',
          ar: 'تعذّر الحفظ. تحقق من الاتصال وحاول مرة أخرى.',
        },
      };
      return isArabic ? messages[failure].ar : messages[failure].en;
    },
    [isArabic],
  );

  /** Changes how far apart the booking screen's offered times sit. */
  const setSlotStep = useCallback(
    async (minutes: number) => {
      if (!owner.salon) return;
      const failure = await saveSlotStep(owner.salon.id, minutes);
      if (failure) {
        flash(ownerFailureText(failure));
        return;
      }
      await refreshOwner();
      flash(isArabic ? 'تم حفظ المواعيد ✓' : 'Booking interval saved ✓');
    },
    [flash, isArabic, owner.salon, ownerFailureText, refreshOwner],
  );

  /** Replaces one weekday's opening hours, or closes the day entirely. */
  const setDayHours = useCallback(
    async (day: DayHours) => {
      if (!owner.salon) return;
      const failure = await saveDayHours(owner.salon.id, day);
      if (failure) {
        flash(ownerFailureText(failure));
        return;
      }
      await refreshOwner();
      flash(isArabic ? 'تم حفظ ساعات العمل ✓' : 'Opening hours saved ✓');
    },
    [flash, isArabic, owner.salon, ownerFailureText, refreshOwner],
  );

  /**
   * Registers the salon and opens its portal. Returns true on success so the
   * form can clear itself; the failure is already on screen either way.
   */
  const registerSalon = useCallback(
    async (draft: SalonDraft): Promise<boolean> => {
      if (!userId) {
        // A salon row must belong to somebody, so ask who first.
        dispatch({ type: 'openAuth', reason: 'vendor' });
        return false;
      }

      const result = await createSalon(userId, draft);
      if ('error' in result) {
        const messages: Record<RegisterFailure, { en: string; ar: string }> = {
          notConfigured: {
            en: 'Not saved — no database is connected.',
            ar: 'لم يُحفظ — لا توجد قاعدة بيانات متصلة.',
          },
          notSignedIn: {
            en: 'Sign in first, so the salon belongs to your account.',
            ar: 'سجّل الدخول أولاً ليكون الصالون تابعاً لحسابك.',
          },
          missingName: {
            en: 'The salon needs a name in both English and Arabic.',
            ar: 'يحتاج الصالون إلى اسم بالعربية والإنجليزية.',
          },
          missingCr: {
            en: 'Your commercial registration number is required.',
            ar: 'رقم السجل التجاري مطلوب.',
          },
          alreadyOwns: {
            en: 'This account already has a salon.',
            ar: 'هذا الحساب يملك صالوناً بالفعل.',
          },
          network: {
            en: 'Could not register the salon. Check your connection and try again.',
            ar: 'تعذّر تسجيل الصالون. تحقق من الاتصال وحاول مرة أخرى.',
          },
        };
        const message = messages[result.error];
        flash(isArabic ? message.ar : message.en);
        return false;
      }

      await refreshOwner();
      dispatch({ type: 'go', screen: 'v_dash' });
      flash(
        isArabic
          ? 'تم تسجيل صالونك ✓ سيظهر للعملاء بعد التحقق.'
          : 'Salon registered ✓ It appears to customers once verified.',
      );
      return true;
    },
    [flash, isArabic, refreshOwner, userId],
  );

  const catalogFailureText = useCallback(
    (failure: CatalogFailure): string => {
      const messages: Record<CatalogFailure, { en: string; ar: string }> = {
        notConfigured: {
          en: 'Not saved — no database is connected.',
          ar: 'لم يُحفظ — لا توجد قاعدة بيانات متصلة.',
        },
        missingName: {
          en: 'A name in both English and Arabic is needed.',
          ar: 'الاسم مطلوب بالعربية والإنجليزية.',
        },
        badDuration: {
          en: 'How long does it take? Anything from 5 minutes to 10 hours.',
          ar: 'كم تستغرق؟ من 5 دقائق حتى 10 ساعات.',
        },
        badPrice: {
          en: 'The price needs to be a number, and not below zero.',
          ar: 'يجب أن يكون السعر رقماً غير سالب.',
        },
        badDiscount: {
          en: 'A discount runs from 0 to 100 per cent.',
          ar: 'الخصم بين 0 و100 بالمئة.',
        },
        notOwner: {
          en: 'Only the salon’s owner can change this.',
          ar: 'مالك الصالون وحده يمكنه تغيير هذا.',
        },
        network: {
          en: 'Could not save. Check your connection and try again.',
          ar: 'تعذّر الحفظ. تحقق من الاتصال وحاول مرة أخرى.',
        },
      };
      return isArabic ? messages[failure].ar : messages[failure].en;
    },
    [isArabic],
  );

  /** Runs one catalogue write, then reloads so the screen shows what was saved. */
  const catalogWrite = useCallback(
    async (
      run: () => Promise<CatalogFailure | null>,
      done: { en: string; ar: string },
    ): Promise<boolean> => {
      const failure = await run();
      if (failure) {
        flash(catalogFailureText(failure));
        return false;
      }
      await refreshOwner();
      flash(isArabic ? done.ar : done.en);
      return true;
    },
    [catalogFailureText, flash, isArabic, refreshOwner],
  );

  const saveService = useCallback(
    (draft: ServiceDraft, serviceId?: string) => {
      const salonId = owner.salon?.id;
      if (!salonId) return Promise.resolve(false);
      return catalogWrite(
        () =>
          serviceId
            ? updateService(salonId, serviceId, draft)
            : addService(salonId, draft),
        serviceId
          ? { en: 'Service updated ✓', ar: 'تم تحديث الخدمة ✓' }
          : { en: 'Service added ✓', ar: 'تمت إضافة الخدمة ✓' },
      );
    },
    [catalogWrite, owner.salon?.id],
  );

  /** Archived, never deleted — bookings reference the service they were made at. */
  const removeService = useCallback(
    (serviceId: string) =>
      catalogWrite(() => archiveService(serviceId), {
        en: 'Service removed from your menu ✓',
        ar: 'تمت إزالة الخدمة من قائمتك ✓',
      }),
    [catalogWrite],
  );

  const toggleServiceLive = useCallback(
    (serviceId: string, isActive: boolean) =>
      catalogWrite(
        () => setServiceActive(serviceId, isActive),
        isActive
          ? { en: 'Service is live ✓', ar: 'الخدمة مباشرة ✓' }
          : { en: 'Service hidden from customers ✓', ar: 'تم إخفاء الخدمة عن العملاء ✓' },
      ),
    [catalogWrite],
  );

  const saveStaff = useCallback(
    (draft: StaffDraft, staffId?: string) => {
      const salonId = owner.salon?.id;
      if (!salonId) return Promise.resolve(false);
      return catalogWrite(
        () => (staffId ? updateStaff(salonId, staffId, draft) : addStaff(salonId, draft)),
        staffId
          ? { en: 'Team member updated ✓', ar: 'تم تحديث بيانات العضو ✓' }
          : { en: 'Team member added ✓', ar: 'تمت إضافة عضو للفريق ✓' },
      );
    },
    [catalogWrite, owner.salon?.id],
  );

  const removeStaff = useCallback(
    (staffId: string) =>
      catalogWrite(() => archiveStaff(staffId), {
        en: 'Team member removed ✓',
        ar: 'تمت إزالة العضو ✓',
      }),
    [catalogWrite],
  );

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

  const bookingFailureText = useCallback(
    (failure: BookingFailure): string => {
      switch (failure) {
        case 'slotTaken':
          return isArabic
            ? 'حُجز هذا الوقت للتو. اختر وقتاً آخر.'
            : 'That time was just taken. Please pick another.';
        case 'noServices':
          return isArabic ? 'اختر خدمة أولاً.' : 'Choose a service first.';
        case 'noSlot':
          return isArabic ? 'اختر وقتاً أولاً.' : 'Pick a time first.';
        default:
          return isArabic
            ? 'تعذّر حفظ الحجز. تحقّق من اتصالك وحاول مجدداً.'
            : "Couldn't save your booking. Check your connection and try again.";
      }
    },
    [isArabic],
  );

  const confirmBooking = useCallback(async () => {
    // The first thing in the app that is genuinely per-account: a booking has to
    // belong to somebody. This is the sign-in gate the auth work deferred until
    // there was real data behind it.
    if (isSupabaseConfigured && !userId) {
      dispatch({ type: 'openAuth', reason: 'booking' });
      return;
    }

    if (persistBookings) {
      const result = await createBooking(
        {
          salonId: salon.id,
          salonName: salon.name,
          salonNameAr: salon.ar,
          salonTile: salon.tile,
          // The "any professional" option is a UI affordance, not a staff row,
          // so it goes to the database as null.
          staffId: staffMember && staffMember.id !== 'any' ? staffMember.id : null,
          staffName: staffMember?.name ?? ANY_PROFESSIONAL.en,
          staffNameAr: staffMember?.arName ?? ANY_PROFESSIONAL.ar,
          services: selectedServices,
          date: dateAtOffset(state.dateIdx),
          time: slotSummary,
          paymentMethod: state.payId,
        },
        userId,
      );

      if ('error' in result) {
        flash(bookingFailureText(result.error));
        return;
      }
      setLastReference(result.reference);
      await refreshBookings();
      dispatch({ type: 'bookingConfirmed' });
      return;
    }

    // No backend configured: the prototype's in-memory behaviour, unchanged.
    const booking: Booking = {
      tile: salon.tile,
      salon: salon.name,
      salonAr: salon.ar,
      services: selectedServices.map((service) => service.name).join(' · ') || 'Appointment',
      servicesAr: selectedServices.map((service) => service.ar).join(' · ') || 'موعد',
      when: `${dayLabel(dateAtOffset(state.dateIdx), 'en')} · ${slotSummary}`,
      whenAr: `${dayLabel(dateAtOffset(state.dateIdx), 'ar')} · ${slotSummary}`,
      staff: staffMember?.name ?? ANY_PROFESSIONAL.en,
      staffAr: staffMember?.arName ?? ANY_PROFESSIONAL.ar,
      status: 'CONFIRMED',
    };
    setLocalBookings((current) => [booking, ...current]);
    setLastReference('');
    dispatch({ type: 'bookingConfirmed' });
  }, [
    bookingFailureText,
    flash,
    persistBookings,
    refreshBookings,
    salon,
    selectedServices,
    slotSummary,
    staffMember,
    state.dateIdx,
    state.payId,
    userId,
  ]);

  /** Moves the booking the customer tapped "Reschedule" on to the chosen slot. */
  const rescheduleBooking = useCallback(async () => {
    const target = [...upcomingBookings, ...pastBookings].find(
      (booking) => booking.id === state.rescheduleId,
    );
    if (!state.rescheduleId || !target) {
      // Nothing to move — most likely a demo booking with no database row.
      dispatch({ type: 'cancelRescheduling' });
      dispatch({ type: 'go', screen: 'bookings' });
      return;
    }

    // Keep the appointment's original length; only its start is changing.
    const durationMs =
      target.startsAt && target.endsAt
        ? new Date(target.endsAt).getTime() - new Date(target.startsAt).getTime()
        : 0;

    const result = await moveBooking(
      state.rescheduleId,
      dateAtOffset(state.dateIdx),
      slotSummary,
      durationMs,
    );
    if ('error' in result) {
      flash(bookingFailureText(result.error));
      return;
    }
    await refreshBookings();
    dispatch({ type: 'cancelRescheduling' });
    dispatch({ type: 'go', screen: 'bookings' });
    flash(isArabic ? 'تم نقل موعدك ✓' : 'Your appointment has been moved ✓');
  }, [
    bookingFailureText,
    flash,
    isArabic,
    pastBookings,
    refreshBookings,
    slotSummary,
    state.dateIdx,
    state.rescheduleId,
    upcomingBookings,
  ]);

  const cancelBooking = useCallback(
    async (bookingId: string) => {
      const result = await cancelBookingRow(bookingId);
      dispatch({ type: 'dismissCancel' });
      if ('error' in result) {
        flash(bookingFailureText(result.error));
        return;
      }
      await refreshBookings();
      flash(isArabic ? 'تم إلغاء الموعد' : 'Appointment cancelled');
    },
    [bookingFailureText, flash, isArabic, refreshBookings],
  );

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
      availability,
      owner,
      setSlotStep,
      setDayHours,
      registerSalon,
      saveService,
      removeService,
      toggleServiceLive,
      saveStaff,
      removeStaff,
      session,
      requestPasscode,
      submitPasscode,
      signOut,
      upcomingBookings,
      pastBookings,
      bookingsPersisted: persistBookings,
      bookingsLoading,
      lastReference,
      rescheduleBooking,
      cancelBooking,
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
      availability,
      owner,
      setSlotStep,
      setDayHours,
      registerSalon,
      saveService,
      removeService,
      toggleServiceLive,
      saveStaff,
      removeStaff,
      submitPasscode,
      upcomingBookings,
      pastBookings,
      persistBookings,
      bookingsLoading,
      lastReference,
      rescheduleBooking,
      cancelBooking,
      staffName,
      state,
      t,
      totals,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
