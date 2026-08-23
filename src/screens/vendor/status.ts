import type { AppointmentStatus } from '../../data/vendorBookings';
import type { Dictionary } from '../../i18n/en';

/** The booking's status in the reader's language. Every enum value has one. */
export function statusLabel(status: AppointmentStatus, t: Dictionary): string {
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
