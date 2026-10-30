import { instantLabel } from '../i18n';
import { useApp } from '../state/context';
import { color, font } from '../theme';
import { Screen, ScreenHeader } from './Screen';
import { Initial } from './ThreadView';

interface InboxListProps {
  title: string;
  subtitle: string;
  /** Said when the list is genuinely empty — never when it failed to load. */
  empty: string;
  /** Said when there is nothing to ask: signed out, or no salon to answer for. */
  unavailable: string;
}

/** A list of conversations, newest first, unread ones marked. Any mode. */
export function InboxList({ title, subtitle, empty, unavailable }: InboxListProps) {
  const { t, state, dispatch, isArabic, backIcon, chevron, inbox, openInboxThread } = useApp();

  return (
    <Screen>
      <ScreenHeader
        onBack={() => dispatch({ type: 'back' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={title}
        subtitle={subtitle}
      />
      <div style={{ padding: '18px 24px 28px' }}>
        {inbox.source === 'loading' ? (
          <p style={{ font: `500 13px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.msgLoading}
          </p>
        ) : inbox.source === 'error' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.danger, margin: 0 }}>
            {t.msgInboxFailed}
          </p>
        ) : inbox.source === 'demo' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {unavailable}
          </p>
        ) : inbox.items.length === 0 ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {empty}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {inbox.items.map((item) => {
              const name = isArabic ? item.nameAr : item.name;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openInboxThread(item.id)}
                    className="press"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 16,
                      background: item.unread ? color.cream : color.surface,
                      border: `1px solid ${item.unread ? color.creamLine : color.line}`,
                      textAlign: 'start',
                    }}
                  >
                    <Initial text={(name.trim()[0] ?? '·').toUpperCase()} dark={!item.salonId && state.mode === 'customer'} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          font: `${item.unread ? 700 : 600} 13.5px ${font.sans}`,
                          color: color.ink,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </span>
                        <span style={{ flex: 'none', font: `500 10px ${font.sans}`, color: color.mutedFaint }}>
                          {instantLabel(item.lastAt, state.lang)}
                        </span>
                      </span>
                      <span
                        style={{
                          display: 'block',
                          marginTop: 3,
                          font: `500 12px ${font.sans}`,
                          color: item.unread ? color.inkSoft : color.mutedSoft,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.lastMine ? `${t.msgYou}: ` : ''}
                        {item.lastBody}
                      </span>
                    </span>
                    {item.unread ? (
                      <span
                        aria-label={t.msgUnread}
                        style={{ width: 9, height: 9, flex: 'none', borderRadius: '50%', background: color.goldDeep }}
                      />
                    ) : (
                      <span aria-hidden="true" style={{ color: color.mutedFaint }}>
                        {chevron}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Screen>
  );
}
