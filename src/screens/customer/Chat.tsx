import { Composer, MessageList } from '../../components/Conversation';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Direct conversation with the salon (replies are simulated). */
export function Chat() {
  const { t, state, dispatch, isArabic, backIcon, salon, sendChat } = useApp();

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
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            flex: 'none',
            borderRadius: '50%',
            background: salon.tile,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `600 15px ${font.serif}` }}>{isArabic ? salon.ar : salon.name}</div>
          <div style={{ font: `500 10px ${font.sans}`, color: color.success }}>
            ● {t.repliesFast}
          </div>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'go', screen: 'bot' })}
          style={{
            font: `600 10px ${font.sans}`,
            color: color.goldLink,
            textAlign: 'center',
            lineHeight: 1.3,
          }}
        >
          <span aria-hidden="true">🤖</span>
          <br />
          {t.assistant}
        </button>
      </div>

      <MessageList
        messages={state.chatMsgs}
        lang={state.lang}
        incoming={{ bg: color.surfaceSand, fg: color.ink }}
      />

      <Composer
        value={state.chatInput}
        onChange={(value) => dispatch({ type: 'setChatInput', value })}
        onSend={sendChat}
        placeholder={t.typeMessage}
        sendLabel={isArabic ? 'إرسال' : 'Send'}
        sendStyle={{ background: color.gold, color: color.goldInk }}
      />
    </div>
  );
}
