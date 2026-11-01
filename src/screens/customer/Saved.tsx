import { Photo } from '../../components/Photo';
import { Screen, ScreenHeader } from '../../components/Screen';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * The salons this account saved with the heart on a salon's page (0027).
 * Newest first. A salon that has since left the catalogue is not listed: it
 * cannot be booked, and showing it would be a door that does not open.
 */
export function Saved() {
  const { t, dispatch, isArabic, backIcon, chevron, salons, savedIds, toggleSave, session } = useApp();
  const list = savedIds
    .map((id) => salons.find((salon) => salon.id === id))
    .filter((salon): salon is NonNullable<typeof salon> => Boolean(salon));

  return (
    <Screen bottomInset={90}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'back' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.savedTitle}
        subtitle={t.savedSub}
      />
      <div style={{ padding: '18px 24px 28px' }}>
        {session.status !== 'signedIn' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.muted, margin: 0 }}>{t.authWhySave}</p>
        ) : list.length === 0 ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.muted, margin: 0 }}>{t.savedEmpty}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {list.map((salon) => (
              <li key={salon.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'openSalon', salonId: salon.id })}
                  className="press"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    borderRadius: 16,
                    background: color.surface,
                    border: `1px solid ${color.line}`,
                    textAlign: 'start',
                  }}
                >
                  <Photo
                    src={salon.photo}
                    tile={salon.tile}
                    style={{ width: 56, height: 56, flex: 'none', borderRadius: 12 }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: `600 14px ${font.serif}`, color: color.ink }}>
                      {isArabic ? salon.ar : salon.name}
                    </span>
                    <span style={{ display: 'block', font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
                      {isArabic ? salon.arArea : salon.area}
                    </span>
                  </span>
                  <span aria-hidden="true" style={{ color: color.mutedFaint }}>
                    {chevron}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSave(salon.id)}
                  aria-label={`${t.savedRemove}: ${isArabic ? salon.ar : salon.name}`}
                  className="press"
                  style={{
                    flex: 'none',
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: color.surfaceSand,
                    color: color.danger,
                    fontSize: 16,
                  }}
                >
                  ♥
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}
