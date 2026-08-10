import { BottomBar, Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_ONBOARD_FIELDS } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Salon registration: location pin and business details. */
export function Onboarding() {
  const { t, state, dispatch, isArabic, backIcon } = useApp();

  return (
    <Screen bottomInset={100}>
      <ScreenHeader
        onBack={() =>
          dispatch({ type: 'go', screen: state.obBack === 'v_more' ? 'v_more' : 'v_dash' })
        }
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.registerSalon}
      />
      <div lang="ar" style={{ font: `700 15px ${font.arabicDisplay}`, color: color.goldLink, padding: '0 24px 0 76px' }}>
        سجّل صالونك
      </div>

      <p
        style={{
          font: `500 12px/1.5 ${font.sans}`,
          color: color.mutedSoft,
          padding: '10px 24px 0',
          margin: 0,
        }}
      >
        {t.registerDesc}
      </p>

      <div
        style={{
          margin: '16px 24px 0',
          height: 130,
          borderRadius: 18,
          background: 'repeating-linear-gradient(125deg,#eef1ee 0 12px,#e6ebe6 12px 24px)',
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid #e4e8e4',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9aa79a',
            font: `500 10px ${font.mono}`,
            letterSpacing: '.1em',
          }}
        >
          {t.dropPin}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%,-100%) rotate(45deg)',
            width: 22,
            height: 22,
            background: color.gold,
            border: '3px solid #fff',
            borderRadius: '50% 50% 50% 0',
            boxShadow: '0 6px 14px -4px rgba(0,0,0,.4)',
          }}
        />
      </div>

      <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {VENDOR_ONBOARD_FIELDS.map((field) => (
          <div key={field.label}>
            <div
              style={{ font: `600 11px ${font.sans}`, color: color.mutedSoft, marginBottom: 6 }}
            >
              {isArabic ? field.arLabel : field.label}
            </div>
            <div
              style={{
                background: color.surfaceWarm,
                border: `1.5px solid ${color.lineWarm}`,
                borderRadius: 13,
                padding: 14,
                font: `600 13.5px ${font.sans}`,
                color: color.ink,
              }}
            >
              {isArabic ? field.arValue : field.value}
            </div>
          </div>
        ))}
      </div>

      <BottomBar>
        <button
          type="button"
          onClick={() => dispatch({ type: 'go', screen: 'v_dash' })}
          className="press"
          style={{
            width: '100%',
            textAlign: 'center',
            background: color.gold,
            color: color.goldInk,
            borderRadius: 15,
            padding: 16,
            font: `700 14px ${font.sans}`,
            boxShadow: '0 12px 26px -12px rgba(245,197,66,.9)',
          }}
        >
          {t.createSalon}
        </button>
      </BottomBar>
    </Screen>
  );
}
