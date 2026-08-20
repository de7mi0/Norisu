import type { SalonAppointment } from '../../data/vendorBookings';
import type { Dictionary } from '../../i18n/en';
import { color, font } from '../../theme';

/** The booking's status in the reader's language. Every enum value has one. */
function statusLabel(status: SalonAppointment['status'], t: Dictionary): string {
  switch (status) {
    case 'pending':
      return t.statusPending;
    case 'confirmed':
      return t.statusConfirmed;
    case 'in_progress':
      return t.statusInProgress;
    case 'completed':
      return t.statusCompleted;
    case 'cancelled':
      return t.statusCancelled;
    case 'no_show':
      return t.statusNoShow;
  }
}

/**
 * One appointment's text, shared by the calendar and the dashboard so the two
 * cannot drift apart on how they identify a customer.
 *
 * Three fallbacks matter here, and all three are honest rather than invented:
 * a customer who has never given a name is shown by booking reference, because
 * the database deliberately hands over no e-mail or phone to fill the gap; an
 * unassigned booking says "any professional" rather than naming somebody; and a
 * booking whose items are gone lists no services rather than guessing.
 */
export function AppointmentRow({
  appointment,
  isArabic,
  t,
}: {
  appointment: SalonAppointment;
  isArabic: boolean;
  t: Dictionary;
}) {
  const services = isArabic ? appointment.servicesAr : appointment.services;
  const staff = isArabic ? appointment.staffNameAr : appointment.staffName;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {appointment.customerName ? (
          <span style={{ font: `600 14px ${font.sans}` }}>{appointment.customerName}</span>
        ) : (
          <span style={{ font: `600 13px ${font.sans}`, color: color.inkSoft }}>
            {t.bookingRef}{' '}
            {/* A Latin reference inside an Arabic line reorders without this. */}
            <span className="ltr-run">{appointment.reference}</span>
          </span>
        )}
        <span
          style={{
            font: `600 10px ${font.sans}`,
            color: color.muted,
            background: 'rgba(255,255,255,.7)',
            padding: '3px 8px',
            borderRadius: 8,
            height: 'fit-content',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel(appointment.status, t)}
        </span>
      </div>
      {services.length > 0 ? (
        <div style={{ font: `500 11px ${font.sans}`, color: color.muted, marginTop: 3 }}>
          {services.join(' · ')}
        </div>
      ) : null}
      <div style={{ font: `500 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 4 }}>
        {staff ?? t.anyProfessional}
      </div>
    </>
  );
}
