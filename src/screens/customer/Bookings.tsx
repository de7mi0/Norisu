import { Screen } from '../../components/Screen';
import { translateStatus } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** The customer's upcoming and past appointments. */
export function Bookings() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    flash,
    salons,
    salon: currentSalon,
    upcomingBookings,
    pastBookings,
    bookingsPersisted,
    bookingsLoading,
    session,
    cancelBooking,
  } = useApp();

  const showingUpcoming = state.bookTab === 'upcoming';
  const list = showingUpcoming ? upcomingBookings : pastBookings;

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

      {/* Bookings only persist for a signed-in customer, so say so here rather
          than letting somebody book and quietly lose it. */}
      {!bookingsPersisted && session.status !== 'unavailable' ? (
        <button
          type="button"
          onClick={() => dispatch({ type: 'openAuth' })}
          className="press"
          style={{
            display: 'block',
            width: 'calc(100% - 48px)',
            margin: '18px 24px 0',
            textAlign: 'start',
            background: color.cream,
            border: `1px solid ${color.creamLine}`,
            borderRadius: 14,
            padding: '12px 14px',
          }}
        >
          <span style={{ display: 'block', font: `600 12.5px ${font.sans}`, color: '#8a6d14' }}>
            {t.bookSignInTitle}
          </span>
          <span
            style={{
              display: 'block',
              font: `500 11px ${font.sans}`,
              color: color.mutedSoft,
              marginTop: 2,
            }}
          >
            {t.bookSignInSub}
          </span>
        </button>
      ) : null}

      <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {bookingsLoading && list.length === 0 ? (
          <p style={{ font: `500 13px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.bookLoading}
          </p>
        ) : null}

        {!bookingsLoading && list.length === 0 ? (
          <div
            style={{
              border: `1.5px dashed ${color.lineDashed}`,
              borderRadius: 18,
              padding: '30px 22px',
              textAlign: 'center',
            }}
          >
            <div style={{ font: `600 15px ${font.serif}`, color: color.ink }}>
              {showingUpcoming ? t.bookNoneUpcoming : t.bookNonePast}
            </div>
            <div
              style={{
                font: `500 12px ${font.sans}`,
                color: color.mutedSoft,
                marginTop: 6,
              }}
            >
              {showingUpcoming ? t.bookNoneUpcomingSub : t.bookNonePastSub}
            </div>
            {showingUpcoming ? (
              <button
                type="button"
                onClick={() => dispatch({ type: 'go', screen: 'home' })}
                className="press"
                style={{
                  marginTop: 16,
                  padding: '11px 22px',
                  borderRadius: 12,
                  background: color.gold,
                  color: color.goldInk,
                  font: `700 12.5px ${font.sans}`,
                }}
              >
                {t.bookFindSalon}
              </button>
            ) : null}
          </div>
        ) : null}

        {list.map((booking, index) => (
          <article
            key={booking.id ?? `${booking.salon}-${booking.when}-${index}`}
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
                      color: booking.status === 'CANCELLED' ? color.muted : color.goldInkAlt,
                      background:
                        booking.status === 'CANCELLED' ? color.surfaceSand : color.gold,
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
            {/* Cancelling is destructive and irreversible, so it asks first. */}
            {state.cancelingId === booking.id ? (
              <div style={{ borderTop: `1px solid ${color.lineFaint}`, padding: '12px 14px' }}>
                <div
                  style={{
                    font: `600 12px ${font.sans}`,
                    color: color.ink,
                    marginBottom: 10,
                  }}
                >
                  {t.bookCancelAsk}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'dismissCancel' })}
                    className="press"
                    style={{
                      flex: 1,
                      padding: 11,
                      borderRadius: 11,
                      border: `1.5px solid ${color.lineSand}`,
                      font: `600 12px ${font.sans}`,
                      color: color.ink,
                    }}
                  >
                    {t.bookCancelKeep}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelBooking(booking.id ?? '')}
                    className="press"
                    style={{
                      flex: 1,
                      padding: 11,
                      borderRadius: 11,
                      background: color.danger,
                      color: '#fff',
                      font: `700 12px ${font.sans}`,
                    }}
                  >
                    {t.bookCancelYes}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', borderTop: `1px solid ${color.lineFaint}` }}>
                <button
                  type="button"
                  onClick={() => {
                    // Saved bookings carry their salon id; demo ones only have a
                    // name, so fall back to matching on that.
                    const match =
                      booking.salonId ??
                      (salons.find(
                        (candidate) =>
                          candidate.name === booking.salon || candidate.ar === booking.salonAr,
                      ) ?? currentSalon).id;
                    dispatch({
                      type: 'startReschedule',
                      salonId: match,
                      bookingId: booking.id ?? '',
                    });
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
                {/* Only a saved, still-upcoming booking can be cancelled. */}
                {booking.id && showingUpcoming ? (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'askCancel', bookingId: booking.id ?? '' })}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: 12,
                      font: `600 12px ${font.sans}`,
                      color: color.danger,
                      borderInlineEnd: `1px solid ${color.lineFaint}`,
                    }}
                  >
                    {t.bookCancel}
                  </button>
                ) : null}
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
            )}
          </article>
        ))}
      </div>
    </Screen>
  );
}
