import { color, font } from '../theme';

/** Every half hour of the day, which is as fine as any of these choices get. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = `${Math.floor(i / 2)}`.padStart(2, '0');
  return `${hour}:${i % 2 ? '30' : '00'}`;
});

interface TimeSelectProps {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * A plain select, so the phone's own time wheel is used on a real device.
 *
 * `direction: ltr` regardless of language: a time is Latin digits and a colon,
 * and it reorders into nonsense inside an Arabic layout without this — the same
 * reason `.ltr-run` exists in global.css.
 *
 * Shared by the opening-hours screen and the block-out-time sheet. It lived
 * inside Hours.tsx until the second caller appeared.
 */
export function TimeSelect({ label, value, disabled = false, onChange }: TimeSelectProps) {
  return (
    <label style={{ flex: 1 }}>
      <span
        style={{
          display: 'block',
          font: `500 10px ${font.sans}`,
          color: color.mutedFaint,
          marginBottom: 3,
        }}
      >
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: '100%',
          padding: '8px 9px',
          borderRadius: 10,
          border: `1.5px solid ${color.lineWarm}`,
          background: color.surfaceWarm,
          font: `600 12.5px ${font.sans}`,
          color: color.ink,
          direction: 'ltr',
        }}
      >
        {TIMES.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </label>
  );
}
