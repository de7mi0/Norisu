import { BottomBar, Screen, ScreenHeader } from '../../components/Screen';
import { localizeUnits } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Step 1 of the booking flow: pick the specialist. */
export function StaffPicker() {
  const { t, state, dispatch, isArabic, backIcon, salon, salonStaff } = useApp();
  const chosen = state.staffId != null;

  return (
    <Screen bottomInset={96}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'back' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.chooseSpecialist}
        subtitle={`${t.step1} · ${isArabic ? salon.ar : salon.name}`}
      />

      <div style={{ padding: '22px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {salonStaff.map((person) => {
          const active = state.staffId === person.id;
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => dispatch({ type: 'pickStaff', staffId: person.id })}
              aria-pressed={active}
              className="press"
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                background: active ? color.cream : color.surface,
                border: `1.5px solid ${active ? color.gold : color.lineWarm}`,
                borderRadius: 18,
                padding: 14,
                textAlign: 'start',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  flex: 'none',
                  background: person.tile,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: `700 18px ${font.serif}`,
                  color: '#8a7a4e',
                }}
              >
                {person.initials}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', font: `600 15.5px ${font.sans}` }}>
                  {isArabic ? person.arName : person.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    font: `500 11px ${font.sans}`,
                    color: color.mutedSoft,
                    marginTop: 2,
                  }}
                >
                  {isArabic ? person.arRole : person.role}
                </span>
                {person.rating != null ? (
                  <span
                    style={{
                      display: 'block',
                      font: `600 11px ${font.sans}`,
                      color: color.goldDeep,
                      marginTop: 4,
                    }}
                  >
                    ★ {person.rating} · {localizeUnits(person.years, state.lang)}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  flex: 'none',
                  border: `1.5px solid ${active ? color.gold : '#d8d2c6'}`,
                  background: active ? color.gold : color.surface,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: color.goldInk,
                  fontSize: 13,
                }}
              >
                {active ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      <BottomBar>
        <button
          type="button"
          onClick={() => chosen && dispatch({ type: 'go', screen: 'time' })}
          disabled={!chosen}
          className="press"
          style={{
            width: '100%',
            textAlign: 'center',
            background: chosen ? color.gold : '#f0ece2',
            color: chosen ? color.goldInk : '#b8b2a5',
            borderRadius: 15,
            padding: 16,
            font: `700 14px ${font.sans}`,
            cursor: chosen ? 'pointer' : 'not-allowed',
          }}
        >
          {t.pickTime}
        </button>
      </BottomBar>
    </Screen>
  );
}
