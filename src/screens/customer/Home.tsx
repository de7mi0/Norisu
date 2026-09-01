import { LangToggle } from '../../components/LangToggle';
import { Photo } from '../../components/Photo';
import { Screen } from '../../components/Screen';
import { PinIcon } from '../../components/icons';
import { CATEGORIES, matchesCategory } from '../../data/salons';
import { salonTags } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Discovery screen: featured salon, category filter, and nearby salons. */
export function Home() {
  const { t, state, dispatch, isArabic, salons: allSalons, catalogSource } = useApp();

  const salons = allSalons.filter((salon) => matchesCategory(salon, state.activeCat));
  // The first published salon is the one featured at the top.
  const featured = allSalons[0];

  return (
    <Screen bottomInset={88}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px 0',
          font: `600 13px ${font.sans}`,
        }}
      >
        <span>9:41</span>
        <span
          aria-hidden="true"
          style={{
            width: 17,
            height: 10,
            border: `1.4px solid ${color.ink}`,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
      </div>

      <div
        style={{
          padding: '14px 24px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{
              font: `600 10px ${font.sans}`,
              letterSpacing: '.14em',
              color: color.goldLink,
            }}
          >
            {t.location}
          </span>
          <span
            style={{
              font: `600 15px ${font.sans}`,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {t.city}
            <span style={{ color: '#e0a92b', fontSize: 9 }} aria-hidden="true">
              ▾
            </span>
          </span>
        </div>
        <LangToggle variant="pill" />
      </div>

      {/*
        Only shown when the catalogue is not live, so it is obvious that these
        salons are samples rather than real rows. Silent in the normal case.
      */}
      {catalogSource === 'demo' || catalogSource === 'error' ? (
        <div style={{ padding: '10px 24px 0' }}>
          <span
            style={{
              display: 'inline-block',
              font: `600 10px ${font.sans}`,
              letterSpacing: '.06em',
              color: color.mutedSoft,
              background: color.surfaceSand,
              border: `1px solid ${color.lineSand}`,
              borderRadius: 12,
              padding: '4px 10px',
            }}
          >
            {catalogSource === 'error'
              ? isArabic
                ? 'تعذّر الاتصال — بيانات تجريبية'
                : 'Could not reach the database — sample data'
              : isArabic
                ? 'بيانات تجريبية'
                : 'Sample data'}
          </span>
        </div>
      ) : null}

      <div style={{ padding: '18px 24px 0' }}>
        <div
          style={{ font: `500 11px ${font.sans}`, letterSpacing: '.24em', color: color.goldDeep }}
        >
          {t.featEyebrow}
        </div>
        <h1 style={{ font: `600 32px/1.02 ${font.serif}`, marginTop: 6, marginBottom: 0 }}>
          {t.headline1}
          <br />
          {t.headline2}
        </h1>
      </div>

      <button
        type="button"
        onClick={() => featured && dispatch({ type: 'openSalon', salonId: featured.id })}
        className="press"
        style={{
          display: 'block',
          width: 'calc(100% - 48px)',
          margin: '16px 24px 0',
          position: 'relative',
          height: 250,
          borderRadius: 24,
          overflow: 'hidden',
          background: 'repeating-linear-gradient(125deg,#efe9dd 0 14px,#e7e0d2 14px 28px)',
        }}
      >
        {featured?.photo ? (
          // The stripe on the button behind stays as the backdrop, so a
          // photograph that is still loading looks like the salons that have
          // none rather than like a hole.
          <Photo
            src={featured.photo}
            tile="transparent"
            style={{ position: 'absolute', inset: 0 }}
          />
        ) : (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#b7ad97',
              font: `500 10px ${font.mono}`,
              letterSpacing: '.12em',
            }}
          >
            SALON INTERIOR
          </span>
        )}
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg,rgba(0,0,0,0) 42%,rgba(20,15,3,.82) 100%)',
          }}
        />
        {featured && featured.discount > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: 14,
              insetInlineEnd: 14,
              background: color.gold,
              color: color.goldInkAlt,
              font: `700 12px ${font.sans}`,
              padding: '6px 11px',
              borderRadius: 10,
            }}
            className="ltr-run"
          >
            -{featured.discount}%
          </span>
        ) : null}
        <span
          style={{
            position: 'absolute',
            insetInline: 18,
            bottom: 16,
            color: '#fff',
            textAlign: 'start',
            display: 'block',
          }}
        >
          <span style={{ display: 'block', font: `600 26px/1 ${font.serif}` }}>
            {featured ? (isArabic ? featured.ar : featured.name) : ''}
          </span>
          <span
            style={{ display: 'block', font: `700 17px ${font.arabicDisplay}`, color: color.goldSoft }}
          >
            {featured ? (isArabic ? featured.name : featured.ar) : ''}
          </span>
          <span
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              marginTop: 7,
              font: `500 12px ${font.sans}`,
              color: '#ece7dd',
            }}
          >
            {featured?.rating != null ? (
              <span style={{ color: color.goldSoft }}>★ {featured.rating}</span>
            ) : null}
            <span>{featured ? salonTags(featured, state.lang) : ''}</span>
          </span>
        </span>
      </button>

      <div
        className="scr hscroll"
        style={{ display: 'flex', gap: 9, padding: '20px 24px 0', overflowX: 'auto' }}
      >
        {CATEGORIES.map(([id, arabicName]) => {
          const active = state.activeCat === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'setCategory', category: id })}
              aria-pressed={active}
              style={{
                whiteSpace: 'nowrap',
                padding: '9px 16px',
                borderRadius: 22,
                font: `600 12.5px ${font.sans}`,
                background: active ? color.ink : color.surfaceSand,
                color: active ? '#fff' : color.inkSoft,
                border: `1px solid ${active ? color.ink : color.lineSand}`,
              }}
            >
              {isArabic ? arabicName : id}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '22px 24px 0',
        }}
      >
        <h2 style={{ font: `600 20px ${font.serif}`, margin: 0 }}>{t.nearYou}</h2>
        <span style={{ font: `500 11px ${font.sans}`, color: color.goldLink }}>{t.seeAll}</span>
      </div>

      <div style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {salons.map((salon) => (
          <button
            key={salon.id}
            type="button"
            onClick={() => dispatch({ type: 'openSalon', salonId: salon.id })}
            className="press"
            style={{ display: 'flex', gap: 13, alignItems: 'center', textAlign: 'start' }}
          >
            <Photo
              src={salon.photo}
              tile={salon.tile}
              style={{ width: 78, height: 78, borderRadius: 16, flex: 'none' }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span style={{ font: `600 16px ${font.serif}` }}>
                  {isArabic ? salon.ar : salon.name}
                </span>
                <span style={{ font: `600 11.5px ${font.sans}`, color: color.goldDeep }}>
                  {salon.rating != null ? `★ ${salon.rating}` : isArabic ? 'جديد' : 'New'}
                </span>
              </span>
              <span
                style={{
                  display: 'block',
                  font: `500 11px ${font.sans}`,
                  color: color.mutedSoft,
                  margin: '3px 0',
                }}
              >
                {salonTags(salon, state.lang)}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  font: `500 10.5px ${font.sans}`,
                  color: color.mutedFaint,
                  marginBottom: 6,
                }}
              >
                <PinIcon />
                {isArabic ? salon.arArea : salon.area}
                {salon.distance ? (
                  <>
                    {' · '}
                    <span className="ltr-run">{salon.distance}</span>
                  </>
                ) : null}
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ font: `600 11px ${font.sans}`, color: color.goldLink }}>
                  {isArabic ? `من ${salon.priceFrom} ر.س` : `from SAR ${salon.priceFrom}`}
                </span>
                {salon.discount > 0 ? (
                  <span
                    style={{
                      font: `600 10.5px ${font.sans}`,
                      color: color.goldInkAlt,
                      background: color.gold,
                      padding: '2px 7px',
                      borderRadius: 6,
                    }}
                    className="ltr-run"
                  >
                    -{salon.discount}%
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
        {salons.length === 0 ? (
          <p
            style={{
              textAlign: 'center',
              padding: '24px 0',
              font: `500 12px ${font.sans}`,
              color: color.mutedFaint,
            }}
          >
            {t.noSalons}
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
