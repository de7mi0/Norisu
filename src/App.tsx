import { useEffect } from 'react';
import { PhoneFrame } from './components/PhoneFrame';
import { TabBar, type TabItem } from './components/TabBar';
import { Toast } from './components/Toast';
import {
  CalendarCheckIcon,
  CalendarIcon,
  MenuIcon,
  SearchIcon,
  StorefrontIcon,
  UserIcon,
} from './components/icons';
import { useDragScroll } from './hooks/useDragScroll';
import { AppProvider } from './state/AppContext';
import { useApp } from './state/context';
import { CUSTOMER_TAB_SCREENS, VENDOR_TAB_SCREENS } from './state/appReducer';
import { color, font } from './theme';
import type { CustomerScreen, VendorScreen } from './types';

import { Auth } from './screens/Auth';
import { AssistantBot } from './screens/customer/AssistantBot';
import { Bookings } from './screens/customer/Bookings';
import { Chat } from './screens/customer/Chat';
import { Chooser } from './screens/customer/Chooser';
import { Confirmation } from './screens/customer/Confirmation';
import { Home } from './screens/customer/Home';
import { Payment } from './screens/customer/Payment';
import { Profile } from './screens/customer/Profile';
import { Reviews } from './screens/customer/Reviews';
import { SalonDetail } from './screens/customer/SalonDetail';
import { StaffPicker } from './screens/customer/StaffPicker';
import { TimePicker } from './screens/customer/TimePicker';

import { Calendar } from './screens/vendor/Calendar';
import { Dashboard } from './screens/vendor/Dashboard';
import { Gallery } from './screens/vendor/Gallery';
import { More } from './screens/vendor/More';
import { Onboarding } from './screens/vendor/Onboarding';
import { Services } from './screens/vendor/Services';
import { Staff } from './screens/vendor/Staff';
import { VendorReviews } from './screens/vendor/VendorReviews';
import { Waitlist } from './screens/vendor/Waitlist';

const CUSTOMER_SCREENS: Record<CustomerScreen, () => React.ReactElement> = {
  home: Home,
  salon: SalonDetail,
  staff: StaffPicker,
  time: TimePicker,
  pay: Payment,
  confirm: Confirmation,
  reviews: Reviews,
  bookings: Bookings,
  profile: Profile,
  chat: Chat,
  bot: AssistantBot,
};

const VENDOR_SCREENS: Record<VendorScreen, () => React.ReactElement> = {
  v_onboard: Onboarding,
  v_dash: Dashboard,
  v_calendar: Calendar,
  v_services: Services,
  v_gallery: Gallery,
  v_staff: Staff,
  v_reviews: VendorReviews,
  v_more: More,
  v_waitlist: Waitlist,
};

function CurrentScreen() {
  const { state } = useApp();

  if (state.mode === null) return <Chooser />;

  if (state.mode === 'customer') {
    const Screen = CUSTOMER_SCREENS[state.screen as CustomerScreen];
    return Screen ? <Screen /> : <Home />;
  }

  const Screen = VENDOR_SCREENS[state.screen as VendorScreen];
  return Screen ? <Screen /> : <Dashboard />;
}

function Navigation() {
  const { t, state, dispatch } = useApp();

  if (state.mode === 'customer' && CUSTOMER_TAB_SCREENS.includes(state.screen as CustomerScreen)) {
    const items: TabItem[] = [
      {
        key: 'home',
        label: t.explore,
        icon: <SearchIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'home' }),
      },
      {
        key: 'bookings',
        label: t.bookingsTab,
        icon: <CalendarCheckIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'bookings' }),
      },
      {
        key: 'profile',
        label: t.profile,
        icon: <UserIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'profile' }),
      },
    ];
    return <TabBar items={items} activeKey={state.screen} label={t.explore} />;
  }

  if (state.mode === 'vendor' && VENDOR_TAB_SCREENS.includes(state.screen as VendorScreen)) {
    const items: TabItem[] = [
      {
        key: 'v_dash',
        label: t.dashboard,
        icon: <StorefrontIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'v_dash' }),
      },
      {
        key: 'v_calendar',
        label: t.calendar,
        icon: <CalendarIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'v_calendar' }),
      },
      {
        key: 'v_services',
        label: t.servicesTab,
        icon: (
          <span
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              display: 'block',
              background: state.screen === 'v_services' ? color.gold : 'transparent',
              border: state.screen === 'v_services' ? 'none' : `1.6px solid ${color.mutedFaint}`,
            }}
          />
        ),
        onSelect: () => dispatch({ type: 'go', screen: 'v_services' }),
      },
      {
        key: 'v_more',
        label: t.more,
        icon: <MenuIcon />,
        onSelect: () => dispatch({ type: 'go', screen: 'v_more' }),
      },
    ];
    return <TabBar items={items} activeKey={state.screen} label={t.dashboard} />;
  }

  return null;
}

/** Floating overlays: waitlist banner, assistant button, and the toast. */
function Overlays() {
  const { t, state, dispatch, arrow, openConversation } = useApp();

  const onCustomerTabScreen =
    state.mode === 'customer' && CUSTOMER_TAB_SCREENS.includes(state.screen as CustomerScreen);
  const showSeatBanner =
    state.mode === 'customer' &&
    state.seatOpen &&
    !state.seatBannerDismissed &&
    state.screen !== 'time';

  return (
    <>
      {showSeatBanner ? (
        // The banner floats over the header, so it stays dismissible — otherwise
        // it would cover the back button on screens without a tab bar.
        <div
          style={{
            position: 'absolute',
            top: 44,
            insetInline: 14,
            background: color.teal,
            color: '#fff',
            borderRadius: 16,
            padding: '12px 14px',
            zIndex: 75,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 14px 30px -12px rgba(15,122,107,.7)',
            animation: 'rise .4s both',
          }}
        >
          <span style={{ fontSize: 18 }} aria-hidden="true">
            🎉
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'bookFromWaitlist' })}
            className="press"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'inherit',
              textAlign: 'start',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: `700 12px ${font.sans}` }}>
                {t.seatBannerTitle}
              </span>
              <span style={{ display: 'block', font: `500 10.5px ${font.sans}`, opacity: 0.85 }}>
                {t.seatBannerSub}
              </span>
            </span>
            <span style={{ fontSize: 16 }} aria-hidden="true">
              {arrow}
            </span>
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'dismissSeatBanner' })}
            aria-label={state.lang === 'ar' ? 'إخفاء' : 'Dismiss'}
            style={{
              flex: 'none',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(255,255,255,.18)',
              color: '#fff',
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {onCustomerTabScreen ? (
        <button
          type="button"
          onClick={() => openConversation('bot')}
          aria-label={t.assistantName}
          className="press"
          style={{
            position: 'absolute',
            bottom: 90,
            insetInlineEnd: 16,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: color.ink,
            color: color.goldSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            zIndex: 55,
            boxShadow: '0 14px 30px -10px rgba(0,0,0,.55)',
          }}
        >
          <span aria-hidden="true">🤖</span>
        </button>
      ) : null}

      {/* Above every screen and both tab bars, so it can be opened from any of them. */}
      {state.authOpen ? <Auth /> : null}

      <Toast message={state.toast} />
    </>
  );
}

function AppShell() {
  const { state, dir } = useApp();
  useDragScroll();

  // Keep the document in step with the in-app language for assistive tech.
  useEffect(() => {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = dir;
  }, [dir, state.lang]);

  return (
    <PhoneFrame dir={dir} lang={state.lang}>
      <CurrentScreen />
      <Navigation />
      <Overlays />
    </PhoneFrame>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
