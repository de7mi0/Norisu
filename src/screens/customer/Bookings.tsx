import { Screen } from '../../components/Screen';
import { PAST_BOOKINGS } from '../../data/reviews';
import { SALONS } from '../../data/salons';
import { translateStatus } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** The customer's upcoming and past appointments. */
export function Bookings() {
  const { t, state, dispatch, isArabic, flash, salon: currentSalon } = useApp();

  const showingUpcoming = state.bookTab === 'upcoming';
  const list = showingUpcoming ? state.bookings : PAST_BOOKINGS;

  const tabStyle = (active: boolean) => ({
    padding: '8px 16px',
    background: active ? color.ink : color.surfaceSand,
    color: active ? '#fff' : color.inkSoft,
    border: `1px solid ${active ? color.ink : color.lineSand}`,
    borderRadius: 20,
    font: `600 12px ${font.sans}`,
  });

  return (
    <Screen bottomInset={88}>
      <div style={{ padding: '56px 24px 0' }}>
        <h1 style={{ font: `600 28px ${font.serif}`, margin: 0 }}>{t.myBookings}</h1>
        <div lang="ar" style={{ font: `700 16px ${font.arabicDisplay}`, color: color.goldLink }}>
          حجوزاتي
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '18px 24px 0' }}>
        <button
          type="button"
          onClick={() => dispatch({ type: 'setBookTab', tab: 'upcoming' })}
          aria-pressed={showingUpcoming}
          className="press"
          style={tabStyle(showingUpcoming)}
        >
          {t.upcoming}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'setBookTab', tab: 'past' })}
          aria-pressed={!showingUpcoming}
          className="press"
          style={tabStyle(!showingUpcoming)}
        >
          {t.past}
        </button>
      </div>

      <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((booking, index) => (
          <article
            key={`${booking.salon}-${booking.when}-${index}`}
            style={{
              border: `1px solid ${color.lineWarm}`,
              borderRadius: 18,
              overflow: 'hidden',
              background: color.surface,
              boxShadow: '0 6px 18px -14px rgba(60,50,20,.4)',
            }}
          >
            <div style={{ display: 'flex', gap: 13, padding: 14 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 14,
                  background: booking.tile,
                  flex: 'none',
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: `600 15px ${font.serif}` }}>
                    {isArabic ? booking.salonAr : booking.salon}
                  </span>
                  <span
                    style={{
                      font: `600 10px ${font.sans}`,
                      color: color.goldInkAlt,
                      background: color.gold,
                      padding: '3px 8px',
                      borderRadius: 8,
                      height: 'fit-content',
                    }}
                  >
                    {translateStatus(booking.status, state.lang)}
                  </span>
                </div>
                <div
                  style={{
                    font: `500 11px ${font.sans}`,
                    color: color.mutedSoft,
                    margin: '3px 0 6px',
                  }}
                >
                  {isArabic ? booking.servicesAr : booking.services}
                </div>
                <div style={{ font: `600 11.5px ${font.sans}`, color: color.ink }}>
                  {booking.when} · {isArabic ? booking.staffAr : booking.staff}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', borderTop: `1px solid ${color.lineFaint}` }}>
              <button
                type="button"
                onClick={() => {
                  const match =
                    SALONS.find(
                      (candidate) =>
                        candidate.name === booking.salon || candidate.ar === booking.salon,
                    ) ?? currentSalon;
                  dispatch({ type: 'startReschedule', salonId: match.id });
                  flash(isArabic ? 'إعادة الجدولة — اختر وقتاً' : 'Rescheduling — pick a time');
                }}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: 12,
                  font: `600 12px ${font.sans}`,
                  color: color.ink,
                  borderInlineEnd: `1px solid ${color.lineFaint}`,
                }}
              >
                {t.reschedule}
              </button>
              <button
                type="button"
                onClick={() => flash(t.openingMaps)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: 12,
                  font: `600 12px ${font.sans}`,
                  color: color.goldLink,
                }}
              >
                {t.directions}
              </button>
            </div>
          </article>
        ))}
      </div>
    </Screen>
  );
}
