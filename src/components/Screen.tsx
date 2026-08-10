import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../theme';

interface ScreenProps {
  /** Space reserved at the bottom for a tab bar or sticky action bar. */
  bottomInset?: number;
  style?: CSSProperties;
  children: ReactNode;
}

/** A full-bleed, vertically scrolling screen inside the phone viewport. */
export function Screen({ bottomInset = 0, style, children }: ScreenProps) {
  return (
    <div
      className="scr"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        paddingBottom: bottomInset,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface ScreenHeaderProps {
  onBack: () => void;
  backIcon: string;
  backLabel: string;
  title: string;
  subtitle?: string;
}

/** The circular back button plus title used across the booking and vendor flows. */
export function ScreenHeader({
  onBack,
  backIcon,
  backLabel,
  title,
  subtitle,
}: ScreenHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '56px 24px 0' }}>
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="press"
        style={{
          width: 38,
          height: 38,
          flex: 'none',
          borderRadius: '50%',
          background: color.surfaceSand,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        {backIcon}
      </button>
      <div>
        <div style={{ font: `600 22px ${font.serif}` }}>{title}</div>
        {subtitle ? (
          <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

/** The white bar pinned to the bottom of a screen, above the tab bar. */
export function BottomBar({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        insetInline: 0,
        background: color.surface,
        borderTop: `1px solid ${color.line}`,
        padding: '14px 24px 22px',
        zIndex: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
