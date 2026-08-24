import { BottomBar, Screen, ScreenHeader } from '../../components/Screen';
import { WaitlistSheet } from './WaitlistSheet';
import { monthLabel, weekdayLabel } from '../../i18n';
import { dateAtOffset, useApp } from '../../state/context';
import { color, font } from '../../theme';

const DATE_OFFSETS = [0, 1, 2, 3, 4, 5];

/** Step 2 of the booking flow: date, time slot, and the waitlist path. */
export function TimePicker() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    staffName,
    rescheduleBooking,
    availability,
    salon,
    myWaitlist,
    session,
  } = useApp();

  const loading = availability.source === 'loading';
  const closed = availability.source === 'closed';
  const dayIsFull = !loading && !closed && availability.slots.every((slot) => !slot.free);
  const slotChosen = state.slotTime != null;

  const day = dateAtOffset(state.dateIdx);
  // Only a real, signed-in customer can queue for a real salon: a sample
  // catalogue row has no id the database could match.
  const canWaitlist =
    availability.source === 'live' &&
    session.status === 'signedIn' &&
    !state.reschedule;
  const alreadyWaiting = myWaitlist.entries.some(
    (entry) =>
      entry.salonId === salon.id &&
      entry.day === `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, '0')}-${`${day.getDate()}`.padStart(2, '0')}`,
  );

  return (
    <>
      <Screen bottomInset={96}>
        <ScreenHeader
          onBack={() => dispatch({ type: 'back' })}
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={t.selectDateTime}
          subtitle={`${t.step2} · ${t.withWord} ${staffName}`}
        />

        {state.reschedule ? (
          <div
            style={{
              margin: '16px 24px 0',
              background: color.cream,
              border: `1px solid ${color.creamLine}`,
              borderRadius: 12,
              padding: '11px 14px',
              font: `600 11.5px ${font.sans}`,
              color: '#8a6d14',
            }}
          >
            {t.reschedulingNote}
          </div>
        ) : null}

        <div style={{ padding: '22px 24px 0' }}>
          <div style={{ font: `600 14px ${font.sans}`, marginBottom: 12 }}>
            {monthLabel(dateAtOffset(state.dateIdx), state.lang)}
          </div>
          <div className="scr hscroll" style={{ display: 'flex', gap: 9, overflowX: 'auto' }}>
            {DATE_OFFSETS.map((offset) => {
              const date = dateAtOffset(offset);
              const active = state.dateIdx === offset;
              return (
                <button
                  key={offset}
                  type="button"
                  onClick={() => dispatch({ type: 'pickDate', dateIdx: offset })}
                  aria-pressed={active}
                  className="press"
                  style={{
                    flex: 'none',
                    width: 56,
                    textAlign: 'center',
                    padding: '12px 0',
                    borderRadius: 16,
                    background: active ? color.ink : color.surfaceWarm,
                    border: `1.5px solid ${active ? color.ink : color.lineWarm}`,
                    color: active ? color.goldSoft : color.ink,
                  }}
                >
                  <span style={{ display: 'block', font: `500 10.5px ${font.sans}`, opacity: 0.7 }}>
                    {weekdayLabel(date, state.lang)}
                  </span>
                  <span style={{ display: 'block', font: `700 18px ${font.sans}`, marginTop: 3 }}>
                    {date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ font: `600 14px ${font.sans}`, marginBottom: 12 }}>{t.availableSlots}</div>

          {availability.source === 'error' ? (
            <div
              style={{
                marginBottom: 12,
                background: color.cream,
                border: `1px solid ${color.creamLine}`,
                borderRadius: 12,
                padding: '10px 13px',
                font: `500 11.5px/1.5 ${font.sans}`,
                color: '#8a6d14',
              }}
            >
              {t.sampleTimesNotice}
            </div>
          ) : null}

          {loading ? (
            <>
              <div
                style={{
                  font: `500 12px ${font.sans}`,
                  color: color.mutedSoft,
                  marginBottom: 12,
                }}
              >
                {t.checkingTimes}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[0, 1, 2, 3, 4, 5].map((placeholder) => (
                  <div
                    key={placeholder}
                    aria-hidden="true"
                    style={{
                      height: 45,
                      borderRadius: 13,
                      background: color.surfaceSand,
                      border: `1.5px solid ${color.lineFaint}`,
                    }}
                  />
                ))}
              </div>
            </>
          ) : closed ? (
            <div
              style={{
                background: color.surfaceWarm,
                border: `1px solid ${color.lineWarm}`,
                borderRadius: 14,
                padding: '16px 14px',
                font: `500 12.5px/1.5 ${font.sans}`,
                color: color.mutedSoft,
                textAlign: 'center',
              }}
            >
              {t.closedThisDay}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {availability.slots.map((slot) => {
                const taken = !slot.free;
                const active = state.slotTime === slot.time;
                // A taken time is no longer a dead button: tapping it offers to
                // put the customer on the waitlist for around then, which is how
                // people actually think — "I want Thursday evening".
                const waitlistable = taken && canWaitlist;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={taken && !waitlistable}
                    onClick={() =>
                      waitlistable
                        ? dispatch({ type: 'openWaitlistSheet', time: slot.time })
                        : dispatch({ type: 'pickSlot', time: slot.time })
                    }
                    title={waitlistable ? t.joinWaitlist : undefined}
                    aria-pressed={active}
                    className="press"
                    style={{
                      textAlign: 'center',
                      padding: '13px 0',
                      borderRadius: 13,
                      font: `600 13px ${font.sans}`,
                      cursor: taken && !waitlistable ? 'not-allowed' : 'pointer',
                      background: taken
                        ? color.surfaceSand
                        : active
                          ? color.gold
                          : color.surface,
                      border: `1.5px solid ${
                        taken
                          ? waitlistable
                            ? color.lineDashed
                            : color.lineFaint
                          : active
                            ? color.gold
                            : color.lineWarm
                      }`,
                      color: taken ? color.disabled : active ? color.goldInk : color.ink,
                    }}
                  >
                    {/* Digits inside Arabic text reorder without this. */}
                    <span className="ltr-run">{slot.time}</span>
                    {waitlistable ? (
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'block',
                          font: `600 8.5px ${font.sans}`,
                          color: color.mutedSoft,
                          marginTop: 1,
                        }}
                      >
                        {t.waitShort}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {dayIsFull ? (
          <div
            style={{
              margin: '20px 24px 0',
              background: color.cream,
              border: `1px solid ${color.creamLine}`,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div
              style={{
                font: `600 14px ${font.sans}`,
                color: '#8a6d14',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span aria-hidden="true">⏳</span>
              {t.fullyBooked}
            </div>
            <p
              style={{
                font: `500 11.5px/1.5 ${font.sans}`,
                color: color.mutedSoft,
                margin: '6px 0 0',
              }}
            >
              {t.waitlistDesc}
            </p>

            {canWaitlist ? (
              alreadyWaiting ? (
                <div
                  style={{
                    marginTop: 12,
                    background: color.tealSoft,
                    border: `1px solid ${color.tealLine}`,
                    borderRadius: 12,
                    padding: '11px 13px',
                    font: `600 11.5px/1.5 ${font.sans}`,
                    color: color.teal,
                  }}
                >
                  {t.onWaitlist}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'openWaitlistSheet', time: null })}
                  className="press"
                  style={{
                    marginTop: 12,
                    width: '100%',
                    textAlign: 'center',
                    background: color.ink,
                    color: color.goldSoft,
                    borderRadius: 13,
                    padding: 13,
                    font: `700 13px ${font.sans}`,
                  }}
                >
                  {t.joinWaitlist}
                </button>
              )
            ) : (
              <div style={{ marginTop: 10, font: `500 11px ${font.sans}`, color: color.mutedFaint }}>
                {t.waitlistClosed}
              </div>
            )}
          </div>
        ) : null}

        <WaitlistSheet />
      </Screen>

      <BottomBar>
        <button
          type="button"
          // Moving an existing appointment skips checkout entirely: it was paid
          // for (or not) once already, and its prices are snapshotted. Sending
          // it through payment again is what created a second booking.
          onClick={() => {
            if (!slotChosen) return;
            if (state.reschedule) void rescheduleBooking();
            else dispatch({ type: 'go', screen: 'pay' });
          }}
          disabled={!slotChosen}
          className="press"
          style={{
            width: '100%',
            textAlign: 'center',
            background: slotChosen ? color.gold : '#f0ece2',
            color: slotChosen ? color.goldInk : '#b8b2a5',
            borderRadius: 15,
            padding: 16,
            font: `700 14px ${font.sans}`,
            cursor: slotChosen ? 'pointer' : 'not-allowed',
          }}
        >
          {!slotChosen
            ? isArabic
              ? 'اختر وقتاً'
              : 'Select a slot'
            : state.reschedule
              ? t.bookConfirmMove
              : isArabic
                ? 'المتابعة للدفع'
                : 'Continue to payment'}
        </button>
      </BottomBar>
    </>
  );
}
