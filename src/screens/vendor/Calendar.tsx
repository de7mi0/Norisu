import { Screen } from '../../components/Screen';
import { VENDOR_APPOINTMENTS, VENDOR_DAYS } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Vendor day view: a week strip and that day's appointments. */
export function Calendar() {
  const { t, state, dispatch, isArabic } = useApp();

  const day = VENDOR_DAYS[state.vDay];
  const month = isArabic ? 'يوليو' : 'Jul';
  const weekday = isArabic ? '' : `${day.dow.charAt(0)}${day.dow.slice(1).toLowerCase()}, `;
  const dayLabel = `${weekday}${month} ${day.num}`;

  return (
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
        <div
          style={{
            font: `600 11px ${font.sans}`,
            color: color.goldLink,
            background: color.cream,
            border: `1px solid ${color.creamLine}`,
            padding: '6px 12px',
            borderRadius: 20,
          }}
        >
          {t.add}
        </div>
      </div>

      <div
        className="scr hscroll"
        style={{ display: 'flex', gap: 8, padding: '18px 24px 0', overflowX: 'auto' }}
      >
        {VENDOR_DAYS.map((vendorDay, index) => {
          const active = state.vDay === index;
          return (
            <button
              key={vendorDay.dow}
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
                {vendorDay.dow}
              </span>
              <span style={{ display: 'block', font: `700 16px ${font.sans}`, marginTop: 3 }}>
                {vendorDay.num}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '20px 24px 0', font: `600 14px ${font.sans}`, color: color.ink }}>
        {dayLabel}
      </div>

      <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {VENDOR_APPOINTMENTS.map((appointment) => (
          <div key={`${appointment.time}-${appointment.client}`} style={{ display: 'flex', gap: 12 }}>
            <div
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
              <div style={{ font: `500 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 4 }}>
                {isArabic ? appointment.arStaff : appointment.staff} ·{' '}
                {isArabic ? appointment.arStatus : appointment.status}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}
