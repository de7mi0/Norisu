import { dayLabel } from '../i18n';
import { useApp } from '../state/context';
import { color, font } from '../theme';

/**
 * Says plainly when the vendor portal is showing the sample salon rather than
 * the viewer's own.
 *
 * The portal is deliberately still browsable signed out — it is how the demo is
 * shown to people — but a signed-in owner must never mistake sample numbers for
 * their own takings, so the reason is named rather than implied.
 */
interface SampleDataNoticeProps {
  /**
   * Marks one section whose figures are still invented even when the rest of
   * the portal is the owner's own. Without it a real owner would read sample
   * takings as their own, which is worse than an unlabelled demo.
   */
  section?: 'dashboard' | 'schedule' | 'reviews' | 'waitlist';
}

export function SampleDataNotice({ section }: SampleDataNoticeProps = {}) {
  const { owner, isArabic, dispatch, t } = useApp();

  const sectionCopy: Record<string, { en: string; ar: string }> = {
    dashboard: {
      // Both the tiles above and the schedule below are invented, so this says
      // so once rather than sitting ambiguously between them.
      en: 'The figures above and the schedule below are still sample data — your real takings and appointments aren’t shown here yet.',
      ar: 'الأرقام أعلاه والجدول أدناه تجريبية — إيراداتك ومواعيدك الفعلية لا تظهر هنا بعد.',
    },
    schedule: {
      en: 'This schedule is still sample data — your real appointments aren’t shown here yet.',
      ar: 'هذا الجدول تجريبي — مواعيدك الفعلية لا تظهر هنا بعد.',
    },
    reviews: {
      en: 'These reviews are still sample data.',
      ar: 'هذه المراجعات تجريبية.',
    },
    waitlist: {
      en: 'This waitlist is still sample data and is not saved.',
      ar: 'قائمة الانتظار هذه تجريبية ولا تُحفظ.',
    },
  };

  // Their own salon is on screen. Most of the portal then needs no notice, but
  // a section still running on invented numbers must say so.
  if (owner.status === 'live') {
    if (!section) return null;
    const note = sectionCopy[section];
    return (
      <div
        style={{
          margin: '14px 24px 0',
          background: color.surfaceWarm,
          border: `1px dashed ${color.lineWarm}`,
          borderRadius: 12,
          padding: '9px 12px',
          font: `600 11px/1.45 ${font.sans}`,
          color: color.mutedSoft,
        }}
      >
        {isArabic ? note.ar : note.en}
      </div>
    );
  }
  // Still asking. A banner that flickers in and out reads as a fault.
  if (owner.status === 'loading') return null;

  // Somebody who closed their own salon. They own none, like the cases below,
  // but "this account doesn't own one yet" is the wrong sentence for them in
  // every word — and this is the one place they find out that the salon under
  // this notice is not theirs. It was a real report: close the shop, come
  // back, and the portal shows a salon again.
  if (owner.status === 'closed' && owner.closed) {
    const { closed } = owner;
    return (
      <div
        style={{
          margin: '14px 24px 0',
          background: color.cream,
          border: `1px solid ${color.creamLine}`,
          borderRadius: 12,
          padding: '12px 14px',
        }}
      >
        <div style={{ font: `700 12px ${font.sans}`, color: '#8a6d14' }}>
          {t.closedPortalTitle}
        </div>
        <div
          style={{
            font: `600 11.5px ${font.sans}`,
            color: color.inkSoft,
            marginTop: 3,
          }}
        >
          {isArabic ? closed.nameAr : closed.name}
          {' · '}
          {/* Through the i18n helper, never toLocaleDateString here — §4. */}
          <span>{dayLabel(new Date(closed.closedAt), isArabic ? 'ar' : 'en')}</span>
        </div>
        <p
          style={{
            font: `500 11.5px/1.5 ${font.sans}`,
            color: color.mutedSoft,
            margin: '7px 0 0',
          }}
        >
          {t.closedPortalBody}
        </p>
        <button
          type="button"
          onClick={() => dispatch({ type: 'goOnboarding', from: 'v_more' })}
          className="press"
          style={{
            marginTop: 9,
            background: color.ink,
            color: color.goldSoft,
            borderRadius: 10,
            padding: '7px 12px',
            font: `700 11px ${font.sans}`,
          }}
        >
          {t.closedPortalOpenAgain}
        </button>
      </div>
    );
  }

  const copy: Record<string, { en: string; ar: string }> = {
    unavailable: {
      en: 'Sample salon — no database is connected, so nothing here is saved.',
      ar: 'صالون تجريبي — لا توجد قاعدة بيانات متصلة، ولا يُحفظ أي شيء هنا.',
    },
    signedOut: {
      en: 'Sample salon. Sign in as a salon owner to manage your own.',
      ar: 'صالون تجريبي. سجّل الدخول كمالك صالون لإدارة صالونك.',
    },
    none: {
      en: 'Sample salon — this account doesn’t own one yet.',
      ar: 'صالون تجريبي — هذا الحساب لا يملك صالوناً بعد.',
    },
    // Reached only if my_closed_salon() could not answer — the name is then
    // unknown, but "yet" would still be wrong, so it is not used.
    closed: {
      en: 'Sample salon — you closed yours, so this one is not your own.',
      ar: 'صالون تجريبي — لقد أغلقت صالونك، لذا هذا ليس صالونك.',
    },
    error: {
      en: 'Sample salon — we couldn’t reach your salon just now.',
      ar: 'صالون تجريبي — تعذّر الوصول إلى صالونك الآن.',
    },
  };

  const message = copy[owner.status] ?? copy.error;

  return (
    <div
      style={{
        margin: '14px 24px 0',
        background: color.cream,
        border: `1px solid ${color.creamLine}`,
        borderRadius: 12,
        padding: '11px 13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <span style={{ font: `600 11.5px/1.45 ${font.sans}`, color: '#8a6d14' }}>
        {isArabic ? message.ar : message.en}
      </span>
      {owner.status === 'signedOut' ? (
        <button
          type="button"
          onClick={() => dispatch({ type: 'openAuth', reason: 'vendor' })}
          className="press"
          style={{
            flex: 'none',
            background: color.ink,
            color: color.goldSoft,
            borderRadius: 10,
            padding: '7px 12px',
            font: `700 11px ${font.sans}`,
          }}
        >
          {isArabic ? 'تسجيل الدخول' : 'Sign in'}
        </button>
      ) : null}
    </div>
  );
}
