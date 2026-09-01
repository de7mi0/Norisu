import { useState } from 'react';
import { Photo } from '../../components/Photo';
import { BottomBar, Screen } from '../../components/Screen';
import { ChatIcon, PhoneIcon } from '../../components/icons';
import { SALON_PHONE } from '../../data/salons';
import { priceNow } from '../../data/services';
import { localizeUnits, salonCategory } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Salon profile: gallery header, quick actions, and the service picker. */
export function SalonDetail() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    salon,
    salonPhotos,
    salonServices,
    selectedServices,
    totals,
    money,
    backIcon,
    flash,
    openConversation,
  } = useApp();

  const saved = Boolean(state.saved[salon.id]);
  const hasSelection = selectedServices.length > 0;

  // Which photograph the strip is showing. Only ever set by scrolling the strip
  // itself, so it cannot disagree with what is on screen.
  const [shown, setShown] = useState(0);
  // Three dots over a placeholder is how the prototype drew "there would be
  // photographs here". Over real ones they have to count the real ones.
  const dots = salonPhotos.length || 3;

  const circleButton = {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: 'rgba(255,255,255,.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

  return (
    <>
      <Screen bottomInset={96}>
        <div style={{ position: 'relative', height: 270, background: salon.tile }}>
          {salonPhotos.length ? (
            <div
              className="scr"
              // Swiping between them is the whole interaction, and it is the
              // browser's own scrolling rather than anything this app tracks —
              // `shown` only follows along so the dots below can say where you
              // are. It reads right-to-left in Arabic for free, which is why
              // the scroll position is measured as a distance from the start
              // rather than from the left.
              onScroll={(event) => {
                const strip = event.currentTarget;
                setShown(Math.round(Math.abs(strip.scrollLeft) / strip.clientWidth));
              }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollSnapType: 'x mandatory',
              }}
            >
              {salonPhotos.map((photo, index) => (
                <Photo
                  key={photo.id}
                  src={photo.url}
                  tile={salon.tile}
                  // The owner's own words when they wrote any; otherwise the
                  // salon's name, once, on the photograph it leads with. The
                  // rest are decoration — repeating the name five times tells a
                  // screen reader nothing it did not hear the first time.
                  alt={photo.alt || (index === 0 ? (isArabic ? salon.ar : salon.name) : '')}
                  style={{ flex: '0 0 100%', height: '100%', scrollSnapAlign: 'start' }}
                />
              ))}
            </div>
          ) : (
            <div
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
              SALON GALLERY
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg,rgba(10,8,2,.35) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 60%,rgba(253,252,250,1) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 52,
              insetInline: 20,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={() => dispatch({ type: 'back' })}
              aria-label={isArabic ? 'رجوع' : 'Back'}
              className="press"
              style={{ ...circleButton, fontSize: 18, color: color.ink }}
            >
              {backIcon}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => dispatch({ type: 'toggleSaved', salonId: salon.id })}
                aria-pressed={saved}
                aria-label={isArabic ? 'حفظ الصالون' : 'Save salon'}
                className="press"
                style={{
                  ...circleButton,
                  fontSize: 16,
                  color: saved ? color.danger : color.ink,
                }}
              >
                {saved ? '♥' : '♡'}
              </button>
              <button
                type="button"
                onClick={() => flash(t.linkCopied)}
                aria-label={isArabic ? 'مشاركة' : 'Share'}
                className="press"
                style={{ ...circleButton, fontSize: 15, color: color.ink }}
              >
                ↗
              </button>
            </div>
          </div>
          <div
            aria-hidden="true"
            style={{ position: 'absolute', bottom: 16, insetInline: 20, display: 'flex', gap: 6 }}
          >
            {Array.from({ length: dots }, (_, index) => (
              <span
                key={index}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: index === shown ? color.gold : 'rgba(255,255,255,.5)',
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ padding: '4px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ font: `600 27px/1 ${font.serif}`, margin: 0 }}>
                {isArabic ? salon.ar : salon.name}
              </h1>
              <div
                style={{
                  font: `700 18px ${font.arabicDisplay}`,
                  color: color.goldLink,
                  marginTop: 2,
                }}
              >
                {isArabic ? salon.name : salon.ar}
              </div>
            </div>
            {salon.discount > 0 ? (
              <div
                style={{
                  background: color.gold,
                  color: color.goldInkAlt,
                  font: `700 12px ${font.sans}`,
                  padding: '6px 11px',
                  borderRadius: 10,
                }}
                className="ltr-run"
              >
                -{salon.discount}%
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              marginTop: 10,
              font: `500 12.5px ${font.sans}`,
              color: color.muted,
            }}
          >
            {salon.rating != null ? (
              <span style={{ color: color.goldDeep, fontWeight: 600 }}>★ {salon.rating}</span>
            ) : (
              <span style={{ color: color.goldDeep, fontWeight: 600 }}>
                {isArabic ? 'جديد' : 'New'}
              </span>
            )}
            <button
              type="button"
              onClick={() => dispatch({ type: 'go', screen: 'reviews' })}
              style={{ textDecoration: 'underline' }}
            >
              {isArabic ? `${salon.reviews} تقييم` : `${salon.reviews} reviews`}
            </button>
            {salon.distance ? (
              <>
                <span
                  aria-hidden="true"
                  style={{ width: 3, height: 3, background: '#c9c3b7', borderRadius: '50%' }}
                />
                <span className="ltr-run">{salon.distance}</span>
              </>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <div
              style={{
                flex: 1,
                background: color.surfaceWarm,
                border: `1px solid ${color.lineWarm}`,
                borderRadius: 12,
                padding: 10,
                textAlign: 'center',
              }}
            >
              <div style={{ font: `700 12px ${font.sans}` }}>{t.openNow}</div>
              <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft }}>{t.until}</div>
            </div>
            <div
              style={{
                flex: 1,
                background: color.surfaceWarm,
                border: `1px solid ${color.lineWarm}`,
                borderRadius: 12,
                padding: 10,
                textAlign: 'center',
              }}
            >
              <div style={{ font: `700 12px ${font.sans}` }}>
                {salonCategory(salon, state.lang)}
              </div>
              <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft }}>
                {t.privateRooms}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '16px 24px 0' }}>
          <button
            type="button"
            onClick={() => openConversation('chat')}
            className="press"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: color.ink,
              color: color.goldSoft,
              borderRadius: 14,
              padding: 13,
              font: `700 13px ${font.sans}`,
            }}
          >
            <ChatIcon />
            {t.message}
          </button>
          <button
            type="button"
            onClick={() => flash(`${isArabic ? 'جارٍ الاتصال ' : 'Calling '}${SALON_PHONE}`)}
            className="press"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: color.surfaceSand,
              border: `1.5px solid ${color.lineSand}`,
              color: color.ink,
              borderRadius: 14,
              padding: 13,
              font: `700 13px ${font.sans}`,
            }}
          >
            <PhoneIcon />
            {t.callNow}
          </button>
        </div>

        <div style={{ padding: '22px 24px 0' }}>
          <h2 style={{ font: `600 19px ${font.serif}`, margin: 0 }}>{t.services}</h2>
        </div>

        <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {salonServices.map((service) => {
            const active = Boolean(state.selected[service.id]);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => dispatch({ type: 'toggleService', serviceId: service.id })}
                aria-pressed={active}
                className="press"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: active ? color.cream : color.surface,
                  border: `1.5px solid ${active ? color.gold : color.lineWarm}`,
                  borderRadius: 16,
                  padding: 14,
                  textAlign: 'start',
                }}
              >
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', font: `600 14.5px ${font.sans}` }}>
                    {isArabic ? service.ar : service.name}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      font: `500 11px ${font.arabicSans}`,
                      color: color.mutedSoft,
                      margin: '2px 0 4px',
                    }}
                  >
                    {isArabic ? service.name : service.ar} · {localizeUnits(service.dur, state.lang)}
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ font: `700 13px ${font.sans}`, color: color.ink }}>
                      {money(priceNow(service))}
                    </span>
                    {service.discount > 0 ? (
                      <span
                        style={{
                          font: `500 11px ${font.sans}`,
                          color: color.mutedFaint,
                          textDecoration: 'line-through',
                        }}
                      >
                        {money(service.price)}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 15,
                    background: active ? color.gold : color.surface,
                    color: active ? color.goldInk : color.disabled,
                    border: `1.5px solid ${active ? color.gold : '#d8d2c6'}`,
                  }}
                >
                  {active ? '✓' : '+'}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ height: 20 }} />
      </Screen>

      {hasSelection ? (
        <BottomBar style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft }}>
              {isArabic
                ? `${selectedServices.length} خدمة مختارة`
                : `${selectedServices.length} service${selectedServices.length > 1 ? 's' : ''} selected`}
            </div>
            <div style={{ font: `700 18px ${font.sans}` }}>{money(totals.total)}</div>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'go', screen: 'staff' })}
            className="press"
            style={{
              background: color.gold,
              color: color.goldInk,
              borderRadius: 15,
              padding: '15px 26px',
              font: `700 14px ${font.sans}`,
              boxShadow: '0 12px 26px -12px rgba(245,197,66,.9)',
            }}
          >
            {t.continue_}
          </button>
        </BottomBar>
      ) : null}
    </>
  );
}
