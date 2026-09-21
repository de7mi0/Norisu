import { Screen, ScreenHeader } from '../../components/Screen';
import { useApp } from '../../state/context';
import { monthLabel } from '../../i18n';
import { color, font } from '../../theme';
import type { CommissionPeriod } from '../../data/commission';

/**
 * What this salon owes Saloni.
 *
 * Saloni takes a percentage of each booking, so every salon gets an invoice.
 * This screen exists so that invoice is never the first time an owner sees the
 * number: `commission_statement()` answers to Saloni's admin and to the salon's
 * own owner from the identical rows, so the two sides cannot disagree, and the
 * owner can check the figure before being asked to pay it.
 *
 * It replaces a row on the More screen that read "Payouts · SAR 18,240" — an
 * invented figure behind a button that did nothing. An invented number about
 * money is the worst kind to leave in a demo, because it is the one somebody
 * will believe.
 *
 * Two things are said plainly rather than left to be discovered on an invoice:
 * that walk-ins are never charged, and that nothing is collected through the
 * app. Both are true today and both are the kind of thing a salon would
 * otherwise assume the other way.
 */
export function Earnings() {
  const { t, dispatch, isArabic, backIcon, money, commission } = useApp();

  return (
    <Screen bottomInset={88}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.earnTitle}
        subtitle={t.earnSub}
      />

      <div style={{ padding: '22px 24px 0' }}>
        {commission.source === 'loading' ? (
          <p style={{ font: `500 13px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.earnLoading}
          </p>
        ) : commission.source === 'demo' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.earnNeedSalon}
          </p>
        ) : commission.source === 'error' ? (
          // Deliberately not a zero. Zero is a figure, and telling a salon it
          // owes nothing because a query failed is the worst way to be wrong.
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.danger, margin: 0 }}>
            {t.earnFailed}
          </p>
        ) : (
          <>
            <PeriodCard label={t.earnThisMonth} period={commission.thisMonth} lead />
            <PeriodCard label={t.earnLastMonth} period={commission.lastMonth} />

            <section
              style={{
                marginTop: 22,
                padding: '14px 16px',
                borderRadius: 14,
                background: color.surfaceWarm,
                border: `1px solid ${color.lineWarm}`,
              }}
            >
              <h2
                style={{
                  font: `600 14px ${font.serif}`,
                  color: color.ink,
                  margin: '0 0 6px',
                }}
              >
                {t.earnHowTitle}
              </h2>
              <p
                style={{
                  font: `500 12px/1.65 ${font.sans}`,
                  color: color.inkSoft,
                  margin: 0,
                }}
              >
                {t.earnHowBody}
              </p>
              <p
                style={{
                  font: `600 12px/1.65 ${font.sans}`,
                  color: color.inkSoft,
                  margin: '9px 0 0',
                }}
              >
                {t.earnWalkInNote}
              </p>
              <p
                style={{
                  font: `500 11.5px/1.6 ${font.sans}`,
                  color: color.mutedSoft,
                  margin: '9px 0 0',
                }}
              >
                {t.earnNotPaid}
              </p>
            </section>
          </>
        )}
      </div>
    </Screen>
  );

  function PeriodCard({
    label,
    period,
    lead = false,
  }: {
    label: string;
    period: CommissionPeriod | null;
    lead?: boolean;
  }) {
    if (!period) return null;

    const empty = period.bookings === 0;

    /**
     * Derived from this period's own two figures rather than read from the
     * salon row — deliberately, and not as a workaround.
     *
     * `salons.commission_bps` is in no grant at all (migration 0018), so an
     * owner genuinely cannot read their stored rate, which is what stops them
     * setting it to zero or learning a rival's. Dividing what is owed by what
     * it was charged on gives the same answer without opening that door, and
     * gives a better one when a salon's deal changed mid-month: the rate they
     * actually paid across the period, rather than whichever number happens to
     * be on the row today.
     */
    const rate =
      period.gross > 0 ? ((period.commission / period.gross) * 100).toFixed(1) : null;

    return (
      <section
        style={{
          marginTop: lead ? 0 : 12,
          padding: lead ? '18px 18px 16px' : '15px 16px',
          borderRadius: 16,
          background: lead ? color.ink : color.surface,
          border: lead ? 'none' : `1px solid ${color.line}`,
          color: lead ? color.page : color.ink,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span
            style={{
              font: `700 10.5px ${font.sans}`,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: lead ? color.goldSoft : color.mutedFaint,
            }}
          >
            {label}
          </span>
          {/* Not `.ltr-run`: monthLabel returns "سبتمبر 2026" in Arabic, whose
              own script matches the paragraph, so forcing LTR would misorder
              it. Only genuinely Latin-and-digit runs get isolated — §4. */}
          <span
            style={{
              font: `500 10.5px ${font.sans}`,
              color: lead ? 'rgba(253,252,250,.6)' : color.mutedFaint,
            }}
          >
            {monthLabel(period.from, isArabic ? 'ar' : 'en')}
          </span>
        </div>

        {empty ? (
          <>
            <div
              style={{
                font: `600 20px ${font.serif}`,
                margin: '8px 0 0',
                color: lead ? color.page : color.ink,
              }}
            >
              {t.earnNothing}
            </div>
            <div
              style={{
                font: `500 11.5px/1.6 ${font.sans}`,
                color: lead ? 'rgba(253,252,250,.7)' : color.mutedSoft,
                marginTop: 3,
              }}
            >
              {t.earnNothingSub}
            </div>
          </>
        ) : (
          <>
            {/* The figure the invoice will carry, given the room that implies.
                Deliberately not `.ltr-run`: formatMoney returns "69 ر.س" in
                Arabic, which lays out correctly on its own — the rest of the
                app renders money unwrapped for the same reason. */}
            <div
              style={{
                font: `600 ${lead ? 34 : 24}px ${font.serif}`,
                margin: '6px 0 0',
                color: lead ? color.gold : color.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {money(period.commission)}
            </div>

            <dl
              style={{
                margin: '12px 0 0',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '6px 12px',
                font: `500 12px ${font.sans}`,
              }}
            >
              <Row lead={lead} term={t.earnVisits} value={String(period.bookings)} />
              <Row lead={lead} term={t.earnGross} value={money(period.gross)} />
              {rate ? <Row lead={lead} term={t.earnRate} value={`${rate}%`} isolate /> : null}
            </dl>
          </>
        )}
      </section>
    );
  }

  /**
   * `isolate` is for genuinely Latin-and-digit values only — "5.0%" — which
   * reorder inside Arabic text (CLAUDE.md §4). A plain count and a money
   * figure both lay out correctly without it, and money actively breaks with
   * it: the Arabic format is "69 ر.س", whose own script is RTL.
   */
  function Row({
    term,
    value,
    lead,
    isolate = false,
  }: {
    term: string;
    value: string;
    lead: boolean;
    isolate?: boolean;
  }) {
    return (
      <>
        <dt style={{ color: lead ? 'rgba(253,252,250,.7)' : color.mutedSoft, margin: 0 }}>
          {term}
        </dt>
        <dd
          className={isolate ? 'ltr-run' : undefined}
          style={{
            margin: 0,
            textAlign: 'end',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: lead ? color.page : color.ink,
          }}
        >
          {value}
        </dd>
      </>
    );
  }
}
