import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_WAITLIST } from '../../data/vendor';
import type { SalonWaitlistEntry } from '../../data/waitlist';
import { dayLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font, tile } from '../../theme';

/** Waitlist settings and the customers currently queued. */
export function Waitlist() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    owner,
    salonWaitlist,
    setWaitlistEnabled,
    extendHold,
    reoffer,
  } = useApp();

  const live = salonWaitlist.source === 'live';
  const queue = salonWaitlist.entries;
  // The owner's own setting once we know it; the sample screen otherwise.
  const on = owner.salon ? owner.salon.waitlistEnabled : true;
  const count = live ? queue.length : VENDOR_WAITLIST.length;

  return (
    <Screen bottomInset={88}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.waitlistTitle}
      />

      {/* The last of these in the codebase, and it comes off with this. */}
      <SampleDataNotice section={live ? undefined : 'waitlist'} />

      <div
        style={{
          margin: '18px 24px 0',
          background: color.surface,
          border: `1px solid ${color.lineWarm}`,
          borderRadius: 16,
          padding: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 14,
          boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 14px ${font.sans}` }}>{t.enableWaitlist}</div>
          <div style={{ font: `500 10.5px/1.4 ${font.sans}`, color: color.mutedSoft, marginTop: 3 }}>
            {t.enableWaitlistSub}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void setWaitlistEnabled(!on)}
          disabled={!owner.salon}
          role="switch"
          aria-checked={on}
          aria-label={t.enableWaitlist}
          style={{
            width: 46,
            height: 26,
            flex: 'none',
            borderRadius: 14,
            background: on ? color.tealBright : '#e2ddd2',
            position: 'relative',
            transition: 'background .2s',
            cursor: owner.salon ? 'pointer' : 'not-allowed',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              insetInlineStart: on ? 23 : 3,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,.3)',
              transition: 'inset-inline-start .2s',
            }}
          />
        </button>
      </div>

      {on ? (
        <>
          <div
            style={{
              padding: '22px 24px 0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ font: `600 15px ${font.sans}` }}>{t.waiting}</span>
            <span style={{ font: `600 11px ${font.sans}`, color: color.goldLink }}>
              {isArabic ? `${count} في الانتظار` : `${count} waiting`}
            </span>
          </div>

          <div style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {live ? (
              queue.length === 0 ? (
                <div
                  style={{
                    border: `1px dashed ${color.lineDashed}`,
                    borderRadius: 12,
                    padding: '18px 14px',
                    textAlign: 'center',
                    font: `500 12px/1.5 ${font.sans}`,
                    color: color.mutedSoft,
                  }}
                >
                  {t.waitlistEmpty}
                </div>
              ) : (
                queue.map((entry) => (
                  <QueueRow
                    key={entry.id}
                    entry={entry}
                    lang={state.lang}
                    onExtend={() => entry.offerId && void extendHold(entry.offerId)}
                    onNotify={() => void reoffer(entry.id)}
                  />
                ))
              )
            ) : (
              VENDOR_WAITLIST.map((entry) => (
                <SampleRow key={entry.name} entry={entry} isArabic={isArabic} notify={t.notify} />
              ))
            )}
          </div>
        </>
      ) : (
        <p
          style={{
            padding: '44px 34px',
            textAlign: 'center',
            font: `500 12px/1.6 ${font.sans}`,
            color: color.mutedFaint,
            margin: 0,
          }}
        >
          {t.waitlistOffMsg}
        </p>
      )}
    </Screen>
  );
}

const CARD = {
  borderRadius: 16,
  padding: 14,
  boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
} as const;

/**
 * One person in the real queue.
 *
 * "Give longer" appears only when nobody is queued behind them. Holding a seat
 * for one person while others wait costs them their turn for nothing, and the
 * database refuses it anyway — offering a button that cannot work would be
 * worse than not offering it.
 */
function QueueRow({
  entry,
  lang,
  onExtend,
  onNotify,
}: {
  entry: SalonWaitlistEntry;
  lang: 'en' | 'ar';
  onExtend: () => void;
  onNotify: () => void;
}) {
  const { t, isArabic } = useApp();
  const services = isArabic ? entry.servicesAr : entry.services;
  const held = entry.offerId != null && entry.offerTime != null;

  return (
    <div
      style={{
        ...CARD,
        background: held ? color.tealSoft : color.surface,
        border: `1px solid ${held ? color.tealLine : color.lineWarm}`,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* No name given means that is all the salon gets — the same
              fallback the calendar uses, for the same reason. */}
          <div style={{ font: `600 14px ${font.sans}` }}>
            {entry.customerName ?? t.anonymousCustomer}
          </div>
          <div style={{ font: `500 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 2 }}>
            {dayLabel(new Date(`${entry.day}T12:00:00`), lang)}
            {services.length > 0 ? ` · ${services.join(' · ')}` : ''}
          </div>
          <div style={{ font: `500 10px ${font.sans}`, color: color.mutedFaint, marginTop: 2 }}>
            {entry.from && entry.to ? (
              <span className="ltr-run">
                {entry.from.slice(0, 5)}–{entry.to.slice(0, 5)}
              </span>
            ) : (
              t.waitlistAnyTimeShort
            )}
          </div>
          {held ? (
            <div style={{ font: `700 10.5px ${font.sans}`, color: color.teal, marginTop: 4 }}>
              {t.waitlistHeld} · <span className="ltr-run">{entry.offerTime}</span>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none' }}>
          <button
            type="button"
            onClick={onNotify}
            className="press"
            style={{
              background: color.gold,
              color: color.goldInk,
              borderRadius: 11,
              padding: '9px 13px',
              font: `700 11px ${font.sans}`,
            }}
          >
            {t.notify}
          </button>
          {entry.canExtend ? (
            <button
              type="button"
              onClick={onExtend}
              className="press"
              style={{
                border: `1.5px solid ${color.lineSand}`,
                borderRadius: 11,
                padding: '8px 13px',
                font: `600 11px ${font.sans}`,
                color: color.mutedSoft,
              }}
            >
              {t.waitlistExtend}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The bundled demo queue, shown to a visitor who owns no salon. */
function SampleRow({
  entry,
  isArabic,
  notify,
}: {
  entry: (typeof VENDOR_WAITLIST)[number];
  isArabic: boolean;
  notify: string;
}) {
  return (
    <div style={{ ...CARD, background: color.surface, border: `1px solid ${color.lineWarm}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            flex: 'none',
            background: tile.sandFine,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: `700 13px ${font.sans}`,
            color: '#8a7a4e',
          }}
        >
          {entry.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `600 14px ${font.sans}` }}>
            {isArabic ? entry.arName : entry.name}
          </div>
          <div style={{ font: `500 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 2 }}>
            {isArabic ? entry.arService : entry.service} · {isArabic ? entry.arDate : entry.date}
          </div>
          <div style={{ font: `500 10px ${font.sans}`, color: color.mutedFaint, marginTop: 2 }}>
            {isArabic ? entry.arPref : entry.pref}
          </div>
        </div>
        {/* Inert on purpose: there is nobody real here to offer anything to. */}
        <button
          type="button"
          disabled
          style={{
            flex: 'none',
            background: color.surfaceSand,
            color: color.disabled,
            borderRadius: 11,
            padding: '9px 13px',
            font: `700 11px ${font.sans}`,
            cursor: 'not-allowed',
          }}
        >
          {notify}
        </button>
      </div>
    </div>
  );
}
