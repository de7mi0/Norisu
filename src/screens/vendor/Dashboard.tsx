import { Screen } from '../../components/Screen';
import { VENDOR_APPOINTMENTS, VENDOR_NAME, VENDOR_STATS } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Vendor home: today's key numbers and schedule. */
export function Dashboard() {
  const { t, dispatch, isArabic } = useApp();

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
            <div style={{ font: `600 24px ${font.serif}`, marginTop: 2 }}>{VENDOR_NAME}</div>
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
          {VENDOR_STATS.map((stat) => (
            <div
              key={stat.label}
              style={{
                background: 'rgba(255,255,255,.06)',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 16,
                padding: 14,
              }}
            >
              <div style={{ font: `700 24px ${font.sans}`, color: stat.accent }}>{stat.value}</div>
              <div style={{ font: `600 11px ${font.sans}`, color: '#ece7dd', marginTop: 2 }}>
                {isArabic ? stat.arLabel : stat.label}
              </div>
              <div style={{ font: `500 10px ${font.sans}`, color: '#8a8272', marginTop: 1 }}>
                {isArabic ? stat.arSub : stat.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

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
        {VENDOR_APPOINTMENTS.map((appointment) => (
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
              <div style={{ font: `700 13px ${font.sans}`, color: color.ink }}>
                {appointment.time}
              </div>
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
        ))}
      </div>
    </Screen>
  );
}
