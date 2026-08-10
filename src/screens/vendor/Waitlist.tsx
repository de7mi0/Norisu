import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_WAITLIST } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Waitlist settings and the customers currently queued. */
export function Waitlist() {
  const { t, state, dispatch, isArabic, backIcon, flash } = useApp();

  const on = state.waitlistOn;

  return (
    <Screen bottomInset={88}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.waitlistTitle}
      />

      <div
        style={{
          margin: '18px 24px 0',
          background: color.surface,
          border: `1px solid ${color.lineWarm}`,
          borderRadius: 16,
          padding: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 14,
          boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 14px ${font.sans}` }}>{t.enableWaitlist}</div>
          <div
            style={{
              font: `500 10.5px/1.4 ${font.sans}`,
              color: color.mutedSoft,
              marginTop: 3,
            }}
          >
            {t.enableWaitlistSub}
          </div>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'toggleWaitlistAcceptance' })}
          role="switch"
          aria-checked={on}
          aria-label={t.enableWaitlist}
          style={{
            width: 46,
            height: 26,
            flex: 'none',
            borderRadius: 14,
            background: on ? color.tealBright : '#e2ddd2',
            position: 'relative',
            transition: 'background .2s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              insetInlineStart: on ? 23 : 3,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,.3)',
              transition: 'inset-inline-start .2s',
            }}
          />
        </button>
      </div>

      {on ? (
        <>
          <div
            style={{
              padding: '22px 24px 0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ font: `600 15px ${font.sans}` }}>{t.waiting}</span>
            <span style={{ font: `600 11px ${font.sans}`, color: color.goldLink }}>
              {isArabic
                ? `${VENDOR_WAITLIST.length} في الانتظار`
                : `${VENDOR_WAITLIST.length} waiting`}
            </span>
          </div>

          <div
            style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {VENDOR_WAITLIST.map((entry) => (
              <div
                key={entry.name}
                style={{
                  background: color.surface,
                  border: `1px solid ${color.lineWarm}`,
                  borderRadius: 16,
                  padding: 14,
                  boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      flex: 'none',
                      background:
                        'repeating-linear-gradient(135deg,#efe9dd 0 7px,#e7e0d2 7px 14px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      font: `700 13px ${font.sans}`,
                      color: '#8a7a4e',
                    }}
                  >
                    {entry.initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: `600 14px ${font.sans}` }}>
                      {isArabic ? entry.arName : entry.name}
                    </div>
                    <div
                      style={{
                        font: `500 10.5px ${font.sans}`,
                        color: color.mutedSoft,
                        marginTop: 2,
                      }}
                    >
                      {isArabic ? entry.arService : entry.service} ·{' '}
                      {isArabic ? entry.arDate : entry.date}
                    </div>
                    <div
                      style={{
                        font: `500 10px ${font.sans}`,
                        color: color.mutedFaint,
                        marginTop: 2,
                      }}
                    >
                      {isArabic ? entry.arPref : entry.pref}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      flash(
                        isArabic ? `تم إشعار ${entry.arName} ✓` : `Notified ${entry.name} ✓`,
                      )
                    }
                    className="press"
                    style={{
                      flex: 'none',
                      background: color.gold,
                      color: color.goldInk,
                      borderRadius: 11,
                      padding: '9px 13px',
                      font: `700 11px ${font.sans}`,
                    }}
                  >
                    {t.notify}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p
          style={{
            padding: '44px 34px',
            textAlign: 'center',
            font: `500 12px/1.6 ${font.sans}`,
            color: color.mutedFaint,
            margin: 0,
          }}
        >
          {t.waitlistOffMsg}
        </p>
      )}
    </Screen>
  );
}
