import { SheetModal } from '../../components/SheetModal';
import { TimeSelect } from '../../components/TimeSelect';
import { toRiyadhDate } from '../../data/availability';
import {
  GUEST_NAME_MAX_LENGTH,
  GUEST_PHONE_MAX_LENGTH,
} from '../../data/vendorBookings';
import { useApp, dateAtOffset } from '../../state/context';
import { color, font } from '../../theme';

/**
 * The salon writing a booking of its own.
 *
 * Somebody walks in, or rings up. They have no account and there is nothing to
 * sign them into — so the owner writes it down, exactly as they would in the
 * paper book, and the app stops being a second system to keep in step.
 *
 * **This is not a way to book without signing in.** A customer still cannot
 * create a booking at all: `authenticated` has no INSERT on `bookings`, and the
 * function behind this sheet refuses anybody who is not the salon's own owner.
 * What is written here belongs to the salon, not to the person named on it —
 * they never see it and cannot cancel it.
 *
 * Everything except the name is optional, because the moment this is used is
 * the moment somebody is standing at the counter waiting.
 */
export function WalkInSheet() {
  const { t, state, dispatch, isArabic, owner, addWalkIn, money } = useApp();

  const sheet = state.walkInSheet;
  if (!sheet) return null;

  const salon = owner.salon;
  const staff = (salon?.staff ?? []).filter((member) => member.isActive);
  // Archived services are gone; hidden ones are not, and the database accepts
  // them here on purpose — a salon can still do something it has stopped
  // advertising.
  const services = salon?.services ?? [];

  const close = () => dispatch({ type: 'closeWalkInSheet' });
  const set = (field: 'name' | 'phone' | 'staffId' | 'at', value: string) =>
    dispatch({ type: 'setWalkInField', field, value });

  const chosen = services.filter((service) => sheet.serviceIds.includes(service.id));
  // The exact stored figures are absent only on the bundled demo services,
  // which have no real salon to be booked into anyway; the rounded display
  // price stands in there so the preview still reads sensibly.
  const minutes = chosen.reduce((sum, service) => sum + (service.durationMinutes ?? 0), 0);
  // What this will come to. Priced again in Postgres from these same rows, so
  // it is a preview of that figure and never an input to it — as with a
  // customer's booking, the browser states no prices.
  const halalas = chosen.reduce(
    (sum, service) =>
      sum +
      Math.round(((service.priceHalalas ?? service.price * 100) * (100 - service.discount)) / 100),
    0,
  );

  // The day on the calendar, not today: an owner writing up tomorrow's phone
  // booking is doing it from tomorrow's page.
  const day = dateAtOffset(state.vDay);
  // Built with an explicit +03:00 rather than setHours(), which would use the
  // device's timezone — the bug BlockSheet was fixed for. Saudi Arabia does not
  // observe daylight saving, which is the assumption the rest of the app makes.
  const at = new Date(`${toRiyadhDate(day)}T${sheet.at}:00+03:00`);

  const fieldStyle = {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 10,
    border: `1.5px solid ${color.lineWarm}`,
    background: color.surfaceWarm,
    font: `500 12.5px ${font.sans}`,
    color: color.ink,
  } as const;

  const labelStyle = {
    display: 'block',
    font: `500 10px ${font.sans}`,
    color: color.mutedFaint,
    marginBottom: 3,
  } as const;

  return (
    <SheetModal
      title={t.walkInTitle}
      cancelLabel={t.cancel}
      saveLabel={sheet.saving ? `${t.walkInSave}…` : t.walkInSave}
      onCancel={close}
      onSave={() => {
        if (sheet.saving) return;
        void addWalkIn({
          staffId: sheet.staffId || null,
          serviceIds: sheet.serviceIds,
          startsAt: at,
          guestName: sheet.name,
          guestPhone: sheet.phone,
        });
      }}
    >
      <div
        style={{
          background: color.cream,
          border: `1px solid ${color.creamLine}`,
          borderRadius: 12,
          padding: '11px 13px',
          marginBottom: 14,
          font: `500 11.5px/1.55 ${font.sans}`,
          color: '#8a6d14',
        }}
      >
        {t.walkInHelp}
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={labelStyle}>{t.walkInName}</span>
        <input
          type="text"
          value={sheet.name}
          disabled={sheet.saving}
          maxLength={GUEST_NAME_MAX_LENGTH}
          placeholder={t.walkInNamePlaceholder}
          onChange={(event) => set('name', event.target.value)}
          style={fieldStyle}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={labelStyle}>{t.walkInPhone}</span>
        <input
          type="tel"
          value={sheet.phone}
          disabled={sheet.saving}
          maxLength={GUEST_PHONE_MAX_LENGTH}
          onChange={(event) => set('phone', event.target.value)}
          // A phone number is a Latin-digit run: left to the paragraph's
          // direction it reorders inside Arabic, the same reason .ltr-run
          // exists for prices and references.
          dir="ltr"
          style={{ ...fieldStyle, textAlign: isArabic ? 'end' : 'start' }}
        />
        <span style={{ ...labelStyle, marginBottom: 0, marginTop: 4 }}>{t.walkInPhoneHint}</span>
      </label>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <label style={{ display: 'block', flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>{t.walkInWho}</span>
          <select
            value={sheet.staffId}
            disabled={sheet.saving}
            onChange={(event) => set('staffId', event.target.value)}
            style={{ ...fieldStyle, font: `600 12.5px ${font.sans}` }}
          >
            <option value="">{t.walkInAnyone}</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {isArabic ? member.nameAr : member.name}
              </option>
            ))}
          </select>
        </label>
        <TimeSelect
          label={t.walkInWhen}
          value={sheet.at}
          disabled={sheet.saving}
          onChange={(value) => set('at', value)}
        />
      </div>

      <span style={labelStyle}>{t.walkInServices}</span>
      {services.length === 0 ? (
        <p style={{ font: `500 11.5px ${font.sans}`, color: color.muted, margin: '2px 0 0' }}>
          {t.walkInNoServices}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {services.map((service) => {
            const picked = sheet.serviceIds.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                disabled={sheet.saving}
                aria-pressed={picked}
                onClick={() => dispatch({ type: 'toggleWalkInService', serviceId: service.id })}
                className="press"
                style={{
                  padding: '7px 11px',
                  borderRadius: 20,
                  border: `1.5px solid ${picked ? color.ink : color.lineSand}`,
                  background: picked ? color.ink : color.surfaceWarm,
                  color: picked ? '#fff' : color.inkSoft,
                  font: `600 11.5px ${font.sans}`,
                }}
              >
                {isArabic ? service.ar : service.name}
              </button>
            );
          })}
        </div>
      )}

      {chosen.length > 0 ? (
        <p
          style={{
            font: `500 11.5px ${font.sans}`,
            color: color.muted,
            margin: '10px 0 0',
          }}
        >
          <span className="ltr-run">{minutes}</span> {t.minutesShort} ·{' '}
          <span className="ltr-run">{money(Math.round(halalas / 100))}</span>
        </p>
      ) : null}
    </SheetModal>
  );
}
