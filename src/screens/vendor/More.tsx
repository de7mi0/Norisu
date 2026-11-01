import { LangToggle } from '../../components/LangToggle';
import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen } from '../../components/Screen';
import { VENDOR_NAME } from '../../data/vendor';
import { accountLabel } from '../../state/account';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { VendorScreen } from '../../types';

/** Vendor settings hub. */
export function More() {
  const {
    t,
    dispatch,
    isArabic,
    chevron,
    owner,
    salonWaitlist,
    unreadMessages,
    inbox,
    session,
    signOut,
    salons,
  } = useApp();
  const signedIn = session.status === 'signedIn';
  // Saloni's back office, for an administrator who came in through the salon
  // side. Hidden for everybody else as a courtesy; the boundary is is_admin()
  // inside every function behind it.
  const isAdmin = session.profile?.role === 'admin';

  const go = (screen: VendorScreen) => () => dispatch({ type: 'go', screen });

  const waitlistOn = owner.salon ? owner.salon.waitlistEnabled : true;
  // The hub is reached before the waitlist screen has loaded its queue, so the
  // count is only shown once it is genuinely known.
  const waiting = salonWaitlist.source === 'live' ? salonWaitlist.entries.length : '·';

  const rows = [
    ...(isAdmin
      ? [
          {
            label: t.chAdmin,
            value: t.adminOpen,
            onSelect: () => dispatch({ type: 'pickMode', mode: 'admin' }),
          },
        ]
      : []),
    {
      // Customers' questions, answered here and read in the customer's app.
      // Real for an owner; a visitor with no salon is told there is nobody to
      // answer for, rather than shown invented conversations.
      label: t.msgInboxTitle,
      value:
        inbox.source !== 'live'
          ? ''
          : unreadMessages > 0
            ? `${unreadMessages} ${t.msgNew}`
            : `${inbox.items.length}`,
      onSelect: go('v_inbox'),
    },
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
      // "5 photos" used to be shown to every owner, whatever they had uploaded.
      value: owner.salon ? '' : isArabic ? '5 صور' : '5 photos',
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
      // The salon's real score once it is published; "4.9 ★" was invented.
      value: owner.salon
        ? (() => {
            const rating = salons.find((s) => s.id === owner.salon?.id)?.rating;
            return rating == null ? '' : `${rating.toFixed(1)} ★`;
          })()
        : '4.9 ★',
      onSelect: go('v_reviews'),
    },
    {
      label: isArabic ? 'ملف العمل' : 'Business profile',
      value: isArabic ? 'تعديل' : 'Edit',
      onSelect: () => dispatch({ type: 'goOnboarding', from: 'v_more' }),
    },
    {
      label: isArabic ? 'قائمة الانتظار' : 'Waitlist',
      // The real count once we know the salon; the hub should not invent one.
      value: waitlistOn
        ? isArabic
          ? `مفعّلة · ${waiting}`
          : `On · ${waiting}`
        : isArabic
          ? 'موقوفة'
          : 'Off',
      onSelect: go('v_waitlist'),
    },
    {
      // Was "Payouts · SAR 18,240" behind a button that did nothing — an
      // invented figure about money, which is the worst kind to leave in a
      // demo because it is the one somebody believes. It is a real screen now,
      // and the value is deliberately not a number: the figure belongs on the
      // screen that can explain it, not on a hub row with no context.
      label: t.earnTitle,
      value: isArabic ? 'عرض' : 'View',
      onSelect: go('v_earnings'),
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
          {/* Where the salon really stands. This said "Al Olaya, Riyadh ·
              Verified" to every owner, including one still awaiting review. */}
          <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
            {!owner.salon
              ? t.verified
              : owner.salon.review?.rejectedAt
                ? t.ownerStatusRejected
                : owner.salon.isPublished
                  ? t.ownerStatusLive
                  : owner.salon.isVerified
                    ? t.ownerStatusVerified
                    : t.ownerStatusAwaiting}
          </div>
        </div>
        {/* The owner's way to change language. The portal followed whatever
            was chosen on the opening screen and offered no way to change it
            afterwards — an owner who came in English stayed in English. */}
        <div style={{ marginInlineStart: 'auto', flex: 'none' }}>
          <LangToggle variant="pill" />
        </div>
      </div>

      {/* Below the header, not inside its row, where it was squeezed into a
          narrow column beside the salon's name. */}
      <SampleDataNotice />

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

      {/* Which account this portal belongs to, and the way to change it. The
          portal only ever shows the salon the signed-in account owns, so an
          owner testing two salons — or a customer account and a salon
          account — needs to see who they are and to sign out from here,
          without going through the customer side to do it. */}
      <div
        style={{
          margin: '24px 24px 0',
          padding: '14px 16px',
          borderRadius: 14,
          background: color.surfaceWarm,
          border: `1px solid ${color.lineWarm}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
            {signedIn ? t.vendorSignedInAs : t.vendorSignedOut}
          </div>
          {signedIn ? (
            <div
              className="ltr-run"
              style={{
                font: `600 13px ${font.sans}`,
                color: color.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {accountLabel(session, isArabic)}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => (signedIn ? signOut() : dispatch({ type: 'openAuth', reason: 'vendor' }))}
          className="press"
          style={{
            flex: 'none',
            padding: '9px 14px',
            borderRadius: 12,
            ...(signedIn
              ? { border: `1.5px solid ${color.lineSand}`, color: color.danger, font: `600 12px ${font.sans}` }
              : { background: color.gold, color: color.goldInk, font: `700 12px ${font.sans}` }),
          }}
        >
          {signedIn ? t.authSignOut : t.authSignIn}
        </button>
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
