import { Composer, MessageList } from '../../components/Conversation';
import { BOT_TOPICS } from '../../state/replies';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * The Saloni Assistant: scripted support responses for bookings, issues and
 * feedback. Replies come from a local script — nothing leaves the device.
 */
export function AssistantBot() {
  const { t, state, dispatch, isArabic, backIcon, sendBot, pickBotTopic } = useApp();

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
      </div>

      <MessageList
        messages={state.botMsgs}
        lang={state.lang}
        incoming={{ bg: color.cream, fg: color.goldInkAlt }}
      />

      <div
        className="scr hscroll"
        style={{ display: 'flex', gap: 8, padding: '0 16px 10px', overflowX: 'auto' }}
      >
        {BOT_TOPICS.map((topic) => (
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
      />
    </div>
  );
}
