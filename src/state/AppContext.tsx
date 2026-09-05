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
  saveProfile,
  setServiceActive,
  updateService,
  updateStaff,
  saveDayHours,
  saveSlotStep,
  saveWaitlistEnabled,
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
  claimOffer,
  claimOfferByToken,
  extendOffer,
  joinWaitlist as joinWaitlistRow,
  leaveWaitlist as leaveWaitlistRow,
  loadMyWaitlist,
  loadSalonWaitlist,
  reofferSlot,
  type MyWaitlist,
  type SalonWaitlist,
  type WaitlistFailure,
  type WaitlistRequest,
} from '../data/waitlist';
import { isPushConfigured, pushState, registerWorker, subscribe as subscribeToPush, syncExisting } from '../lib/push';
import {
  deletePhoto as deletePhotoRow,
  loadPhotos,
  makeCover as makeCoverRow,
  uploadPhoto as uploadPhotoRow,
  type PhotoFailure,
  type SalonPhoto,
} from '../data/photos';
import {
  blockTime as blockTimeRow,
  loadTimeOff,
  unblockTime as unblockTimeRow,
  type TimeBlock,
  type TimeOffFailure,
} from '../data/timeOff';
import {
  loadSalonReviews,
  loadVendorDay,
  reassignAppointment,
  replyToReview,
  setAppointmentStatus,
  type AppointmentFailure,
  type AppointmentStatus,
  type VendorDay,
  type VendorReviews,
  createWalkIn,
  type WalkInDraft,
  type WalkInFailure,
} from '../data/vendorBookings';
import {
  demoAvailability,
  loadAvailability,
  totalMinutes,
  type Availability,
} from '../data/availability';
import { VAT_RATE, priceNow } from '../data/services';
import { ANY_PROFESSIONAL } from '../data/staff';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  CODE_LENGTH,
  deleteAccount as deleteAccountRow,
  normalizeIdentifier,
  sendPasscode,
  verifyPasscode,
  type DeleteAccountFailure,
} from '../lib/auth';
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

  // The salon being viewed, not the salon being run: `photos` further down is
  // the owner's own, loaded separately because an unpublished salon is not in
  // the catalogue at all.
  const salonPhotos = useMemo(
    () => catalog.photosBySalon[salon?.id] ?? [],
    [catalog.photosBySalon, salon],
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

  // ---------------------------------------------------------------------
  // Arriving from a notification
  // ---------------------------------------------------------------------

  // The token from ?claim=, held until there is an account to claim it for.
  const pendingClaim = useRef<string | null>(null);
  const claimPrompted = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('claim');
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return;

    pendingClaim.current = token;

    // Strip it immediately. Otherwise a refresh — or the browser restoring the
    // tab tomorrow — tries to claim a seat that was taken, or already theirs,
    // and shows an error about something they did successfully yesterday.
    params.delete('claim');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
    );
  }, []);

  // The service worker is registered on every load, permission or not: it is
  // also what makes Saloni installable, and installing is the step an iPhone
  // has to take before push is even offered. Registering does not ask for
  // anything and shows nothing.
  useEffect(() => {
    void registerWorker();
  }, []);

  // A subscription made before signing in belongs to nobody, and push services
  // rotate endpoints on their own schedule. Re-registering whenever an account
  // appears is what keeps this browser attached to the right person;
  // register_push_device() is idempotent, so it costs one request.
  useEffect(() => {
    if (!userId) return;
    void syncExisting();
  }, [userId]);

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

  /**
   * Stores the name the customer gave, and closes the sheet only once it is
   * written — a name that appeared on screen and then vanished on the next
   * profile read would be worse than the sheet staying open.
   */
  const saveMyName = useCallback(
    async (fullName: string): Promise<boolean> => {
      const saved = await session.setProfileName(fullName);
      if (!saved) {
        flash(t.nameNotSaved);
        return false;
      }
      dispatch({ type: 'closeNameSheet' });
      flash(t.nameSaved);
      return true;
    },
    [flash, session, t],
  );

  const customerScreen = state.mode === 'customer' ? state.screen : null;

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setMyWaitlist({ entries: [], source: 'demo' });
      return;
    }
    let cancelled = false;
    setMyWaitlist({ entries: [], source: 'loading' });
    void loadMyWaitlist().then((result) => {
      if (!cancelled) setMyWaitlist(result);
    });
    return () => {
      cancelled = true;
    };
    // Re-read on every screen change in customer mode: an offer can appear at
    // any moment and there is no notification to announce it.
  }, [userId, customerScreen]);

  const refreshOwner = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) return;
    setOwner(await loadMySalon(userId));
  }, [userId]);

  // The owner's diary. Remote state again, so it sits beside `owner` rather
  // than in the reducer; the reducer holds only which day is selected.
  const [vendorDay, setVendorDay] = useState<VendorDay>({
    appointments: [],
    stats: null,
    source: 'demo',
  });
  const [vendorReviews, setVendorReviews] = useState<VendorReviews>({
    reviews: [],
    source: 'demo',
  });

  // The waitlist, both sides of it. Reading is also what advances a lapsed
  // hold — there is no job runner, so the queue moves when somebody looks.
  const [myWaitlist, setMyWaitlist] = useState<MyWaitlist>({ entries: [], source: 'demo' });
  const [salonWaitlist, setSalonWaitlist] = useState<SalonWaitlist>({
    entries: [],
    source: 'demo',
  });

  const ownedSalonId = owner.status === 'live' ? (owner.salon?.id ?? null) : null;

  // The dashboard asks about today; the calendar asks about the day on the
  // strip. Same question, same state — and only one of those screens is ever
  // mounted, so there is nothing to keep in sync.
  const vendorDayOffset =
    state.screen === 'v_calendar' ? state.vDay : state.screen === 'v_dash' ? 0 : null;

  useEffect(() => {
    if (vendorDayOffset == null) return;
    if (!ownedSalonId) {
      // No salon of their own: the portal keeps showing the sample one and
      // SampleDataNotice already says why.
      setVendorDay({ appointments: [], stats: null, source: 'demo' });
      return;
    }

    let cancelled = false;
    setVendorDay({ appointments: [], stats: null, source: 'loading' });
    void loadVendorDay(ownedSalonId, dateAtOffset(vendorDayOffset)).then((result) => {
      if (!cancelled) setVendorDay(result);
    });

    return () => {
      cancelled = true;
    };
  }, [ownedSalonId, vendorDayOffset]);

  useEffect(() => {
    if (state.screen !== 'v_waitlist') return;
    if (!ownedSalonId) {
      setSalonWaitlist({ entries: [], source: 'demo' });
      return;
    }
    let cancelled = false;
    setSalonWaitlist({ entries: [], source: 'loading' });
    void loadSalonWaitlist(ownedSalonId).then((result) => {
      if (!cancelled) setSalonWaitlist(result);
    });
    return () => {
      cancelled = true;
    };
  }, [ownedSalonId, state.screen]);

  useEffect(() => {
    if (state.screen !== 'v_reviews') return;
    if (!ownedSalonId) {
      setVendorReviews({ reviews: [], source: 'demo' });
      return;
    }

    let cancelled = false;
    setVendorReviews({ reviews: [], source: 'loading' });
    void loadSalonReviews(ownedSalonId).then((result) => {
      if (!cancelled) setVendorReviews(result);
    });

    return () => {
      cancelled = true;
    };
  }, [ownedSalonId, state.screen]);

  const appointmentFailureText = useCallback(
    (failure: AppointmentFailure): string => {
      const messages: Record<AppointmentFailure, string> = {
        notConfigured: t.apptNoBackend,
        slotTaken: t.apptSlotTaken,
        notAllowed: t.apptNotAllowed,
        network: t.apptFailed,
      };
      return messages[failure];
    },
    [t],
  );

  /** Re-reads the day on screen after a write, so the row reflects the truth. */
  const refreshVendorDay = useCallback(async () => {
    if (!ownedSalonId || vendorDayOffset == null) return;
    setVendorDay(await loadVendorDay(ownedSalonId, dateAtOffset(vendorDayOffset)));
  }, [ownedSalonId, vendorDayOffset]);

  // What the salon has taken off sale for the day being looked at. Remote
  // state, so it lives here rather than in the reducer — the same split the
  // catalogue, the session and the vendor day already follow.
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);

  const refreshTimeBlocks = useCallback(async () => {
    if (!ownedSalonId || vendorDayOffset == null) {
      setTimeBlocks([]);
      return;
    }
    setTimeBlocks(await loadTimeOff(ownedSalonId, dateAtOffset(vendorDayOffset)));
  }, [ownedSalonId, vendorDayOffset]);

  useEffect(() => {
    void refreshTimeBlocks();
  }, [refreshTimeBlocks]);

  // A salon's photographs. Remote state, like everything else the database owns.
  const [photos, setPhotos] = useState<SalonPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);

  const refreshPhotos = useCallback(async () => {
    if (!ownedSalonId) {
      setPhotos([]);
      return;
    }
    setPhotos(await loadPhotos(ownedSalonId));
  }, [ownedSalonId]);

  useEffect(() => {
    void refreshPhotos();
  }, [refreshPhotos]);

  const photoFailureText = useCallback(
    (failure: PhotoFailure): string =>
      failure === 'notAnImage' ? t.photoNotAnImage
      : failure === 'tooLarge' ? t.photoTooLarge
      : failure === 'unreadable' ? t.photoUnreadable
      : failure === 'tooBigAfterAll' ? t.photoTooBigAfterAll
      : failure === 'notOwner' ? t.photoNotOwner
      : failure === 'notConfigured' ? t.photoNeedSalon
      : t.photoFailed,
    [t],
  );

  /**
   * Adds a photograph. The first one a salon has becomes its cover, because a
   * salon with pictures and no cover would still show a placeholder tile in the
   * catalogue, which is the whole thing this is meant to fix.
   */
  const addPhoto = useCallback(
    async (file: File) => {
      if (!ownedSalonId) {
        flash(t.photoNeedSalon);
        return;
      }
      setPhotoBusy(true);
      const result = await uploadPhotoRow(ownedSalonId, file, photos.length === 0 ? 'cover' : 'gallery');
      setPhotoBusy(false);
      if ('error' in result) {
        flash(photoFailureText(result.error));
        return;
      }
      await refreshPhotos();
    },
    [flash, ownedSalonId, photoFailureText, photos.length, refreshPhotos, t],
  );

  const removePhoto = useCallback(
    async (photo: SalonPhoto) => {
      const failure = await deletePhotoRow(photo);
      if (failure) {
        flash(photoFailureText(failure));
        return;
      }
      await refreshPhotos();
    },
    [flash, photoFailureText, refreshPhotos],
  );

  const setCoverPhoto = useCallback(
    async (photoId: string) => {
      if (!ownedSalonId) return;
      const failure = await makeCoverRow(ownedSalonId, photoId);
      if (failure) {
        flash(photoFailureText(failure));
        return;
      }
      await refreshPhotos();
    },
    [flash, ownedSalonId, photoFailureText, refreshPhotos],
  );

  const timeOffFailureText = useCallback(
    (failure: TimeOffFailure): string =>
      failure === 'invalidRange' ? t.blockBadRange
      : failure === 'notOwner' ? t.blockNotOwner
      : failure === 'notConfigured' ? t.blockNeedSalon
      : t.blockFailed,
    [t],
  );

  /** Takes a period off sale. The database stops offering it immediately. */
  const blockTime = useCallback(
    async (staffId: string | null, startsAt: Date, endsAt: Date, reason: string) => {
      if (!ownedSalonId) {
        flash(t.blockNeedSalon);
        return;
      }
      dispatch({ type: 'setBlockSaving', saving: true });
      const failure = await blockTimeRow({
        salonId: ownedSalonId,
        staffId,
        startsAt,
        endsAt,
        reason,
      });
      dispatch({ type: 'setBlockSaving', saving: false });
      if (failure) {
        flash(timeOffFailureText(failure));
        return;
      }
      dispatch({ type: 'closeBlockSheet' });
      // The day is reloaded too: a block does not change appointments, but the
      // figures it feeds — occupancy especially — are computed from the hours
      // actually on sale.
      await Promise.all([refreshTimeBlocks(), refreshVendorDay()]);
      flash(t.blockSaved);
    },
    [flash, ownedSalonId, refreshTimeBlocks, refreshVendorDay, t, timeOffFailureText],
  );

  const walkInFailureText = useCallback(
    (failure: WalkInFailure): string =>
      failure === 'needName' ? t.walkInNeedName
      : failure === 'noSuchService' ? t.walkInNeedService
      : failure === 'noStaffFree' ? t.walkInNobodyFree
      : failure === 'slotTaken' ? t.walkInChairTaken
      : failure === 'notAllowed' ? t.walkInNotAllowed
      : failure === 'notConfigured' ? t.blockNeedSalon
      : t.walkInFailed,
    [t],
  );

  /**
   * The salon's own booking, for somebody with no account. The customer-facing
   * gate does not move: this writes through create_walkin_booking(), which
   * refuses anybody but the salon's owner, and nothing here lets a visitor
   * create a booking.
   */
  const addWalkIn = useCallback(
    async (draft: Omit<WalkInDraft, 'salonId'>) => {
      if (!ownedSalonId) {
        flash(t.blockNeedSalon);
        return;
      }
      dispatch({ type: 'setWalkInSaving', saving: true });
      const result = await createWalkIn({ ...draft, salonId: ownedSalonId });
      dispatch({ type: 'setWalkInSaving', saving: false });
      if ('error' in result) {
        flash(walkInFailureText(result.error));
        return;
      }
      dispatch({ type: 'closeWalkInSheet' });
      // The figures move with it: a walk-in is a booking, so "Booked today",
      // the value booked and occupancy all change the moment it is written.
      await refreshVendorDay();
      flash(`${t.walkInSaved} · ${result.reference}`);
    },
    [flash, ownedSalonId, refreshVendorDay, t, walkInFailureText],
  );

  /** Puts it back on sale. */
  const unblockTime = useCallback(
    async (id: string) => {
      const failure = await unblockTimeRow(id);
      if (failure) {
        flash(timeOffFailureText(failure));
        return;
      }
      await Promise.all([refreshTimeBlocks(), refreshVendorDay()]);
      flash(t.blockFreed);
    },
    [flash, refreshTimeBlocks, refreshVendorDay, t, timeOffFailureText],
  );

  /**
   * Moves an appointment through the salon's lifecycle. Which moves are
   * legitimate is settled by the database (0006's status trigger), not here —
   * this offers them and reports back what Postgres said.
   */
  const setAppointment = useCallback(
    async (bookingId: string, status: AppointmentStatus) => {
      const failure = await setAppointmentStatus(bookingId, status);
      if (failure) {
        flash(appointmentFailureText(failure));
        return;
      }
      dispatch({ type: 'closeAppointment' });
      await refreshVendorDay();
      flash(t.apptUpdated);
    },
    [appointmentFailureText, flash, refreshVendorDay, t],
  );

  /** Hands an appointment to a different specialist, or back to anyone free. */
  const reassignTo = useCallback(
    async (bookingId: string, staffId: string | null) => {
      const failure = await reassignAppointment(bookingId, staffId);
      if (failure) {
        // Nearly always "that person is already booked then", which is why it
        // has its own message rather than a generic failure.
        flash(appointmentFailureText(failure));
        return;
      }
      dispatch({ type: 'closeAppointment' });
      await refreshVendorDay();
      flash(t.apptUpdated);
    },
    [appointmentFailureText, flash, refreshVendorDay, t],
  );

  /** Answers a review, through the 0007 function rather than a table write. */
  const answerReview = useCallback(
    async (reviewId: string, reply: string): Promise<boolean> => {
      const failure = await replyToReview(reviewId, reply);
      if (failure) {
        flash(appointmentFailureText(failure));
        return false;
      }
      if (ownedSalonId) setVendorReviews(await loadSalonReviews(ownedSalonId));
      flash(t.replySaved);
      return true;
    },
    [appointmentFailureText, flash, ownedSalonId, t],
  );


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

  /** Turns the salon's waitlist on or off. */
  const setWaitlistEnabled = useCallback(
    async (enabled: boolean) => {
      if (!owner.salon) return;
      const failure = await saveWaitlistEnabled(owner.salon.id, enabled);
      if (failure) {
        flash(ownerFailureText(failure));
        return;
      }
      await refreshOwner();
      flash(
        enabled
          ? isArabic
            ? 'قائمة الانتظار مفعّلة ✓'
            : 'Waitlist on ✓'
          : isArabic
            ? 'قائمة الانتظار موقوفة'
            : 'Waitlist off',
      );
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

  /**
   * Saves the business profile. Verification is not among the fields, and the
   * owner has no privilege on those columns either way — see migration 0004.
   */
  const saveBusinessProfile = useCallback(
    async (draft: SalonDraft): Promise<boolean> => {
      const salonId = owner.salon?.id;
      if (!salonId) return false;

      const failure = await saveProfile(salonId, draft);
      if (failure) {
        const messages: Partial<Record<RegisterFailure, { en: string; ar: string }>> = {
          notConfigured: {
            en: 'Not saved — no database is connected.',
            ar: 'لم يُحفظ — لا توجد قاعدة بيانات متصلة.',
          },
          missingName: {
            en: 'The salon needs a name in both English and Arabic.',
            ar: 'يحتاج الصالون إلى اسم بالعربية والإنجليزية.',
          },
          missingCr: {
            en: 'Your commercial registration number is required.',
            ar: 'رقم السجل التجاري مطلوب.',
          },
        };
        const message = messages[failure] ?? {
          en: 'Could not save. Check your connection and try again.',
          ar: 'تعذّر الحفظ. تحقق من الاتصال وحاول مرة أخرى.',
        };
        flash(isArabic ? message.ar : message.en);
        return false;
      }

      await refreshOwner();
      flash(isArabic ? 'تم حفظ بيانات العمل ✓' : 'Business details saved ✓');
      return true;
    },
    [flash, isArabic, owner.salon?.id, refreshOwner],
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

  /**
   * Deletes the signed-in account for good — the store requirement, and the
   * only destructive thing a customer can do in Saloni.
   *
   * The sheet stays open on a refusal, so the reason is read next to the button
   * that caused it; on success it closes and the session ends with the account,
   * because every request made after this point would fail in a way nothing on
   * screen could explain.
   */
  const deleteAccount = useCallback(async () => {
    dispatch({ type: 'setDeleteSaving', saving: true });
    const failure = await deleteAccountRow();
    dispatch({ type: 'setDeleteSaving', saving: false });

    if (failure) {
      const said: Record<DeleteAccountFailure, string> = {
        ownsSalon: t.deleteOwner,
        notSignedIn: t.authSignIn,
        notConfigured: t.deleteFailed,
        network: t.deleteFailed,
      };
      flash(said[failure]);
      return;
    }

    dispatch({ type: 'closeDeleteSheet' });
    flash(t.deleteDone);
  }, [flash, t]);

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

  const waitlistFailureText = useCallback(
    (failure: WaitlistFailure): string => {
      const messages: Record<WaitlistFailure, { en: string; ar: string }> = {
        notConfigured: {
          en: 'Not saved — no database is connected.',
          ar: 'لم يُحفظ — لا توجد قاعدة بيانات متصلة.',
        },
        notSignedIn: { en: 'Sign in first.', ar: 'سجّل الدخول أولاً.' },
        notOffered: {
          en: 'Nothing is being held for you.',
          ar: 'لا يوجد موعد محجوز لك.',
        },
        alreadyWaiting: {
          en: 'You’re already on the waitlist for that day.',
          ar: 'أنت بالفعل في قائمة الانتظار لذلك اليوم.',
        },
        noWaitlist: {
          en: 'This salon isn’t taking a waitlist.',
          ar: 'هذا الصالون لا يستقبل قائمة انتظار.',
        },
        badServices: {
          en: 'One of those services isn’t bookable here.',
          ar: 'إحدى الخدمات غير متاحة للحجز هنا.',
        },
        gone: {
          en: 'That seat has gone. You’re still on the list.',
          ar: 'ذهب هذا الموعد. ما زلت في القائمة.',
        },
        queueBehind: {
          en: 'Someone else is waiting for that slot, so it passes on.',
          ar: 'هناك شخص آخر ينتظر هذا الموعد، لذا ينتقل إليه.',
        },
        slotTaken: {
          en: 'That time was just taken.',
          ar: 'حُجز هذا الوقت للتو.',
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

  const refreshMyWaitlist = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) return;
    setMyWaitlist(await loadMyWaitlist());
  }, [userId]);

  const refreshSalonWaitlist = useCallback(async () => {
    if (!ownedSalonId) return;
    setSalonWaitlist(await loadSalonWaitlist(ownedSalonId));
  }, [ownedSalonId]);

  /** Puts the customer in the queue for a day, or a window within it. */
  const joinWaitlist = useCallback(
    async (request: WaitlistRequest) => {
      const failure = await joinWaitlistRow(request);
      if (failure) {
        flash(waitlistFailureText(failure));
        return;
      }
      dispatch({ type: 'closeWaitlistSheet' });
      await refreshMyWaitlist();

      // Permission is asked here and nowhere else. Joining a waitlist is the
      // one moment being notified is obviously the point, so it is the moment
      // most likely to be granted — and a refusal is close to permanent, since
      // the browser stops asking and only site settings can undo it. Never on
      // load.
      // 'on' as well as 'ask'. Permission already granted does not mean a
      // device is registered — a registration that failed once used to leave
      // the browser stuck saying yes with nothing on file — so going through
      // here on every join is what repairs it. It is one request when there is
      // nothing to do, and no prompt: the browser only asks once.
      const push = pushState();
      if (isPushConfigured && (push === 'ask' || push === 'on')) {
        const failure = await subscribeToPush();
        flash(failure ? t.waitlistPushRefused : t.waitlistPushGranted);
        return;
      }

      flash(isArabic ? 'أضفناك لقائمة الانتظار ✓' : 'You’re on the waitlist ✓');
    },
    [flash, isArabic, refreshMyWaitlist, t, waitlistFailureText],
  );

  const leaveWaitlist = useCallback(
    async (entryId: string) => {
      const failure = await leaveWaitlistRow(entryId);
      if (failure) {
        flash(waitlistFailureText(failure));
        return;
      }
      await refreshMyWaitlist();
      flash(isArabic ? 'تمت إزالتك من القائمة' : 'Removed from the waitlist');
    },
    [flash, isArabic, refreshMyWaitlist, waitlistFailureText],
  );

  /**
   * Takes the offered seat. This books it for real, through the same priced
   * path as any other appointment — a slot claimed off the waitlist is not a
   * lesser kind of booking.
   */
  const claimSeat = useCallback(
    async (offerId: string) => {
      const result = await claimOffer(offerId);
      if ('error' in result) {
        flash(waitlistFailureText(result.error));
        await refreshMyWaitlist();
        return;
      }
      setLastReference(result.reference);
      await Promise.all([refreshMyWaitlist(), refreshBookings()]);
      dispatch({ type: 'go', screen: 'bookings' });
      flash(isArabic ? 'تم حجز الموعد ✓' : 'The seat is yours ✓');
    },
    [flash, isArabic, refreshBookings, refreshMyWaitlist, waitlistFailureText],
  );

  /**
   * The seat a notification was about, claimed from the token in its link.
   *
   * Same outcome as tapping "Take this seat" on the Bookings screen, which is
   * the point: one tap from the notification instead of two, on a hold that
   * only lasts fifteen minutes.
   */
  const claimByToken = useCallback(
    async (token: string) => {
      const result = await claimOfferByToken(token);
      if ('error' in result) {
        // Whatever went wrong, the Bookings screen is where the answer is: the
        // seat is either still held, gone, or already theirs.
        dispatch({ type: 'go', screen: 'bookings' });
        flash(waitlistFailureText(result.error));
        await refreshMyWaitlist();
        return;
      }
      setLastReference(result.reference);
      await Promise.all([refreshMyWaitlist(), refreshBookings()]);
      dispatch({ type: 'go', screen: 'bookings' });
      flash(isArabic ? 'تم حجز الموعد ✓' : 'The seat is yours ✓');
    },
    [flash, isArabic, refreshBookings, refreshMyWaitlist, waitlistFailureText],
  );

  useEffect(() => {
    const token = pendingClaim.current;
    if (!token || session.status === 'loading') return;

    // A notification is a customer's, so a link should not land somebody on the
    // chooser wondering which half of the app they are in.
    if (state.mode === null) dispatch({ type: 'pickMode', mode: 'customer' });

    if (!userId) {
      // Keep the token: the sheet is in-app, so signing in lands back here with
      // this effect running again and the seat still held.
      if (!claimPrompted.current) {
        claimPrompted.current = true;
        dispatch({ type: 'openAuth', reason: 'booking' });
      }
      return;
    }

    pendingClaim.current = null;
    void claimByToken(token);
  }, [claimByToken, session.status, state.mode, userId]);

  const extendHold = useCallback(
    async (offerId: string) => {
      const failure = await extendOffer(offerId);
      if (failure) {
        flash(waitlistFailureText(failure));
      } else {
        flash(isArabic ? 'تم تمديد المهلة ✓' : 'Given longer ✓');
      }
      await refreshSalonWaitlist();
    },
    [flash, isArabic, refreshSalonWaitlist, waitlistFailureText],
  );

  /** The salon sending a lapsed offer round again, to whoever is next. */
  const reoffer = useCallback(
    async (entryId: string) => {
      const failure = await reofferSlot(entryId);
      if (failure) {
        flash(waitlistFailureText(failure));
      } else {
        flash(isArabic ? 'أُرسل الموعد للتالي في القائمة ✓' : 'Offered to the next in line ✓');
      }
      await refreshSalonWaitlist();
    },
    [flash, isArabic, refreshSalonWaitlist, waitlistFailureText],
  );

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
        case 'closed':
          return isArabic
            ? 'الصالون غير مفتوح في هذا الوقت. اختر وقتاً آخر.'
            : "The salon isn't open then. Please pick another time.";
        case 'sampleData':
          return isArabic
            ? 'هذه بيانات تجريبية ولا يمكن الحجز عليها.'
            : "That's sample data — it can't be booked.";
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
      salonPhotos,
      salon,
      selectedServices,
      totals,
      staffName,
      dateSummary,
      slotSummary,
      availability,
      owner,
      vendorDay,
      timeBlocks,
      blockTime,
      addWalkIn,
      unblockTime,
      photos,
      photoBusy,
      addPhoto,
      removePhoto,
      setCoverPhoto,
      vendorReviews,
      myWaitlist,
      salonWaitlist,
      leaveWaitlist,
      claimSeat,
      extendHold,
      reoffer,
      setAppointment,
      reassignTo,
      answerReview,
      saveMyName,
      setSlotStep,
      setWaitlistEnabled,
      setDayHours,
      registerSalon,
      saveBusinessProfile,
      saveService,
      removeService,
      toggleServiceLive,
      saveStaff,
      removeStaff,
      session,
      requestPasscode,
      submitPasscode,
      signOut,
      deleteAccount,
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
      salonPhotos,
      selectedServices,
      sendBot,
      sendChat,
      session,
      signOut,
      deleteAccount,
      slotSummary,
      availability,
      owner,
      vendorDay,
      timeBlocks,
      blockTime,
      addWalkIn,
      unblockTime,
      photos,
      photoBusy,
      addPhoto,
      removePhoto,
      setCoverPhoto,
      vendorReviews,
      myWaitlist,
      salonWaitlist,
      leaveWaitlist,
      claimSeat,
      extendHold,
      reoffer,
      setAppointment,
      reassignTo,
      answerReview,
      saveMyName,
      setSlotStep,
      setWaitlistEnabled,
      setDayHours,
      registerSalon,
      saveBusinessProfile,
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
