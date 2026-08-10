import { color, font } from '../theme';

/** Transient confirmation pill shown above the tab bar. */
export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        bottom: 92,
        left: '50%',
        transform: 'translateX(-50%)',
        background: color.ink,
        color: color.goldSoft,
        font: `600 12px ${font.sans}`,
        padding: '10px 18px',
        borderRadius: 14,
        zIndex: 80,
        boxShadow: '0 12px 28px -10px rgba(0,0,0,.5)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
