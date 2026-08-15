import { Screen } from '../../components/Screen';
import { PROFILE_ROWS } from '../../data/reviews';
import { useApp } from '../../state/context';
import { accountInitials, accountLabel, accountName } from '../../state/account';
import { color, font } from '../../theme';

const ROLE_KEYS = {
  customer: 'authRoleCustomer',
  vendor: 'authRoleVendor',
  admin: 'authRoleAdmin',
} as const;

/** Customer account screen, including the language switch and vendor hand-off. */
export function Profile() {
  const { t, dispatch, isArabic, chevron, session, signOut } = useApp();

  const signedIn = session.status === 'signedIn';
  // Before auth this screen showed a made-up persona. A guest is now told they
  // are a guest, which is both true and the reason to sign in.
  const name = signedIn ? accountName(session, isArabic) : t.authGuest;
  const subtitle = signedIn ? accountLabel(session, isArabic) : t.authGuestSub;
  const initials = signedIn ? accountInitials(session) : '✦';
  const role = session.profile ? t[ROLE_KEYS[session.profile.role]] : null;

  return (
    <Screen bottomInset={88}>
      <div style={{ padding: '56px 24px 0', display: 'flex', gap: 14, alignItems: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            flex: 'none',
            borderRadius: '50%',
            background: 'repeating-linear-gradient(135deg,#efe9dd 0 8px,#e7e0d2 8px 16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: `700 22px ${font.serif}`,
            color: '#8a7a4e',
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ font: `600 22px ${font.serif}`, margin: 0 }}>{name}</h1>
          <div
            className={signedIn ? 'ltr-run' : undefined}
            style={{
              font: `500 12px ${font.sans}`,
              color: color.mutedSoft,
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </div>
          {role ? (
            <div
              style={{
                display: 'inline-block',
                marginTop: 5,
                padding: '2px 9px',
                borderRadius: 20,
                background: color.cream,
                border: `1px solid ${color.creamLine}`,
                font: `600 10px ${font.sans}`,
                color: color.goldLink,
              }}
            >
              {role}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {PROFILE_ROWS.map((row) => {
          const isLanguage = row.label === 'Language';
          const isHelp = row.label === 'Help & support';
          // The rest of these rows are still demo values; this one is real now,
          // so it shows the account rather than the persona it used to.
          const isDetails = row.label === 'Personal details';
          const value = isDetails
            ? signedIn
              ? name
              : '—'
            : isArabic
              ? row.arValue
              : row.value;
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
                {value} {chevron}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => (signedIn ? signOut() : dispatch({ type: 'openAuth' }))}
        className="press"
        style={{
          display: 'block',
          width: 'calc(100% - 48px)',
          margin: '24px 24px 0',
          textAlign: 'center',
          padding: 14,
          borderRadius: 14,
          ...(signedIn
            ? {
                border: `1.5px solid ${color.lineSand}`,
                font: `600 13px ${font.sans}`,
                color: color.danger,
              }
            : {
                background: color.gold,
                font: `700 13px ${font.sans}`,
                color: color.goldInk,
              }),
        }}
      >
        {signedIn ? t.authSignOut : t.authSignIn}
      </button>

      <button
        type="button"
        onClick={() => dispatch({ type: 'pickMode', mode: 'vendor' })}
        className="press"
        style={{
          display: 'block',
          width: 'calc(100% - 48px)',
          margin: '10px 24px 0',
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
