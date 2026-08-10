import { useApp } from '../state/context';
import { color, font } from '../theme';

/**
 * EN / العربية switch. `variant="dark"` is the borderless version used on the
 * chooser's dark background; `"pill"` is the bordered one on the home header.
 */
export function LangToggle({ variant }: { variant: 'dark' | 'pill' }) {
  const { state, dispatch, isArabic } = useApp();

  const activeStyle = {
    background: color.gold,
    color: color.goldInkAlt,
  };
  const idleStyle = {
    background: 'transparent',
    color: variant === 'dark' ? color.muted : color.muted,
  };

  const padding = variant === 'dark' ? '4px 12px' : '4px 11px';
  const radius = variant === 'dark' ? 14 : 16;

  return (
    <div
      style={
        variant === 'pill'
          ? {
              display: 'flex',
              background: color.surfaceSand,
              border: `1px solid ${color.lineSand}`,
              borderRadius: 20,
              padding: 3,
              font: `600 11px ${font.sans}`,
            }
          : {
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
              marginTop: 6,
              font: `600 11px ${font.sans}`,
            }
      }
    >
      <button
        type="button"
        onClick={() => dispatch({ type: 'setLang', lang: 'en' })}
        aria-pressed={state.lang === 'en'}
        lang="en"
        style={{ padding, borderRadius: radius, ...(isArabic ? idleStyle : activeStyle) }}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'setLang', lang: 'ar' })}
        aria-pressed={state.lang === 'ar'}
        lang="ar"
        style={{
          padding,
          borderRadius: radius,
          fontFamily: font.arabicSans,
          ...(isArabic ? activeStyle : idleStyle),
        }}
      >
        {variant === 'dark' ? 'العربية' : 'ع'}
      </button>
    </div>
  );
}
