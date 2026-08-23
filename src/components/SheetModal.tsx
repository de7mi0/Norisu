import { useEffect, useId, useRef, type ReactNode } from 'react';
import { color, font } from '../theme';

interface SheetModalProps {
  title: string;
  cancelLabel: string;
  /**
   * Null for a sheet with nothing to submit — a list of actions rather than a
   * form. The footer then holds one full-width dismiss button instead of a
   * pair, because two buttons that both close the sheet reads as a bug.
   */
  saveLabel: string | null;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}

/** Bottom sheet used by the vendor "new service" and "new team member" forms. */
export function SheetModal({
  title,
  cancelLabel,
  saveLabel,
  onCancel,
  onSave,
  children,
}: SheetModalProps) {
  const titleId = useId();
  const sheet = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the sheet so keyboard users land on the first field.
    // `preventScroll` stops the browser scrolling the screen behind the sheet.
    sheet.current?.querySelector('input')?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20,15,3,.45)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <form
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        style={{
          width: '100%',
          background: color.surface,
          borderRadius: '24px 24px 0 0',
          padding: '22px 24px 28px',
          animation: 'slideup .28s ease both',
        }}
      >
        <h2 id={titleId} style={{ font: `600 20px ${font.serif}`, margin: '0 0 16px' }}>
          {title}
        </h2>
        {children}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            className="press"
            style={{
              flex: 1,
              textAlign: 'center',
              padding: 14,
              border: `1.5px solid ${color.lineSand}`,
              borderRadius: 13,
              font: `600 13px ${font.sans}`,
              color: color.mutedSoft,
            }}
          >
            {cancelLabel}
          </button>
          {saveLabel === null ? null : (
            <button
              type="submit"
              className="press"
              style={{
                flex: 1,
                textAlign: 'center',
                padding: 14,
                background: color.gold,
                color: color.goldInk,
                borderRadius: 13,
                font: `700 13px ${font.sans}`,
              }}
            >
              {saveLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

interface SheetFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: 'numeric' | 'text';
  style?: React.CSSProperties;
}

/** Labelled text input styled like the prototype's form fields. */
export function SheetField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  style,
}: SheetFieldProps) {
  const id = useId();
  return (
    <div style={style}>
      {/* The placeholder carries the visible label, as designed; this keeps it announced. */}
      <label htmlFor={id} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        style={{
          width: '100%',
          background: color.surfaceWarm,
          border: `1.5px solid ${color.lineWarm}`,
          borderRadius: 12,
          padding: 13,
          font: `500 14px ${font.sans}`,
          outline: 'none',
        }}
      />
    </div>
  );
}
