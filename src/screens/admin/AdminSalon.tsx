import { Screen, ScreenHeader } from '../../components/Screen';
import { SheetModal } from '../../components/SheetModal';
import { dayLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import { REASON_MAX_LENGTH } from '../../data/admin';

/**
 * One salon, and the four decisions Saloni can make about it.
 *
 * The order on screen is the order the work happens in: read the commercial
 * registration, approve or turn down, then — separately — put it in front of
 * customers. Verifying and publishing are deliberately two taps, because they
 * are two different statements: one says this business is who it claims to be,
 * the other says customers should be able to book it.
 *
 * Turning down and closing both open the same sheet, because both need the
 * same thing: a sentence the owner will read. Neither is possible without one,
 * and that is enforced by the database rather than by this screen — see
 * migration 0021.
 */
export function AdminSalon() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    admin,
    adminVerify,
    adminPublish,
    adminReject,
    adminClose,
    adminSetRate,
  } = useApp();

  const salon = admin.salons.find((s) => s.id === state.adminSalonId) ?? null;

  // The register is re-read after every decision, so a salon can briefly be
  // absent while that is in flight, and is genuinely gone if it was opened
  // from a stale list.
  if (!salon) {
    return (
      <Screen>
        <ScreenHeader
          onBack={() => dispatch({ type: 'go', screen: 'a_queue' })}
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={t.adminTitle}
        />
        <p
          style={{
            padding: '22px 24px',
            font: `500 13px ${font.sans}`,
            color: color.mutedSoft,
            margin: 0,
          }}
        >
          {admin.source === 'loading' ? t.adminLoading : t.adminEmpty}
        </p>
      </Screen>
    );
  }

  const isClosed = salon.status === 'closed';
  const sheet = state.adminReasonSheet;
  const editingRate = state.adminRateForm !== null;
  // Basis points to a percentage the way a person writes it: 500 → "5".
  const ratePercent = (salon.commissionBps / 100).toFixed(salon.commissionBps % 100 === 0 ? 0 : 2);

  const rows: { label: string; value: string; mono?: boolean }[] = [
    {
      label: t.adminCr,
      value: salon.crNumber ?? t.adminCrNone,
      mono: Boolean(salon.crNumber),
    },
    { label: t.adminOwner, value: salon.ownerEmail ?? t.adminOwnerGone, mono: Boolean(salon.ownerEmail) },
    {
      label: t.adminRegistered,
      value: dayLabel(new Date(salon.registeredAt), isArabic ? 'ar' : 'en'),
    },
    {
      label: t.adminReviewedBy,
      value: salon.reviewedByEmail ?? t.adminNotReviewed,
      mono: Boolean(salon.reviewedByEmail),
    },
  ];

  return (
    <Screen bottomInset={24}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'a_queue' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={isArabic ? salon.nameAr : salon.name}
        subtitle={
          salon.status === 'awaiting'
            ? t.adminStatusAwaiting
            : salon.status === 'verified'
              ? t.adminStatusVerified
              : salon.status === 'live'
                ? t.adminStatusLive
                : salon.status === 'rejected'
                  ? t.adminStatusRejected
                  : t.adminStatusClosed
        }
      />

      <div style={{ padding: '20px 24px 0' }}>
        {/* The facts, then the decisions. The registration number is first
            because checking it is the whole reason this screen exists. */}
        <dl style={{ margin: 0, display: 'grid', gap: 11 }}>
          {rows.map((row) => (
            <div key={row.label}>
              <dt style={{ font: `600 10.5px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>
                {row.label.toUpperCase()}
              </dt>
              <dd
                style={{
                  margin: '2px 0 0',
                  font: row.mono
                    ? `600 13px ${font.mono}`
                    : `600 13px ${font.sans}`,
                  color: color.ink,
                  wordBreak: 'break-word',
                }}
              >
                {/* An e-mail address and a registration number are Latin runs
                    that would otherwise reorder inside Arabic — §4. */}
                {row.mono ? <span className="ltr-run">{row.value}</span> : row.value}
              </dd>
            </div>
          ))}
        </dl>

        {salon.status === 'awaiting' && salon.crNumber ? (
          <p
            style={{
              margin: '14px 0 0',
              padding: '10px 13px',
              borderRadius: 12,
              background: color.cream,
              border: `1px solid ${color.creamLine}`,
              font: `600 11.5px/1.5 ${font.sans}`,
              color: '#8a6d14',
            }}
          >
            {t.adminCrCheck}
          </p>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 9,
            marginTop: 16,
          }}
        >
          <Stat label={t.adminServicesLabel} value={salon.services} />
          <Stat label={t.adminTeamLabel} value={salon.team} />
          <Stat label={t.adminUpcomingLabel} value={salon.upcoming} />
        </div>

        {salon.rejectionReason ? (
          <Note
            title={`${t.adminRejectedOn}${salon.reviewedAt ? ` · ${dayLabel(new Date(salon.reviewedAt), isArabic ? 'ar' : 'en')}` : ''}`}
            body={salon.rejectionReason}
          />
        ) : null}

        {salon.closedReason && salon.closedAt ? (
          <Note
            title={`${t.adminClosedOn} · ${dayLabel(new Date(salon.closedAt), isArabic ? 'ar' : 'en')}`}
            body={salon.closedReason}
          />
        ) : null}

        {/* ---------------------------------------------------------------
            The commission rate. In no grant at all, so this screen is the
            only place in the app it can be read or changed.
            --------------------------------------------------------------- */}
        <section
          style={{
            marginTop: 18,
            padding: '14px 16px',
            borderRadius: 14,
            background: color.surfaceWarm,
            border: `1px solid ${color.lineWarm}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ font: `600 14px ${font.serif}`, color: color.ink, margin: 0 }}>
              {t.adminRate}
            </h2>
            {editingRate ? null : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="ltr-run" style={{ font: `700 15px ${font.sans}`, color: color.ink }}>
                  {ratePercent}%
                </span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'setAdminRateForm', value: ratePercent })}
                  className="press"
                  style={{
                    background: color.surfaceSand,
                    color: color.inkSoft,
                    borderRadius: 9,
                    padding: '6px 11px',
                    font: `700 11px ${font.sans}`,
                  }}
                >
                  {t.adminRateChange}
                </button>
              </span>
            )}
          </div>

          {editingRate ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <input
                id="admin-rate"
                value={state.adminRateForm ?? ''}
                onChange={(event) =>
                  dispatch({ type: 'setAdminRateForm', value: event.target.value })
                }
                inputMode="decimal"
                dir="ltr"
                aria-label={t.adminRate}
                style={{
                  width: 84,
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: `1px solid ${color.line}`,
                  background: color.surface,
                  font: `700 14px ${font.sans}`,
                  color: color.ink,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const percent = Number(state.adminRateForm);
                  if (!Number.isFinite(percent)) return;
                  // Percent to basis points. Rounded here as well as in the
                  // database, because 2.005 is not representable and a rate is
                  // a whole number of basis points by definition.
                  void adminSetRate(salon.id, Math.round(percent * 100));
                }}
                className="press"
                style={{
                  background: color.ink,
                  color: color.goldSoft,
                  borderRadius: 9,
                  padding: '8px 13px',
                  font: `700 11px ${font.sans}`,
                }}
              >
                {t.adminRateSave}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'setAdminRateForm', value: null })}
                style={{
                  color: color.mutedSoft,
                  padding: '8px 4px',
                  font: `600 11px ${font.sans}`,
                }}
              >
                {t.adminRateCancel}
              </button>
            </div>
          ) : null}

          <p
            style={{
              margin: '9px 0 0',
              font: `500 11.5px/1.6 ${font.sans}`,
              color: color.mutedSoft,
            }}
          >
            {t.adminRateHint}
          </p>
        </section>

        {/* ---------------------------------------------------------------
            The decisions.
            --------------------------------------------------------------- */}
        {isClosed ? null : (
          <div style={{ display: 'grid', gap: 9, marginTop: 18 }}>
            <Action
              label={salon.status === 'verified' || salon.status === 'live' ? t.adminUnapprove : t.adminApprove}
              tone={salon.status === 'verified' || salon.status === 'live' ? 'quiet' : 'primary'}
              onClick={() =>
                void adminVerify(salon.id, !(salon.status === 'verified' || salon.status === 'live'))
              }
            />

            <Action
              label={salon.status === 'live' ? t.adminUnpublish : t.adminPublish}
              tone={salon.status === 'live' ? 'quiet' : 'primary'}
              disabled={salon.status !== 'verified' && salon.status !== 'live'}
              hint={
                salon.status !== 'verified' && salon.status !== 'live'
                  ? t.adminPublishNeedsApproval
                  : salon.status === 'live'
                    ? t.adminUnpublishNote
                    : undefined
              }
              onClick={() => void adminPublish(salon.id, salon.status !== 'live')}
            />

            <Action
              label={t.adminRejectAction}
              tone="quiet"
              onClick={() => dispatch({ type: 'openAdminReason', kind: 'reject' })}
            />

            <Action
              label={t.adminCloseAction}
              tone="danger"
              onClick={() => dispatch({ type: 'openAdminReason', kind: 'close' })}
            />
          </div>
        )}
      </div>

      {sheet ? (
        <SheetModal
          title={sheet.kind === 'reject' ? t.adminReasonRejectTitle : t.adminReasonCloseTitle}
          cancelLabel={t.adminCancel}
          saveLabel={
            sheet.saving
              ? '…'
              : sheet.kind === 'reject'
                ? t.adminReasonRejectGo
                : t.adminReasonCloseGo
          }
          // A reason is required by the database too, so this is a courtesy
          // rather than the rule — but a button that fails is worse than one
          // that waits.
          saveDisabled={sheet.text.trim().length === 0 || sheet.saving}
          saveTone="danger"
          onCancel={() => dispatch({ type: 'closeAdminReason' })}
          onSave={() => {
            if (sheet.kind === 'reject') void adminReject(salon.id, sheet.text);
            else void adminClose(salon.id, sheet.text);
          }}
        >
          <p style={{ font: `500 12.5px/1.65 ${font.sans}`, color: color.inkSoft, margin: '0 0 12px' }}>
            {sheet.kind === 'reject' ? t.adminReasonRejectBody : t.adminReasonCloseBody}
          </p>

          {sheet.kind === 'close' && salon.upcoming > 0 ? (
            <p
              style={{
                margin: '0 0 12px',
                padding: '9px 12px',
                borderRadius: 11,
                background: '#fdeceb',
                border: '1px solid #f6d4d1',
                font: `700 11.5px/1.5 ${font.sans}`,
                color: color.danger,
              }}
            >
              {salon.upcoming} {t.adminReasonCloseCancels}
            </p>
          ) : null}

          <label
            htmlFor="admin-reason"
            style={{ display: 'block', font: `600 11px ${font.sans}`, color: color.mutedSoft }}
          >
            {t.adminReasonLabel}
          </label>
          <textarea
            id="admin-reason"
            value={sheet.text}
            onChange={(event) => dispatch({ type: 'setAdminReason', value: event.target.value })}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
            placeholder={t.adminReasonPlaceholder}
            style={{
              width: '100%',
              marginTop: 5,
              padding: '9px 11px',
              borderRadius: 10,
              border: `1px solid ${color.line}`,
              background: color.surface,
              font: `500 13px/1.5 ${font.sans}`,
              color: color.ink,
              resize: 'vertical',
            }}
          />
        </SheetModal>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: 12,
        background: color.surfaceSand,
        border: `1px solid ${color.lineSand}`,
      }}
    >
      <div style={{ font: `700 17px ${font.sans}`, color: color.ink }}>{value}</div>
      <div style={{ font: `600 10px ${font.sans}`, color: color.mutedSoft, marginTop: 1 }}>
        {label}
      </div>
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <section
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderRadius: 13,
        background: color.surfaceWarm,
        border: `1px solid ${color.lineWarm}`,
      }}
    >
      <h2 style={{ font: `700 11px ${font.sans}`, color: color.mutedSoft, margin: 0 }}>{title}</h2>
      {/* Written by an administrator and rendered as text, never as markup. */}
      <p style={{ font: `500 12.5px/1.6 ${font.sans}`, color: color.ink, margin: '4px 0 0' }}>
        {body}
      </p>
    </section>
  );
}

interface ActionProps {
  label: string;
  tone: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}

function Action({ label, tone, disabled = false, hint, onClick }: ActionProps) {
  const style =
    tone === 'primary'
      ? { background: color.ink, color: color.goldSoft }
      : tone === 'danger'
        ? { background: '#fdeceb', color: color.danger, border: '1px solid #f6d4d1' }
        : { background: color.surfaceSand, color: color.inkSoft };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="press"
        style={{
          width: '100%',
          borderRadius: 12,
          padding: '12px 15px',
          font: `700 13px ${font.sans}`,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          ...style,
        }}
      >
        {label}
      </button>
      {hint ? (
        <p style={{ margin: '5px 2px 0', font: `500 11px/1.5 ${font.sans}`, color: color.mutedSoft }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
