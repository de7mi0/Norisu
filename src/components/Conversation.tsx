import { useEffect, useId, useRef, type ReactNode } from 'react';
import { color, font } from '../theme';
import { SendIcon } from './icons';

/** One message on screen. `text` is always rendered as plain text. */
export interface Bubble {
  key: string;
  text: string;
  mine: boolean;
  /** A small line under the bubble — when it was sent. */
  meta?: string;
  /** Rendered under the bubble: the assistant's buttons. */
  after?: ReactNode;
}

interface MessageListProps {
  bubbles: Bubble[];
  /** Bubble colours for messages that did not come from the reader. */
  incoming: { bg: string; fg: string };
  /** Shown above the messages — an introduction, or why there are none. */
  header?: ReactNode;
}

/** Renders chat bubbles; message text is always rendered as plain text. */
export function MessageList({ bubbles, incoming, header }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = bubbles[bubbles.length - 1]?.key;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [bubbles.length, last]);

  return (
    <div
      className="scr"
      // A live region, so a reply arriving is announced to somebody who
      // cannot see it land.
      aria-live="polite"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {header}
      {bubbles.map((bubble) => (
        <div
          key={bubble.key}
          style={{
            alignSelf: bubble.mine ? 'flex-end' : 'flex-start',
            maxWidth: '82%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: bubble.mine ? 'flex-end' : 'flex-start',
            gap: 6,
          }}
        >
          <div
            style={{
              background: bubble.mine ? color.ink : incoming.bg,
              color: bubble.mine ? color.goldSoft : incoming.fg,
              borderRadius: 16,
              padding: '10px 13px',
              font: `500 12.5px/1.5 ${font.sans}`,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {bubble.text}
          </div>
          {bubble.meta ? (
            <div style={{ font: `500 9.5px ${font.sans}`, color: color.mutedFaint, padding: '0 4px' }}>
              {bubble.meta}
            </div>
          ) : null}
          {bubble.after}
        </div>
      ))}
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
  /** While a message is on its way, so a double tap does not send it twice. */
  disabled?: boolean;
  maxLength?: number;
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
  disabled = false,
  maxLength,
}: ComposerProps) {
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSend();
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
        maxLength={maxLength}
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
        disabled={disabled}
        className="press"
        style={{
          width: 42,
          height: 42,
          flex: 'none',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
          ...sendStyle,
        }}
      >
        <SendIcon />
      </button>
    </form>
  );
}
