import { useEffect, useRef } from 'react';
import { isAndroidApp } from '../lib/native';
import {
  CUSTOMER_TAB_SCREENS,
  VENDOR_TAB_SCREENS,
  type Action,
  type AppState,
} from '../state/appReducer';
import type { CustomerScreen, VendorScreen } from '../types';

/**
 * The Android back button.
 *
 * This is the largest single difference between a web page and an Android app,
 * and the one that makes a wrapped app feel broken if it is ignored.
 * Capacitor's default is to step back through WebView history and close the
 * app when there is none — and Saloni has none, because navigation is a screen
 * name in state rather than a router (CLAUDE.md §2). So without this, pressing
 * back anywhere would shut the app immediately.
 *
 * The order below is what Android users expect, most-local first:
 *
 *   1. A sheet or overlay is open   → shut that, and nothing else.
 *   2. On the first tab             → leave the app.
 *   3. On another tab               → to the first tab, because the tab bar is
 *                                     a flat row rather than a stack.
 *   4. Anywhere else                → the app's own back, so it agrees with
 *                                     the arrow drawn on screen. That already
 *                                     knows about abandoning a reschedule and
 *                                     about chat remembering where it opened
 *                                     from.
 *
 * Leaving means `minimizeApp()`, not `exitApp()`: Android's convention is that
 * back sends an app to the background where it can be resumed, and killing the
 * process would throw away the signed-in session's in-memory state for no
 * reason. Nothing needs confirming before leaving, because nothing is ever
 * half-written — every sheet either commits through the database or discards,
 * so the worst case is retyping a reason.
 *
 * A no-op on the web, where the Capacitor global does not exist.
 */
export function useHardwareBack(state: AppState, dispatch: (action: Action) => void) {
  // The listener is registered once and must not be torn down and rebuilt on
  // every keystroke, so it reads the live state through a ref rather than
  // closing over it.
  const latest = useRef(state);
  latest.current = state;

  const send = useRef(dispatch);
  send.current = dispatch;

  useEffect(() => {
    if (!isAndroidApp()) return;

    let remove: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      // Imported here rather than at the top of the file so the plugin stays
      // out of the web bundle entirely. Statically imported it cost 11.5 kB
      // that every browser downloaded and no browser ever ran.
      const { App } = await import('@capacitor/app');

      const handle = await App.addListener('backButton', () => {
        const s = latest.current;
        const go = send.current;

        // 1. Anything floating over the screen closes first. Only one is ever
        //    open, so the order is for readability rather than precedence.
        if (s.authOpen) return go({ type: 'closeAuth' });
        if (s.deleteSheet) return go({ type: 'closeDeleteSheet' });
        if (s.closeSheet) return go({ type: 'closeCloseSheet' });
        if (s.adminReasonSheet) return go({ type: 'closeAdminReason' });
        if (s.walkInSheet) return go({ type: 'closeWalkInSheet' });
        if (s.blockSheet) return go({ type: 'closeBlockSheet' });
        if (s.apptSheet) return go({ type: 'closeAppointment' });
        if (s.waitlistSheet) return go({ type: 'closeWaitlistSheet' });
        if (s.svcModal) return go({ type: 'closeServiceModal' });
        if (s.staffModal) return go({ type: 'closeStaffModal' });
        if (s.nameModal) return go({ type: 'closeNameSheet' });

        // 2-4. Then the screen itself. The opening chooser has nothing behind
        //      it, so it leaves like a first tab does.
        if (s.mode === null) return void App.minimizeApp();

        const first = firstTabFor(s.mode);
        if (s.screen === first) return void App.minimizeApp();
        if (isTabScreen(s)) return go({ type: 'go', screen: first });
        go({ type: 'back' });
      });

      // Both the import and the listener resolve asynchronously, so an unmount
      // that happens first has to be remembered rather than assumed impossible.
      if (cancelled) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
}

/**
 * Where back stops in each section.
 *
 * Derived from `mode` rather than from a list of every screen, so a screen
 * added later behaves like the rest of its section without anybody having to
 * remember this file.
 */
function firstTabFor(mode: NonNullable<AppState['mode']>): AppState['screen'] {
  if (mode === 'vendor') return 'v_dash';
  // The back office has no tab bar — two screens, and its register is where
  // back stops.
  if (mode === 'admin') return 'a_queue';
  return 'home';
}

/**
 * Whether this screen sits in the tab bar, which decides between "go to the
 * first tab" and "step back one screen".
 */
function isTabScreen(state: AppState): boolean {
  if (state.mode === 'customer') {
    return CUSTOMER_TAB_SCREENS.includes(state.screen as CustomerScreen);
  }
  if (state.mode === 'vendor') {
    return VENDOR_TAB_SCREENS.includes(state.screen as VendorScreen);
  }
  // Admin's only other screen is the salon detail, opened from the register,
  // so it steps back to it.
  return false;
}
