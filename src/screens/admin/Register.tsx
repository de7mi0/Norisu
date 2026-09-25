import { Screen } from '../../components/Screen';
import { dayLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { AdminSalon, AdminStatus } from '../../data/admin';

/**
 * Saloni's register: every salon on the platform, the ones awaiting a decision
 * first.
 *
 * This screen replaces opening the Supabase table editor, which is what
 * approving a salon meant until now. The ordering is the database's, because
 * the order somebody works through these in is most of what the register is
 * for — and because two people sharing the job need the same order, not
 * whichever one their browser happened to sort by.
 */

/** Colour per state. Awaiting is the only one that asks for anything. */
function toneFor(status: AdminStatus): { bg: string; fg: string; line: string } {
  switch (status) {
    case 'awaiting':
      return { bg: color.cream, fg: '#8a6d14', line: color.creamLine };
    case 'live':
      return { bg: color.tealSoft, fg: color.teal, line: color.tealLine };
    case 'rejected':
      return { bg: '#fdeceb', fg: color.danger, line: '#f6d4d1' };
    case 'closed':
      return { bg: color.surfaceSand, fg: color.mutedSoft, line: color.line };
    default:
      return { bg: color.surfaceWarm, fg: color.inkSoft, line: color.lineWarm };
  }
}

export function AdminRegister() {
  const { t, isArabic, dispatch, admin } = useApp();

  const label: Record<AdminStatus, string> = {
    awaiting: t.adminStatusAwaiting,
    verified: t.adminStatusVerified,
    live: t.adminStatusLive,
    rejected: t.adminStatusRejected,
    closed: t.adminStatusClosed,
  };

  const awaiting = admin.salons.filter((s) => s.status === 'awaiting').length;

  return (
    <Screen>
      <div style={{ padding: '56px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ font: `600 26px ${font.serif}`, color: color.ink, margin: 0 }}>
              {t.adminTitle}
            </h1>
            <p style={{ font: `500 12px ${font.sans}`, color: color.mutedSoft, margin: '4px 0 0' }}>
              {t.adminSub}
            </p>
          </div>
          {/* The way out. An administrator is a customer too, and the back
              office is not somewhere to get stuck. */}
          <button
            type="button"
            onClick={() => dispatch({ type: 'pickMode', mode: 'customer' })}
            className="press"
            style={{
              flex: 'none',
              background: color.surfaceSand,
              color: color.inkSoft,
              borderRadius: 10,
              padding: '7px 12px',
              font: `700 11px ${font.sans}`,
            }}
          >
            {t.adminLeave}
          </button>
        </div>

        {admin.source === 'live' ? (
          <div
            style={{
              marginTop: 16,
              padding: '10px 13px',
              borderRadius: 12,
              background: awaiting > 0 ? color.cream : color.surfaceWarm,
              border: `1px solid ${awaiting > 0 ? color.creamLine : color.lineWarm}`,
              font: `600 12px ${font.sans}`,
              color: awaiting > 0 ? '#8a6d14' : color.mutedSoft,
            }}
          >
            {awaiting > 0 ? `${awaiting} ${t.adminAwaitingLabel}` : t.adminNothingWaiting}
          </div>
        ) : null}
      </div>

      <div style={{ padding: '14px 24px 28px' }}>
        {admin.source === 'loading' ? (
          <p style={{ font: `500 13px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.adminLoading}
          </p>
        ) : admin.source === 'denied' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.danger, margin: 0 }}>
            {t.adminDenied}
          </p>
        ) : admin.source === 'demo' ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.adminNoBackend}
          </p>
        ) : admin.source === 'error' ? (
          // Never an empty list. "No salon has registered" and "we could not
          // ask" are very different things to tell somebody running a platform.
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.danger, margin: 0 }}>
            {t.adminLoadFailed}
          </p>
        ) : admin.salons.length === 0 ? (
          <p style={{ font: `500 13px/1.6 ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
            {t.adminEmpty}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9 }}>
            {admin.salons.map((salon) => (
              <li key={salon.id}>
                <SalonRow salon={salon} statusLabel={label[salon.status]} isArabic={isArabic} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

interface SalonRowProps {
  salon: AdminSalon;
  statusLabel: string;
  isArabic: boolean;
}

function SalonRow({ salon, statusLabel, isArabic }: SalonRowProps) {
  const { dispatch, t, chevron } = useApp();
  const tone = toneFor(salon.status);

  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'openAdminSalon', salonId: salon.id })}
      className="press"
      style={{
        width: '100%',
        textAlign: isArabic ? 'right' : 'left',
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        padding: '13px 15px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            font: `700 14px ${font.sans}`,
            color: color.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {isArabic ? salon.nameAr : salon.name}
        </span>
        <span
          style={{
            display: 'inline-block',
            marginTop: 6,
            padding: '3px 8px',
            borderRadius: 999,
            background: tone.bg,
            border: `1px solid ${tone.line}`,
            color: tone.fg,
            font: `700 10px ${font.sans}`,
          }}
        >
          {statusLabel}
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 6,
            font: `500 11px ${font.sans}`,
            color: color.mutedSoft,
          }}
        >
          {t.adminRegistered}
          {': '}
          {/* Through the i18n helper, never toLocaleDateString here — §4. */}
          {dayLabel(new Date(salon.registeredAt), isArabic ? 'ar' : 'en')}
        </span>
      </span>
      <span style={{ flex: 'none', fontSize: 20, color: color.mutedSoft }} aria-hidden="true">
        {chevron}
      </span>
    </button>
  );
}
