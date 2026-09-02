import { SheetModal } from '../../components/SheetModal';
import type { AppointmentStatus, SalonAppointment } from '../../data/vendorBookings';
import type { Dictionary } from '../../i18n/en';
import { useApp } from '../../state/context';
import { bookingStatus, color, font } from '../../theme';
import { statusLabel } from './status';

/**
 * What the salon may do to an appointment from where it currently stands.
 *
 * This is presentation, not enforcement: the boundary is 0006's
 * `bookings_status_transition` trigger in the database, and the write reports
 * back whatever Postgres decided. Offering only the sensible next steps just
 * saves the owner tapping something that will be refused — a finished or
 * cancelled appointment has nowhere left to go.
 */
function nextStatuses(status: AppointmentStatus): AppointmentStatus[] {
  switch (status) {
    case 'pending':
      return ['confirmed', 'cancelled'];
    case 'confirmed':
      return ['in_progress', 'completed', 'no_show', 'cancelled'];
    case 'in_progress':
      return ['completed', 'no_show'];
    case 'completed':
    case 'cancelled':
    case 'no_show':
      return [];
  }
}

function actionLabel(status: AppointmentStatus, t: Dictionary): string {
  switch (status) {
    case 'confirmed':
      return t.apptConfirm;
    case 'in_progress':
      return t.apptStart;
    case 'completed':
      return t.apptComplete;
    case 'no_show':
      return t.apptNoShow;
    case 'cancelled':
      return t.apptCancel;
    case 'pending':
      return t.statusPending;
  }
}

/** The sheet an owner gets by tapping an appointment on the calendar. */
export function AppointmentSheet() {
  const { t, state, dispatch, isArabic, owner, vendorDay, setAppointment, reassignTo } = useApp();

  const appointment = vendorDay.appointments.find((row) => row.id === state.apptSheet);
  if (!appointment) return null;

  const close = () => dispatch({ type: 'closeAppointment' });
  const moves = nextStatuses(appointment.status);
  const team = owner.salon?.staff.filter((person) => person.isActive) ?? [];

  return (
    <SheetModal
      title={t.apptActions}
      cancelLabel={t.apptClose}
      // Nothing to submit: every action here writes on its own tap.
      saveLabel={null}
      onCancel={close}
      onSave={close}
    >
      <Summary appointment={appointment} isArabic={isArabic} t={t} />

      {moves.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {moves.map((status) => (
            <Action
              key={status}
              label={actionLabel(status, t)}
              tone={status === 'cancelled' || status === 'no_show' ? 'danger' : 'normal'}
              onClick={() => void setAppointment(appointment.id, status)}
            />
          ))}
        </div>
      ) : null}

      {/* Reassigning a finished appointment would rewrite history, so it is
          offered only while the appointment is still ahead of the salon. */}
      {moves.length > 0 && team.length > 0 ? (
        <>
          <div
            style={{
              font: `700 10.5px ${font.sans}`,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: color.mutedSoft,
              margin: '4px 0 8px',
            }}
          >
            {t.apptReassign}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {team.map((person) => {
              const name = isArabic ? person.nameAr : person.name;
              const current = name === (isArabic ? appointment.staffNameAr : appointment.staffName);
              return (
                <Chip
                  key={person.id}
                  label={name}
                  active={current}
                  onClick={() => void reassignTo(appointment.id, person.id)}
                />
              );
            })}
            <Chip
              label={t.apptAnyone}
              active={appointment.staffName == null}
              onClick={() => void reassignTo(appointment.id, null)}
            />
          </div>
        </>
      ) : null}
    </SheetModal>
  );
}

function Summary({
  appointment,
  isArabic,
  t,
}: {
  appointment: SalonAppointment;
  isArabic: boolean;
  t: Dictionary;
}) {
  const services = isArabic ? appointment.servicesAr : appointment.services;
  const tone = bookingStatus[appointment.status];

  return (
    <div
      style={{
        background: tone.bg,
        borderInlineStart: `3px solid ${tone.dot}`,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {/* <bdi> because the name's script is the customer's, not the app's — see appointment.tsx. */}
        <bdi style={{ font: `600 14px ${font.sans}` }}>
          {appointment.customerName ?? (
            <span className="ltr-run" style={{ fontFamily: font.mono, fontSize: 13 }}>
              {appointment.reference}
            </span>
          )}
        </bdi>
        <span
          style={{
            font: `600 10px ${font.sans}`,
            color: color.muted,
            background: 'rgba(255,255,255,.7)',
            padding: '3px 8px',
            borderRadius: 8,
            height: 'fit-content',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          {statusLabel(appointment.status, t)}
        </span>
      </div>
      <div style={{ font: `500 11.5px ${font.sans}`, color: color.muted, marginTop: 4 }}>
        {/* Times are a Latin run and reorder inside Arabic without isolating. */}
        <span className="ltr-run">
          {appointment.time}–{appointment.endTime}
        </span>
        {services.length > 0 ? ` · ${services.join(' · ')}` : ''}
      </div>
      <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft, marginTop: 3 }}>
        {(isArabic ? appointment.staffNameAr : appointment.staffName) ?? t.anyProfessional}
        {appointment.isWalkIn ? ` · ${t.walkInBadge}` : ''}
      </div>
      {/*
        Only ever a number the salon typed in itself when it took the booking.
        A customer's own phone number is never handed over — salon_day() returns
        nothing from their profile but the name they chose to give.
      */}
      {appointment.customerPhone ? (
        <a
          href={`tel:${appointment.customerPhone}`}
          className="ltr-run"
          style={{
            display: 'inline-block',
            font: `600 11.5px ${font.mono}`,
            color: color.goldLink,
            marginTop: 5,
          }}
        >
          {appointment.customerPhone}
        </a>
      ) : null}
    </div>
  );
}

function Action({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'normal' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press"
      style={{
        width: '100%',
        textAlign: 'center',
        padding: 13,
        borderRadius: 12,
        border: `1.5px solid ${tone === 'danger' ? '#f0cdc7' : color.lineSand}`,
        background: tone === 'danger' ? '#fdf0ee' : color.surface,
        color: tone === 'danger' ? color.danger : color.ink,
        font: `700 13px ${font.sans}`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="press"
      style={{
        padding: '8px 13px',
        borderRadius: 20,
        border: `1.5px solid ${active ? color.gold : color.lineWarm}`,
        background: active ? color.cream : color.surface,
        color: active ? color.goldInk : color.ink,
        font: `600 12px ${font.sans}`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
