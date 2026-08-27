import { SheetModal } from '../../components/SheetModal';
import { pushState } from '../../lib/push';
import { dateAtOffset, useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { Dictionary } from '../../i18n/en';

/**
 * Joining the queue, from a taken time or from the fully-booked card.
 *
 * The window matters: a customer who says "evening" should not be woken by an
 * offer at ten in the morning. Tapping a specific slot suggests a window around
 * it; the fully-booked card starts with no window at all, because somebody
 * looking at a day with nothing left will usually take whatever appears.
 */
export function WaitlistSheet() {
  const { t, state, dispatch, isArabic, salon, selectedServices, joinWaitlist } = useApp();

  const sheet = state.waitlistSheet;
  if (!sheet) return null;

  const tapped = sheet.time;
  // Two hours either side of the time they tapped — wide enough to be worth
  // queueing for, narrow enough to still mean something.
  const window_ = tapped ? shift(tapped, -60) : null;
  const windowTo = tapped ? shift(tapped, 120) : null;

  const close = () => dispatch({ type: 'closeWaitlistSheet' });

  return (
    <SheetModal
      title={t.waitlistSheetTitle}
      cancelLabel={t.cancel}
      saveLabel={t.waitlistJoinAction}
      onCancel={close}
      onSave={() =>
        void joinWaitlist({
          salonId: salon.id,
          serviceIds: selectedServices.map((service) => service.id),
          day: dateAtOffset(state.dateIdx),
          from: window_,
          to: windowTo,
        })
      }
    >
      <div
        style={{
          background: color.cream,
          border: `1px solid ${color.creamLine}`,
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 12,
          font: `500 12px/1.55 ${font.sans}`,
          color: '#8a6d14',
        }}
      >
        <div style={{ font: `700 12.5px ${font.sans}`, marginBottom: 3 }}>
          {tapped ? t.waitlistAround : t.waitlistAnyTime}
        </div>
        {tapped ? (
          <span className="ltr-run" style={{ font: `600 12px ${font.sans}` }}>
            {window_}–{windowTo}
          </span>
        ) : null}
        <div style={{ marginTop: tapped ? 4 : 0 }}>{t.waitlistWindowNote}</div>
      </div>

      {/*
        What we say here has to match what will actually happen, so it is driven
        by the browser's own state rather than by hope. With no VAPID key
        configured there is no sender, so it keeps the original wording and
        promises nothing; on an iPhone in an ordinary tab it says the one thing
        that would fix it. Promising an alert we cannot send would be the worst
        version of this.
      */}
      <div
        style={{
          font: `500 11px/1.5 ${font.sans}`,
          color: color.mutedSoft,
          marginBottom: 14,
        }}
      >
        {pushNote(t)}
      </div>

      <div style={{ font: `500 11px ${font.sans}`, color: color.mutedFaint, marginBottom: 14 }}>
        {(isArabic ? selectedServices.map((s) => s.ar) : selectedServices.map((s) => s.name)).join(
          ' · ',
        )}
      </div>
    </SheetModal>
  );
}

/** The one line under the window note, matching what this browser can do. */
function pushNote(t: Dictionary): string {
  switch (pushState()) {
    case 'on':
      return t.waitlistPushOn;
    case 'ask':
      return t.waitlistPushAsk;
    case 'denied':
      return t.waitlistPushDenied;
    case 'install':
      return t.waitlistPushInstall;
    default:
      return t.waitlistNoPush;
  }
}

/** "15:00" shifted by minutes, clamped to the day. */
function shift(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${`${Math.floor(total / 60)}`.padStart(2, '0')}:${`${total % 60}`.padStart(2, '0')}`;
}
