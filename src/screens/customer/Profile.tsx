import { Screen } from '../../components/Screen';
import { PROFILE_ROWS } from '../../data/reviews';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Customer account screen, including the language switch and vendor hand-off. */
export function Profile() {
  const { t, dispatch, isArabic, chevron } = useApp();

  return (
    <Screen bottomInset={88}>
      <div style={{ padding: '56px 24px 0', display: 'flex', gap: 14, alignItems: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'repeating-linear-gradient(135deg,#efe9dd 0 8px,#e7e0d2 8px 16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: `700 22px ${font.serif}`,
            color: '#8a7a4e',
          }}
        >
          NA
        </div>
        <div>
          <h1 style={{ font: `600 22px ${font.serif}`, margin: 0 }}>{t.userName}</h1>
          <div style={{ font: `500 12px ${font.sans}`, color: color.mutedSoft }}>
            +966 5X XXX XXXX
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {PROFILE_ROWS.map((row) => {
          const isLanguage = row.label === 'Language';
          const isHelp = row.label === 'Help & support';
          return (
            <button
              key={row.label}
              type="button"
              onClick={() => {
                if (isLanguage) {
                  dispatch({ type: 'setLang', lang: isArabic ? 'en' : 'ar' });
                } else if (isHelp) {
                  dispatch({ type: 'openConversation', target: 'bot', from: 'profile' });
                }
              }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '15px 4px',
                borderBottom: `1px solid ${color.lineFaint}`,
              }}
            >
              <span style={{ font: `600 13.5px ${font.sans}`, color: color.ink }}>
                {isArabic ? row.arLabel : row.label}
              </span>
              <span style={{ font: `500 12px ${font.sans}`, color: color.mutedFaint }}>
                {isArabic ? row.arValue : row.value} {chevron}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'pickMode', mode: 'vendor' })}
        className="press"
        style={{
          display: 'block',
          width: 'calc(100% - 48px)',
          margin: '24px 24px 0',
          textAlign: 'center',
          padding: 14,
          border: `1.5px solid ${color.lineSand}`,
          borderRadius: 14,
          font: `600 13px ${font.sans}`,
          color: color.mutedSoft,
        }}
      >
        {t.switchVendor}
      </button>
    </Screen>
  );
}
