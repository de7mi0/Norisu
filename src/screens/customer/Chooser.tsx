import { LangToggle } from '../../components/LangToggle';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Entry screen: enter as a customer, or as a salon owner. */
export function Chooser() {
  const { t, arrow, dispatch } = useApp();

  const options = [
    {
      key: 'customer' as const,
      title: t.chCust,
      subtitle: t.chCustSub,
      style: { background: color.gold, color: color.goldInk },
      subtitleOpacity: 0.7,
    },
    {
      key: 'vendor' as const,
      title: t.chVend,
      subtitle: t.chVendSub,
      style: {
        background: 'rgba(255,255,255,.08)',
        border: '1px solid rgba(255,255,255,.16)',
        color: color.page,
      },
      subtitleOpacity: 0.6,
    },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(165deg,#1c1913 0%,#2a2413 60%,#3a2e0c 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 30px 34px',
        color: color.page,
      }}
    >
      <div>
        <h1
          style={{
            font: `600 44px/1 ${font.serif}`,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 9,
            margin: 0,
          }}
        >
          Saloni
          <span
            style={{
              width: 11,
              height: 11,
              background: color.gold,
              borderRadius: '50%',
              marginBottom: 9,
            }}
          />
        </h1>
        <div
          lang="ar"
          style={{ font: `700 26px ${font.arabicDisplay}`, color: color.goldSoft, marginTop: 6 }}
        >
          صالوني
        </div>
        <p
          style={{
            font: `500 14px/1.5 ${font.sans}`,
            color: '#cfc7b4',
            marginTop: 16,
            maxWidth: 230,
          }}
        >
          {t.chTag}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => dispatch({ type: 'pickMode', mode: option.key })}
            className="press"
            style={{
              borderRadius: 18,
              padding: '18px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              ...option.style,
            }}
          >
            <span>
              <span style={{ display: 'block', font: `700 16px ${font.sans}` }}>{option.title}</span>
              <span
                style={{
                  display: 'block',
                  font: `500 12px ${font.sans}`,
                  opacity: option.subtitleOpacity,
                  marginTop: 2,
                }}
              >
                {option.subtitle}
              </span>
            </span>
            <span style={{ fontSize: 20 }} aria-hidden="true">
              {arrow}
            </span>
          </button>
        ))}
        <LangToggle variant="dark" />
      </div>
    </div>
  );
}
