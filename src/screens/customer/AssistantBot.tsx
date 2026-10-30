import { Composer, MessageList, type Bubble } from '../../components/Conversation';
import { MESSAGE_MAX_LENGTH } from '../../data/conversations';
import { CHIPS } from '../../state/assistant';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * The Saloni Assistant. Answers from a written guide in both languages
 * (state/assistant.ts) — nothing typed here leaves the device — and when it
 * cannot help, opens a real conversation with the salon or with Saloni's team.
 * What it never does is say it passed something on when it did not.
 */
export function AssistantBot() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    sendBot,
    pickBotTopic,
    runBotAction,
    unreadMessages,
    session,
  } = useApp();
  const lang = isArabic ? 'ar' : 'en';

  const bubbles: Bubble[] = state.botMsgs.map((message, index) => ({
    key: String(index),
    text: message.text ?? message.say?.[lang] ?? '',
    mine: message.who === 'me',
    after:
      message.actions && message.actions.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {message.actions.map((action, n) => (
            <button
              key={n}
              type="button"
              onClick={() => runBotAction(action)}
              className="press"
              style={{
                padding: '7px 12px',
                borderRadius: 16,
                background: action.kind === 'reach' || action.kind === 'handoff' ? color.ink : color.surface,
                color: action.kind === 'reach' || action.kind === 'handoff' ? color.goldSoft : color.goldLink,
                border: `1px solid ${color.creamLine}`,
                font: `600 11.5px ${font.sans}`,
              }}
            >
              {action.label[lang]}
            </button>
          ))}
        </div>
      ) : undefined,
  }));

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
          background: 'linear-gradient(135deg,#1c1913,#2a2413)',
          color: color.page,
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
            background: 'rgba(255,255,255,.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
          }}
        >
          {backIcon}
        </button>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            flex: 'none',
            borderRadius: '50%',
            background: color.gold,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
          }}
        >
          🤖
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `600 16px ${font.serif}` }}>{t.assistantName}</div>
          <div style={{ font: `500 10px ${font.sans}`, color: '#a89e86' }}>{t.assistantSub}</div>
        </div>
        {session.status === 'signedIn' ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'openConversation', target: 'inbox', from: 'bot' })}
            className="press"
            style={{
              flex: 'none',
              position: 'relative',
              padding: '7px 11px',
              borderRadius: 12,
              background: 'rgba(255,255,255,.1)',
              color: color.page,
              font: `600 11px ${font.sans}`,
            }}
          >
            {t.msgInboxTitle}
            {unreadMessages > 0 ? (
              <span
                aria-label={`${unreadMessages} ${t.msgUnread}`}
                style={{
                  marginInlineStart: 6,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: color.gold,
                  color: color.goldInk,
                  font: `700 10px ${font.sans}`,
                }}
              >
                {unreadMessages}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      <MessageList bubbles={bubbles} incoming={{ bg: color.cream, fg: color.goldInkAlt }} />

      <div
        className="scr hscroll"
        style={{ display: 'flex', gap: 8, padding: '0 16px 10px', overflowX: 'auto' }}
      >
        {CHIPS.map((topic) => (
          <button
            key={topic.key}
            type="button"
            onClick={() => pickBotTopic(topic.key)}
            className="press"
            style={{
              whiteSpace: 'nowrap',
              padding: '8px 14px',
              borderRadius: 18,
              background: color.cream,
              border: `1px solid ${color.creamLine}`,
              color: '#8a6d14',
              font: `600 11.5px ${font.sans}`,
            }}
          >
            {isArabic ? topic.label.ar : topic.label.en}
          </button>
        ))}
      </div>

      <Composer
        value={state.botInput}
        onChange={(value) => dispatch({ type: 'setBotInput', value })}
        onSend={sendBot}
        placeholder={t.typeMessage}
        sendLabel={isArabic ? 'إرسال' : 'Send'}
        sendStyle={{ background: color.ink, color: color.goldSoft }}
        style={{ padding: '6px 16px 22px' }}
        maxLength={MESSAGE_MAX_LENGTH}
      />
    </div>
  );
}
