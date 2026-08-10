import { useEffect, useId, useRef } from 'react';
import type { ChatMessage, Lang } from '../types';
import { color, font } from '../theme';
import { SendIcon } from './icons';

interface MessageListProps {
  messages: ChatMessage[];
  lang: Lang;
  /** Bubble colours for messages that did not come from the customer. */
  incoming: { bg: string; fg: string };
}

/** Renders chat bubbles; message text is always rendered as plain text. */
export function MessageList({ messages, lang, incoming }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div
      className="scr"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {messages.map((message, index) => {
        const mine = message.who === 'me';
        const text = message.text ?? (lang === 'ar' ? message.ar : message.en) ?? '';
        return (
          <div
            key={index}
            style={{
              alignSelf: mine ? 'flex-end' : 'flex-start',
              maxWidth: '78%',
              background: mine ? color.ink : incoming.bg,
              color: mine ? color.goldSoft : incoming.fg,
              borderRadius: 16,
              padding: '10px 13px',
              font: `500 12.5px/1.45 ${font.sans}`,
            }}
          >
            {text}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  sendLabel: string;
  /** Send-button colours; the assistant uses the inverse of the salon chat. */
  sendStyle: { background: string; color: string };
  style?: React.CSSProperties;
}

/** Message input plus send button, submitting on Enter. */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  sendLabel,
  sendStyle,
  style,
}: ComposerProps) {
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
      style={{
        padding: '12px 16px 22px',
        background: color.surface,
        borderTop: `1px solid ${color.line}`,
        display: 'flex',
        gap: 9,
        alignItems: 'center',
        ...style,
      }}
    >
      <label htmlFor={id} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {placeholder}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          flex: 1,
          minWidth: 0,
          background: color.surfaceSand,
          border: `1.5px solid ${color.lineSand}`,
          borderRadius: 20,
          padding: '12px 16px',
          font: `500 13px ${font.sans}`,
          outline: 'none',
        }}
      />
      <button
        type="submit"
        aria-label={sendLabel}
        className="press"
        style={{
          width: 42,
          height: 42,
          flex: 'none',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...sendStyle,
        }}
      >
        <SendIcon />
      </button>
    </form>
  );
}
