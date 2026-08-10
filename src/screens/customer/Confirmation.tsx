import { PAY_METHODS } from '../../data/payments';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Booking confirmed: reference number, amount paid, and where to go next. */
export function Confirmation() {
  const { t, state, dispatch, isArabic, salon, money, totals, staffName, dateSummary, slotSummary } =
    useApp();

  const method = PAY_METHODS.find((candidate) => candidate.id === state.payId);
  const payName = method ? (isArabic ? method.nameAr : method.name) : '';
  const salonName = isArabic ? salon.ar : salon.name;
  const bookingRef = 4820 + state.bookings.length;

  // Staff names such as "Layla A." already end in a period.
  const staffPhrase = staffName.replace(/\.$/, '');
  const description = isArabic
    ? `تم تأكيد موعدك في ${salonName} بتاريخ ${dateSummary} الساعة ${slotSummary} مع ${staffPhrase}.`
    : `Your appointment at ${salon.name} is confirmed for ${dateSummary} at ${slotSummary} with ${staffPhrase}.`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(170deg,#fdfcfa 0%,#faf3df 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 30px',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: color.gold,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 48,
          color: color.goldInk,
          animation: 'pop .5s ease both',
        }}
      >
        ✓
      </div>

      <h1 style={{ font: `600 30px/1.05 ${font.serif}`, marginTop: 24, marginBottom: 0, animation: 'rise .5s .1s both' }}>
        {t.booked}
      </h1>
      <div
        lang="ar"
        style={{
          font: `700 20px ${font.arabicDisplay}`,
          color: color.goldLink,
          marginTop: 4,
          animation: 'rise .5s .15s both',
        }}
      >
        تم الحجز
      </div>
      <p
        style={{
          font: `500 13px/1.5 ${font.sans}`,
          color: color.muted,
          marginTop: 12,
          maxWidth: 250,
          animation: 'rise .5s .2s both',
        }}
      >
        {description}
      </p>

      <div
        style={{
          marginTop: 24,
          width: '100%',
          background: color.surface,
          border: `1px solid ${color.lineWarm}`,
          borderRadius: 18,
          padding: 16,
          textAlign: 'start',
          animation: 'rise .5s .25s both',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            font: `500 12px ${font.sans}`,
            color: color.mutedSoft,
          }}
        >
          <span>{t.bookingRef}</span>
          <span style={{ color: color.ink, fontWeight: 700 }}>#SL-{bookingRef}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            font: `500 12px ${font.sans}`,
            color: color.mutedSoft,
            marginTop: 8,
          }}
        >
          <span>{t.paid}</span>
          <span style={{ color: color.ink, fontWeight: 700 }}>
            {money(totals.grandTotal)} · {payName}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'go', screen: 'bookings' })}
        className="press"
        style={{
          marginTop: 22,
          width: '100%',
          textAlign: 'center',
          background: color.ink,
          color: color.goldSoft,
          borderRadius: 15,
          padding: 16,
          font: `700 14px ${font.sans}`,
          animation: 'rise .5s .3s both',
        }}
      >
        {t.viewBookings}
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'go', screen: 'home' })}
        style={{ marginTop: 10, font: `600 13px ${font.sans}`, color: color.mutedSoft }}
      >
        {t.backHome}
      </button>
    </div>
  );
}
