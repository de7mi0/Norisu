import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen } from '../../components/Screen';
import { VENDOR_APPOINTMENTS } from '../../data/vendor';
import type { SalonAppointment } from '../../data/vendorBookings';
import { dayLabel, weekdayLabel } from '../../i18n';
import { toRiyadhTime } from '../../data/availability';
import type { TimeBlock } from '../../data/timeOff';
import { useApp, dateAtOffset } from '../../state/context';
import { bookingStatus, color, font } from '../../theme';
import { AppointmentRow } from './appointment';
import { AppointmentSheet } from './AppointmentSheet';
import { BlockSheet } from './BlockSheet';

/** A week from today. The strip used to be four dates in July 2026. */
const DAY_COUNT = 7;

/** Vendor day view: a week strip and that day's appointments. */
export function Calendar() {
  const { t, state, dispatch, isArabic, vendorDay, timeBlocks, unblockTime, owner } = useApp();

  const selected = dateAtOffset(state.vDay);
  const live = vendorDay.source === 'live';
  const ownsSalon = owner.salon !== null;

  // Opens on the next half hour, running an hour. "I am running late, take the
  // rest of this hour off sale" is the reason this button exists, so it should
  // already be most of the way filled in.
  const openBlock = () => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(now.getMinutes() > 30 ? 60 : 30, 0, 0);
    const pad = (n: number) => `${n}`.padStart(2, '0');
    const from = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const to = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    dispatch({ type: 'openBlockSheet', from, to: to === '00:00' ? '23:30' : to });
  };

  return (
    <>
      <Screen bottomInset={88}>
      <div
        style={{
          padding: '56px 24px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <h1 style={{ font: `600 26px ${font.serif}`, margin: 0 }}>{t.bookingsTitle}</h1>
        <button
          type="button"
          className="press"
          onClick={openBlock}
          disabled={!ownsSalon}
          style={{
            font: `600 11px ${font.sans}`,
            color: ownsSalon ? color.goldLink : color.disabled,
            background: color.cream,
            border: `1px solid ${color.creamLine}`,
            padding: '6px 12px',
            borderRadius: 20,
            cursor: ownsSalon ? 'pointer' : 'default',
          }}
        >
          {t.blockTitle}
        </button>
      </div>

      <div
        className="scr hscroll"
        style={{ display: 'flex', gap: 8, padding: '18px 24px 0', overflowX: 'auto' }}
      >
        {Array.from({ length: DAY_COUNT }, (_, index) => {
          const date = dateAtOffset(index);
          const active = state.vDay === index;
          return (
            <button
              key={date.toDateString()}
              type="button"
              onClick={() => dispatch({ type: 'pickVendorDay', index })}
              aria-pressed={active}
              className="press"
              style={{
                flex: 'none',
                width: 50,
                textAlign: 'center',
                padding: '11px 0',
                borderRadius: 15,
                background: active ? color.ink : color.surfaceWarm,
                border: `1.5px solid ${active ? color.ink : color.lineWarm}`,
                color: active ? color.goldSoft : color.ink,
              }}
            >
              <span style={{ display: 'block', font: `500 9.5px ${font.sans}`, opacity: 0.7 }}>
                {weekdayLabel(date, state.lang)}
              </span>
              {/* A Latin day number inside an Arabic button reorders without this. */}
              <span
                className="ltr-run"
                style={{ display: 'block', font: `700 16px ${font.sans}`, marginTop: 3 }}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Only still says "sample" when it is: the notice is gone on live data. */}
      <SampleDataNotice section={live ? undefined : 'schedule'} />

      <div style={{ padding: '20px 24px 0', font: `600 14px ${font.sans}`, color: color.ink }}>
        {dayLabel(selected, state.lang)}
      </div>

      {timeBlocks.length > 0 ? (
        <div
          style={{
            padding: '12px 24px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {timeBlocks.map((block) => (
            <BlockedRow
              key={block.id}
              block={block}
              onFree={() => void unblockTime(block.id)}
            />
          ))}
        </div>
      ) : null}

      <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {live ? (
          <LiveDay appointments={vendorDay.appointments} />
        ) : vendorDay.source === 'loading' ? (
          <Note text={t.loadingDay} />
        ) : vendorDay.source === 'error' ? (
          <Note text={t.dayUnavailable} />
        ) : (
          // No salon of their own, or no backend: the sample day, still labelled.
          VENDOR_APPOINTMENTS.map((appointment) => (
            <div key={`${appointment.time}-${appointment.client}`} style={{ display: 'flex', gap: 12 }}>
              <div
                className="ltr-run"
                style={{
                  width: 44,
                  font: `600 11px ${font.sans}`,
                  color: color.mutedSoft,
                  paddingTop: 14,
                }}
              >
                {appointment.time}
              </div>
              <div
                style={{
                  flex: 1,
                  background: appointment.bg,
                  borderInlineStart: `3px solid ${appointment.dot}`,
                  borderRadius: 12,
                  padding: '13px 14px',
                }}
              >
                <div style={{ font: `600 14px ${font.sans}` }}>
                  {isArabic ? appointment.arClient : appointment.client}
                </div>
                <div style={{ font: `500 11px ${font.sans}`, color: color.muted, marginTop: 3 }}>
                  {isArabic ? appointment.arService : appointment.service}
                </div>
                <div
                  style={{ font: `500 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 4 }}
                >
                  {isArabic ? appointment.arStaff : appointment.staff} ·{' '}
                  {isArabic ? appointment.arStatus : appointment.status}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Screen>

      <AppointmentSheet />
      <BlockSheet />
    </>
  );
}

/** One period taken off sale, with the way to put it back. */
function BlockedRow({ block, onFree }: { block: TimeBlock; onFree: () => void }) {
  const { t, isArabic, owner } = useApp();

  const member = (owner.salon?.staff ?? []).find((s) => s.id === block.staffId);
  const who = block.staffId
    ? (isArabic ? member?.nameAr : member?.name) ?? t.blockedLabel
    : t.blockedAll;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: color.surfaceSand,
        // Hatched rather than coloured: this is the absence of a booking, and
        // it should not read as one more appointment in a different colour.
        border: `1px dashed ${color.lineDashed}`,
        borderRadius: 12,
        padding: '11px 13px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Times only: the day is already the heading above this list. The
            ltr-run wrapper is what stops "10:00 – 11:00" reordering inside an
            Arabic layout. */}
        <div style={{ font: `600 12.5px ${font.sans}`, color: color.inkSoft }}>
          <span className="ltr-run">
            {toRiyadhTime(block.startsAt)} – {toRiyadhTime(block.endsAt)}
          </span>
        </div>
        <div style={{ font: `500 11px ${font.sans}`, color: color.muted, marginTop: 3 }}>
          {who}
          {block.reason ? ` · ${block.reason}` : ''}
        </div>
      </div>
      <button
        type="button"
        className="press"
        onClick={onFree}
        style={{
          flex: 'none',
          font: `600 10.5px ${font.sans}`,
          color: color.goldLink,
          background: color.surface,
          border: `1px solid ${color.lineWarm}`,
          borderRadius: 14,
          padding: '6px 10px',
          cursor: 'pointer',
        }}
      >
        {t.blockRemove}
      </button>
    </div>
  );
}

/**
 * The owner's real day. An empty one is a normal Tuesday, not a fault, so it
 * says so plainly rather than showing a spinner or nothing at all.
 */
function LiveDay({ appointments }: { appointments: SalonAppointment[] }) {
  const { t, isArabic, dispatch } = useApp();

  if (appointments.length === 0) return <Note text={t.noAppointments} />;

  return (
    <>
      {appointments.map((appointment) => {
        const tone = bookingStatus[appointment.status];
        return (
          <div key={appointment.id} style={{ display: 'flex', gap: 12 }}>
            <div
              className="ltr-run"
              style={{
                width: 44,
                font: `600 11px ${font.sans}`,
                color: color.mutedSoft,
                paddingTop: 14,
              }}
            >
              {appointment.time}
            </div>
            {/* The whole row is the control: an owner reaches for the
                appointment, not for a small button beside it. */}
            <button
              type="button"
              onClick={() => dispatch({ type: 'openAppointment', bookingId: appointment.id })}
              className="press"
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'start',
                background: tone.bg,
                borderInlineStart: `3px solid ${tone.dot}`,
                borderRadius: 12,
                padding: '13px 14px',
                cursor: 'pointer',
              }}
            >
              <AppointmentRow appointment={appointment} isArabic={isArabic} t={t} />
            </button>
          </div>
        );
      })}
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${color.lineDashed}`,
        borderRadius: 12,
        padding: '18px 14px',
        textAlign: 'center',
        font: `500 12px/1.5 ${font.sans}`,
        color: color.mutedSoft,
      }}
    >
      {text}
    </div>
  );
}
