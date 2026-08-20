import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen } from '../../components/Screen';
import { VENDOR_APPOINTMENTS, VENDOR_NAME, VENDOR_STATS } from '../../data/vendor';
import type { SalonStats } from '../../data/vendorBookings';
import type { Dictionary } from '../../i18n/en';
import { useApp } from '../../state/context';
import { bookingStatus, color, font } from '../../theme';
import { AppointmentRow } from './appointment';

/** One tile. `value` is already formatted; `sub` is the line beneath it. */
interface Tile {
  key: string;
  label: string;
  value: string;
  sub: string;
  accent: string;
}

/**
 * The four figures, from the owner's own day.
 *
 * "Booked today" is deliberately not "Revenue today", which is what this tile
 * used to say. Nothing is paid: a booking records a payment method but
 * `paid_at` stays null because no money moves yet. Reporting agreed value as
 * takings would be exactly the kind of fiction the rest of this portal spent
 * three commits removing.
 */
function liveTiles(stats: SalonStats, t: Dictionary, isArabic: boolean): Tile[] {
  const riyals = Math.round(stats.bookedHalalas / 100);
  const delta = stats.bookingsToday - stats.bookingsYesterday;

  return [
    {
      key: 'bookings',
      label: t.statBookings,
      value: String(stats.bookingsToday),
      sub:
        delta === 0
          ? t.statBookingsSame
          : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${t.statBookingsUp}`,
      accent: '#f5c542',
    },
    {
      key: 'booked',
      label: t.statBooked,
      value: riyals.toLocaleString(isArabic ? 'ar-SA-u-nu-latn' : 'en-US'),
      sub: t.statBookedSub,
      accent: '#3fd6c1',
    },
    {
      key: 'rating',
      label: t.statRating,
      // "New" rather than 0.0 — the same answer the customer's salon card gives.
      value: stats.rating == null ? t.statNew : stats.rating.toFixed(1),
      sub:
        stats.rating == null
          ? t.statRatingNone
          : `${stats.reviewCount} ${t.statRatingCount}`,
      accent: '#f5c542',
    },
    {
      key: 'occupancy',
      label: t.statOccupancy,
      // A closed day is not an empty one, so it says so instead of showing 0%.
      value: stats.occupancyPercent == null ? '—' : `${stats.occupancyPercent}%`,
      sub: stats.isOpen ? t.statOccupancySub : t.statOccupancyClosed,
      accent: '#c9a0f5',
    },
  ];
}

/** Vendor home: today's key numbers and schedule. */
export function Dashboard() {
  const { t, dispatch, isArabic, owner, vendorDay } = useApp();

  // The owner's real salon when we know it, the sample one otherwise.
  const salonName = owner.salon ? (isArabic ? owner.salon.nameAr : owner.salon.name) : VENDOR_NAME;

  // Narrowed once, so the tiles and the schedule below agree on whether this
  // is the owner's own day or the sample one.
  const stats = vendorDay.source === 'live' ? vendorDay.stats : null;
  const tiles: Tile[] = stats
    ? liveTiles(stats, t, isArabic)
    : VENDOR_STATS.map((stat) => ({
        key: stat.label,
        label: isArabic ? stat.arLabel : stat.label,
        value: stat.value,
        sub: isArabic ? stat.arSub : stat.sub,
        accent: stat.accent,
      }));

  return (
    <Screen bottomInset={88}>
      <div
        style={{
          background: 'linear-gradient(165deg,#1c1913,#2a2413)',
          padding: '52px 24px 26px',
          color: color.page,
          borderRadius: '0 0 26px 26px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ font: `500 12px ${font.sans}`, color: '#cfc7b4' }}>{t.goodMorning}</div>
            <div style={{ font: `600 24px ${font.serif}`, marginTop: 2 }}>{salonName}</div>
          </div>
          <div
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'repeating-linear-gradient(135deg,#3a3320 0 6px,#2f2917 6px 12px)',
              border: `1.5px solid ${color.gold}`,
            }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 11,
            marginTop: 20,
          }}
        >
          {tiles.map((tile) => (
            <div
              key={tile.key}
              style={{
                background: 'rgba(255,255,255,.06)',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 16,
                padding: 14,
              }}
            >
              {/* Figures and percentages are Latin runs; isolate them so they
                  do not reorder inside the Arabic labels around them. */}
              <span
                className="ltr-run"
                style={{
                  display: 'block',
                  font: `700 24px ${font.sans}`,
                  color: tile.accent,
                }}
              >
                {tile.value}
              </span>
              <div style={{ font: `600 11px ${font.sans}`, color: '#ece7dd', marginTop: 2 }}>
                {tile.label}
              </div>
              <div style={{ font: `500 10px ${font.sans}`, color: '#8a8272', marginTop: 1 }}>
                {tile.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gone once the figures and the schedule below are genuinely theirs. */}
      <SampleDataNotice section={stats ? undefined : 'dashboard'} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '22px 24px 0',
        }}
      >
        <h2 style={{ font: `600 20px ${font.serif}`, margin: 0 }}>{t.todaySchedule}</h2>
        <button
          type="button"
          onClick={() => dispatch({ type: 'go', screen: 'v_calendar' })}
          style={{ font: `500 11px ${font.sans}`, color: color.goldLink }}
        >
          {t.calendarArrow}
        </button>
      </div>

      <div style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stats ? (
          vendorDay.appointments.length === 0 ? (
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
              {stats.isOpen ? t.noAppointments : t.closedThisDay}
            </div>
          ) : (
            vendorDay.appointments.map((appointment) => {
              const tone = bookingStatus[appointment.status];
              return (
                <div
                  key={appointment.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'stretch',
                    background: tone.bg,
                    border: `1px solid ${tone.line}`,
                    borderRadius: 15,
                    padding: '13px 14px',
                  }}
                >
                  <div
                    style={{
                      textAlign: 'center',
                      paddingInlineEnd: 12,
                      borderInlineEnd: '1px solid rgba(0,0,0,.08)',
                    }}
                  >
                    <span
                      className="ltr-run"
                      style={{ font: `700 13px ${font.sans}`, color: color.ink }}
                    >
                      {appointment.time}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <AppointmentRow appointment={appointment} isArabic={isArabic} t={t} />
                  </div>
                </div>
              );
            })
          )
        ) : (
          VENDOR_APPOINTMENTS.map((appointment) => (
            <div
              key={`${appointment.time}-${appointment.client}`}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'stretch',
                background: appointment.bg,
                border: `1px solid ${appointment.bd}`,
                borderRadius: 15,
                padding: '13px 14px',
              }}
            >
              <div
                style={{
                  textAlign: 'center',
                  paddingInlineEnd: 12,
                  borderInlineEnd: '1px solid rgba(0,0,0,.08)',
                }}
              >
                <span
                  className="ltr-run"
                  style={{ font: `700 13px ${font.sans}`, color: color.ink }}
                >
                  {appointment.time}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: `600 14px ${font.sans}` }}>
                    {isArabic ? appointment.arClient : appointment.client}
                  </span>
                  <span
                    style={{
                      font: `600 10px ${font.sans}`,
                      color: color.muted,
                      background: 'rgba(255,255,255,.7)',
                      padding: '3px 8px',
                      borderRadius: 8,
                      height: 'fit-content',
                    }}
                  >
                    {isArabic ? appointment.arStatus : appointment.status}
                  </span>
                </div>
                <div style={{ font: `500 11px ${font.sans}`, color: color.muted, marginTop: 3 }}>
                  {isArabic ? appointment.arService : appointment.service} ·{' '}
                  {isArabic ? appointment.arStaff : appointment.staff}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Screen>
  );
}
