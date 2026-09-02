import type { SalonAppointment } from '../../data/vendorBookings';
import type { Dictionary } from '../../i18n/en';
import { color, font } from '../../theme';
import { statusLabel } from './status';

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
          /*
            <bdi> rather than a plain span, and rather than .ltr-run. A name is
            the one string here whose script is unknown: "Huda A." set loose in
            an Arabic paragraph renders as ".Huda A", the trailing full stop
            reordered onto the front — and .ltr-run would fix that by forcing
            LTR, which is then wrong for "ليلى ع." beside it. <bdi> isolates the
            run and takes its direction from the text itself, which is exactly
            the question being asked. Walk-ins made this everyday: the owner
            types the name, in either script, on a screen in either language.
          */
          <bdi style={{ font: `600 14px ${font.sans}` }}>{appointment.customerName}</bdi>
        ) : (
          /*
            No name given, so the booking reference stands in for one. It is
            shown bare: prefixing it with "Booking ref" pushed the status chip
            off the card in Arabic, and a salon owner reading "SL-M8T1Z4" where
            a name belongs needs no label to know what it is. Isolated and kept
            on one line — an LTR run that wraps lays its halves out separately
            and the reference comes back scrambled.
          */
          <span
            className="ltr-run"
            style={{
              font: `600 13px ${font.mono}`,
              color: color.inkSoft,
              whiteSpace: 'nowrap',
            }}
          >
            {appointment.reference}
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
            // Never squeezed out by a long name or reference beside it.
            flex: 'none',
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
        {/*
          Worth marking. The salon wrote this one itself, so nobody is coming
          through the app for it: no push, no reminder, and no cancelling from a
          phone — the salon is the only party that knows about it.
        */}
        {appointment.isWalkIn ? ` · ${t.walkInBadge}` : ''}
      </div>
    </>
  );
}
