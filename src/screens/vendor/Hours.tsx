import { useState } from 'react';
import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen, ScreenHeader } from '../../components/Screen';
import { weekdayLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { DayHours } from '../../data/owner';

/**
 * Opening hours and booking interval — the two salon settings the booking
 * screen already obeys.
 *
 * `working_hours` and `salons.slot_step_minutes` have driven `available_slots()`
 * since migration 0003, but there was nowhere for an owner to change them: the
 * portal did not know whose salon it was showing. Now that it does, this is the
 * screen those columns were waiting for.
 */

/** The steps the schema's check constraint allows. */
const STEPS = [10, 15, 20, 30, 60];

/** Every half hour of the day, which is as fine as opening times need to be. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = `${Math.floor(i / 2)}`.padStart(2, '0');
  return `${hour}:${i % 2 ? '30' : '00'}`;
});

/** A date that falls on the given weekday, purely to get its localised name. */
function dateForWeekday(dayOfWeek: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + ((dayOfWeek - date.getDay() + 7) % 7));
  return date;
}

export function Hours() {
  const { t, state, dispatch, isArabic, backIcon, owner, setSlotStep, setDayHours } = useApp();

  const salon = owner.salon;
  // Which day's row is mid-save, so its controls can be disabled.
  const [saving, setSaving] = useState<number | null>(null);

  const commit = async (day: DayHours) => {
    setSaving(day.dayOfWeek);
    await setDayHours(day);
    setSaving(null);
  };

  return (
    <Screen bottomInset={40}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.hoursTitle}
        subtitle={salon ? (isArabic ? salon.nameAr : salon.name) : undefined}
      />

      <SampleDataNotice />

      {!salon ? (
        <p
          style={{
            margin: '18px 24px 0',
            font: `500 12.5px/1.6 ${font.sans}`,
            color: color.mutedSoft,
          }}
        >
          {t.hoursNeedSalon}
        </p>
      ) : (
        <>
          {/* ---- Booking interval ---- */}
          <div style={{ padding: '20px 24px 0' }}>
            <div style={{ font: `600 14px ${font.sans}` }}>{t.bookingInterval}</div>
            <p
              style={{
                font: `500 11.5px/1.55 ${font.sans}`,
                color: color.mutedSoft,
                margin: '5px 0 12px',
              }}
            >
              {t.bookingIntervalHelp}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STEPS.map((minutes) => {
                const active = salon.slotStepMinutes === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => void setSlotStep(minutes)}
                    aria-pressed={active}
                    className="press"
                    style={{
                      padding: '10px 14px',
                      borderRadius: 12,
                      font: `600 12.5px ${font.sans}`,
                      background: active ? color.ink : color.surface,
                      border: `1.5px solid ${active ? color.ink : color.lineWarm}`,
                      color: active ? color.goldSoft : color.ink,
                    }}
                  >
                    {/* Digits beside Arabic text reorder without isolation. */}
                    <span className="ltr-run">{minutes}</span> {t.minutesShort}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- Opening hours ---- */}
          <div style={{ padding: '26px 24px 0' }}>
            <div style={{ font: `600 14px ${font.sans}` }}>{t.openingHours}</div>
            <p
              style={{
                font: `500 11.5px/1.55 ${font.sans}`,
                color: color.mutedSoft,
                margin: '5px 0 12px',
              }}
            >
              {t.openingHoursHelp}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {salon.hours.map((day) => {
                const closed = !day.opensAt || !day.closesAt;
                const busy = saving === day.dayOfWeek;
                return (
                  <div
                    key={day.dayOfWeek}
                    style={{
                      background: color.surface,
                      border: `1px solid ${color.lineWarm}`,
                      borderRadius: 14,
                      padding: '12px 14px',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <span style={{ font: `600 13px ${font.sans}` }}>
                        {weekdayLabel(dateForWeekday(day.dayOfWeek), state.lang)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void commit(
                            closed
                              ? { dayOfWeek: day.dayOfWeek, opensAt: '10:00', closesAt: '22:00' }
                              : { dayOfWeek: day.dayOfWeek, opensAt: null, closesAt: null },
                          )
                        }
                        className="press"
                        style={{
                          padding: '6px 11px',
                          borderRadius: 9,
                          font: `600 11px ${font.sans}`,
                          background: closed ? color.surfaceSand : color.tealSoft,
                          border: `1px solid ${closed ? color.lineFaint : color.tealLine}`,
                          color: closed ? color.mutedSoft : color.teal,
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        {closed ? t.dayClosed : t.dayOpen}
                      </button>
                    </div>

                    {closed ? null : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <TimeSelect
                          label={t.opensAt}
                          value={day.opensAt ?? '10:00'}
                          disabled={busy}
                          onChange={(value) =>
                            void commit({ ...day, opensAt: value, closesAt: day.closesAt })
                          }
                        />
                        <span style={{ color: color.mutedFaint }}>–</span>
                        <TimeSelect
                          label={t.closesAt}
                          value={day.closesAt ?? '22:00'}
                          disabled={busy}
                          onChange={(value) =>
                            void commit({ ...day, opensAt: day.opensAt, closesAt: value })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p
              style={{
                font: `500 11px/1.55 ${font.sans}`,
                color: color.mutedFaint,
                margin: '14px 0 0',
              }}
            >
              {t.hoursAffectBooking}
            </p>
          </div>
        </>
      )}
    </Screen>
  );
}

interface TimeSelectProps {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** A plain select, so the phone's own time wheel is used on a real device. */
function TimeSelect({ label, value, disabled, onChange }: TimeSelectProps) {
  return (
    <label style={{ flex: 1 }}>
      <span
        style={{
          display: 'block',
          font: `500 10px ${font.sans}`,
          color: color.mutedFaint,
          marginBottom: 3,
        }}
      >
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: '100%',
          padding: '8px 9px',
          borderRadius: 10,
          border: `1.5px solid ${color.lineWarm}`,
          background: color.surfaceWarm,
          font: `600 12.5px ${font.sans}`,
          color: color.ink,
          direction: 'ltr',
        }}
      >
        {TIMES.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </label>
  );
}
