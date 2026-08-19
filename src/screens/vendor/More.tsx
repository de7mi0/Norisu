import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen } from '../../components/Screen';
import { VENDOR_NAME } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { VendorScreen } from '../../types';

/** Vendor settings hub. */
export function More() {
  const { t, state, dispatch, isArabic, chevron, owner } = useApp();

  const go = (screen: VendorScreen) => () => dispatch({ type: 'go', screen });

  const rows = [
    {
      // Real per-salon settings, so the value shown is the real one.
      label: t.hoursTitle,
      value: owner.salon
        ? `${owner.salon.slotStepMinutes} ${t.minutesShort}`
        : isArabic
          ? 'تجريبي'
          : 'Sample',
      onSelect: go('v_hours'),
    },
    {
      label: isArabic ? 'معرض الصور' : 'Photo gallery',
      value: isArabic ? '5 صور' : '5 photos',
      onSelect: go('v_gallery'),
    },
    {
      label: isArabic ? 'إدارة الفريق' : 'Staff management',
      value: owner.salon
        ? `${owner.salon.staff.length}`
        : isArabic
          ? '3 أعضاء'
          : '3 members',
      onSelect: go('v_staff'),
    },
    {
      label: isArabic ? 'المراجعات' : 'Reviews',
      value: '4.9 ★',
      onSelect: go('v_reviews'),
    },
    {
      label: isArabic ? 'ملف العمل' : 'Business profile',
      value: isArabic ? 'تعديل' : 'Edit',
      onSelect: () => dispatch({ type: 'goOnboarding', from: 'v_more' }),
    },
    {
      label: isArabic ? 'قائمة الانتظار' : 'Waitlist',
      value: state.waitlistOn ? (isArabic ? 'مفعّلة · 3' : 'On · 3') : isArabic ? 'موقوفة' : 'Off',
      onSelect: go('v_waitlist'),
    },
    {
      label: isArabic ? 'المدفوعات' : 'Payouts',
      value: isArabic ? '18,240 ر.س' : 'SAR 18,240',
      onSelect: () => {},
    },
  ];

  return (
    <Screen bottomInset={88}>
      <div style={{ padding: '56px 24px 0', display: 'flex', gap: 14, alignItems: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'repeating-linear-gradient(135deg,#efe9dd 0 8px,#e7e0d2 8px 16px)',
          }}
        />
        <div>
          <h1 style={{ font: `600 22px ${font.serif}`, margin: 0 }}>
            {owner.salon ? (isArabic ? owner.salon.nameAr : owner.salon.name) : VENDOR_NAME}
          </h1>
          <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>{t.verified}</div>
        </div>

      <SampleDataNotice />
      </div>

      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            onClick={row.onSelect}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 4px',
              borderBottom: `1px solid ${color.lineFaint}`,
            }}
          >
            <span style={{ font: `600 13.5px ${font.sans}`, color: color.ink }}>{row.label}</span>
            <span style={{ font: `500 12px ${font.sans}`, color: color.mutedFaint }}>
              {row.value} {chevron}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'pickMode', mode: 'customer' })}
        className="press"
        style={{
          display: 'block',
          width: 'calc(100% - 48px)',
          margin: '24px 24px 0',
          textAlign: 'center',
          padding: 14,
          border: `1.5px solid ${color.lineSand}`,
          borderRadius: 14,
          font: `600 13px ${font.sans}`,
          color: color.mutedSoft,
        }}
      >
        {t.switchCustomer}
      </button>
    </Screen>
  );
}
