import type { ReactNode } from 'react';
import { MESSAGE_MAX_LENGTH } from '../data/conversations';
import { instantLabel } from '../i18n';
import { useApp } from '../state/context';
import { color, font } from '../theme';
import { Composer, MessageList, type Bubble } from './Conversation';

interface ThreadViewProps {
  title: string;
  subtitle: string;
  avatar: ReactNode;
  /** Shown above an empty conversation: who reads this, and how they answer. */
  intro: string;
}

/**
 * One conversation between a customer and a salon or Saloni, from whichever
 * side is reading. The same screen serves all three modes, because the
 * database already decides which messages are "mine" — nothing here needs to
 * know whose side it is on.
 */
export function ThreadView({ title, subtitle, avatar, intro }: ThreadViewProps) {
  const { t, state, dispatch, isArabic, backIcon, thread, sendThreadMessage, session } = useApp();
  const current = state.thread;
  const started = Boolean(current?.conversationId);
  const signedIn = session.status === 'signedIn';

  const bubbles: Bubble[] = thread.messages.map((message) => ({
    key: message.id,
    text: message.body,
    mine: message.mine,
    meta: instantLabel(message.at, state.lang),
  }));

  // What sits above the messages. Never an empty pane that could mean
  // "nothing has been said" or "we could not ask": those read the same and
  // are not.
  let notice: string | null = null;
  if (!started) notice = signedIn ? intro : `${intro} ${t.msgSignInFirst}`;
  else if (thread.source === 'loading') notice = t.msgLoading;
  else if (thread.source === 'error') notice = t.msgLoadFailed;

  const canWrite = current?.canReply !== false;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: color.page,
      }}
    >
      <div
        style={{
          padding: '52px 20px 14px',
          background: color.surface,
          borderBottom: `1px solid ${color.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => dispatch({ type: 'back' })}
          aria-label={isArabic ? 'رجوع' : 'Back'}
          className="press"
          style={{
            width: 36,
            height: 36,
            flex: 'none',
            borderRadius: '50%',
            background: color.surfaceSand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
          }}
        >
          {backIcon}
        </button>
        {avatar}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              font: `600 15px ${font.serif}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft }}>{subtitle}</div>
        </div>
      </div>

      <MessageList
        bubbles={bubbles}
        incoming={{ bg: color.surfaceSand, fg: color.ink }}
        header={
          notice ? (
            <p
              style={{
                margin: '0 0 6px',
                padding: '12px 14px',
                borderRadius: 14,
                background: thread.source === 'error' && started ? '#fdeceb' : color.surfaceWarm,
                border: `1px solid ${color.lineWarm}`,
                font: `500 12px/1.55 ${font.sans}`,
                color: thread.source === 'error' && started ? color.danger : color.inkSoft,
              }}
            >
              {notice}
            </p>
          ) : null
        }
      />

      {canWrite ? (
        <Composer
          value={state.threadInput}
          onChange={(value) => dispatch({ type: 'setThreadInput', value })}
          onSend={() => void sendThreadMessage()}
          placeholder={t.typeMessage}
          sendLabel={isArabic ? 'إرسال' : 'Send'}
          sendStyle={{ background: color.gold, color: color.goldInk }}
          disabled={state.threadSending}
          maxLength={MESSAGE_MAX_LENGTH}
        />
      ) : (
        <p
          style={{
            margin: 0,
            padding: '16px 20px 26px',
            background: color.surface,
            borderTop: `1px solid ${color.line}`,
            font: `500 12px/1.5 ${font.sans}`,
            color: color.mutedSoft,
            textAlign: 'center',
          }}
        >
          {t.msgClosedSalon}
        </p>
      )}
    </div>
  );
}

/** The round initial used where a conversation has no photograph. */
export function Initial({ text, dark = false }: { text: string; dark?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 40,
        height: 40,
        flex: 'none',
        borderRadius: '50%',
        background: dark ? color.ink : color.cream,
        color: dark ? color.goldSoft : '#8a6d14',
        border: dark ? 'none' : `1px solid ${color.creamLine}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `700 15px ${font.sans}`,
      }}
    >
      {text}
    </div>
  );
}
