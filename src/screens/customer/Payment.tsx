import { BottomBar, Screen, ScreenHeader } from '../../components/Screen';
import { PAY_METHODS } from '../../data/payments';
import { priceNow } from '../../data/services';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * Step 3: order summary and payment method. Checkout is simulated — no card or
 * wallet credentials are ever collected.
 */
export function Payment() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    salon,
    selectedServices,
    totals,
    money,
    staffName,
    dateSummary,
    slotSummary,
    confirmBooking,
  } = useApp();

  const summaryRow = {
    display: 'flex',
    justifyContent: 'space-between',
  } as const;

  return (
    <>
      <Screen bottomInset={104}>
        <ScreenHeader
          onBack={() => dispatch({ type: 'back' })}
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={t.reviewPay}
          subtitle={t.step3}
        />

        <div
          style={{
            margin: '20px 24px 0',
            background: color.surfaceWarm,
            border: `1px solid ${color.lineWarm}`,
            borderRadius: 18,
            padding: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              paddingBottom: 12,
              borderBottom: '1px dashed #e2dccb',
            }}
          >
            <div
              aria-hidden="true"
              style={{ width: 48, height: 48, borderRadius: 12, background: salon.tile }}
            />
            <div>
              <div style={{ font: `600 15px ${font.serif}` }}>
                {isArabic ? salon.ar : salon.name}
              </div>
              <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
                {dateSummary} · {slotSummary}
              </div>
              <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
                {t.withWord} {staffName}
              </div>
            </div>
          </div>
          <div
            style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {selectedServices.map((service) => (
              <div key={service.id} style={{ ...summaryRow, font: `500 12.5px ${font.sans}` }}>
                <span style={{ color: color.inkSoft }}>{isArabic ? service.ar : service.name}</span>
                <span style={{ fontWeight: 600 }}>{money(priceNow(service))}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            margin: '16px 24px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            font: `500 12.5px ${font.sans}`,
          }}
        >
          <div style={{ ...summaryRow, color: color.muted }}>
            <span>{t.subtotal}</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div style={{ ...summaryRow, color: color.success }}>
            <span>{t.discount}</span>
            <span>− {money(totals.savings)}</span>
          </div>
          <div style={{ ...summaryRow, color: color.muted }}>
            <span>{t.vat}</span>
            <span>{money(totals.vat)}</span>
          </div>
          <div
            style={{
              ...summaryRow,
              font: `700 16px ${font.sans}`,
              color: color.ink,
              paddingTop: 6,
              borderTop: `1px solid ${color.line}`,
              marginTop: 4,
            }}
          >
            <span>{t.total}</span>
            <span>{money(totals.grandTotal)}</span>
          </div>
        </div>

        <div style={{ padding: '20px 24px 0' }}>
          <h2 style={{ font: `600 14px ${font.sans}`, margin: '0 0 12px' }}>{t.paymentMethod}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {PAY_METHODS.map((method) => {
              const active = state.payId === method.id;
              const sub = isArabic ? method.subAr ?? method.sub : method.sub;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => dispatch({ type: 'pickPayment', payId: method.id })}
                  aria-pressed={active}
                  className="press"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: active ? color.cream : color.surface,
                    border: `1.5px solid ${active ? color.gold : color.lineWarm}`,
                    borderRadius: 14,
                    padding: '13px 14px',
                    textAlign: 'start',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 44,
                      height: 28,
                      borderRadius: 6,
                      background: method.badgeBg,
                      border: `1px solid ${method.badgeBd}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      font: `800 10px ${font.sans}`,
                      letterSpacing: '-.02em',
                      color: method.badgeFg,
                      flex: 'none',
                    }}
                  >
                    {method.badge}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', font: `600 13px ${font.sans}` }}>
                      {isArabic ? method.nameAr : method.name}
                    </span>
                    {sub ? (
                      <span
                        style={{
                          display: 'block',
                          font: `500 10.5px ${font.sans}`,
                          color: color.mutedSoft,
                        }}
                      >
                        {sub}
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      flex: 'none',
                      border: `1.5px solid ${active ? color.gold : '#d8d2c6'}`,
                      background: active ? color.gold : color.surface,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 11,
                    }}
                  >
                    {active ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Screen>

      <BottomBar style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft }}>{t.total}</div>
          <div style={{ font: `700 18px ${font.sans}` }}>{money(totals.grandTotal)}</div>
        </div>
        <button
          type="button"
          onClick={confirmBooking}
          className="press"
          style={{
            background: color.ink,
            color: color.goldSoft,
            borderRadius: 15,
            padding: '15px 26px',
            font: `700 14px ${font.sans}`,
          }}
        >
          {t.confirmPay}
        </button>
      </BottomBar>
    </>
  );
}
