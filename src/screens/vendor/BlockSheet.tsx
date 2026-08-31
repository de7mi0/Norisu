import { SheetModal } from '../../components/SheetModal';
import { TimeSelect } from '../../components/TimeSelect';
import { toRiyadhDate } from '../../data/availability';
import { REASON_MAX_LENGTH } from '../../data/timeOff';
import { useApp, dateAtOffset } from '../../state/context';
import { color, font } from '../../theme';

/**
 * Taking a period off sale.
 *
 * The case this exists for is immediate: the customer in the chair is running
 * over, and the next hour has to stop being offered before somebody books it.
 * So it opens on a sensible range and asks for as little as possible — who,
 * from, until, and an optional note the owner alone sees.
 *
 * "The whole salon" is the default rather than a particular person, because the
 * common reason to reach for this is the shop as a whole, and picking one
 * stylist when you meant all of them is the mistake that would cost a booking.
 */
export function BlockSheet() {
  const { t, state, dispatch, isArabic, owner, blockTime } = useApp();

  const sheet = state.blockSheet;
  if (!sheet) return null;

  const staff = (owner.salon?.staff ?? []).filter((member) => member.isActive);
  const close = () => dispatch({ type: 'closeBlockSheet' });

  const set = (field: 'staffId' | 'from' | 'to' | 'reason', value: string) =>
    dispatch({ type: 'setBlockField', field, value });

  // The day being looked at on the calendar, not today: an owner blocking
  // tomorrow morning is doing so from tomorrow's page.
  const day = dateAtOffset(state.vDay);

  /**
   * "13:00" on that day, in the salon's time — not the phone's.
   *
   * setHours() would use the device's timezone, which is wrong the moment the
   * owner is anywhere but Riyadh, and was wrong in the test container too: a
   * block entered as 13:00 came back as 16:00. Everything else here already
   * reasons in Asia/Riyadh — available_slots(), the day strip, the times on
   * screen — so a picker that quietly meant something else would put a salon
   * out of action for the wrong hour.
   *
   * The offset is fixed because Saudi Arabia does not observe daylight saving,
   * which is the same assumption the rest of the app makes.
   */
  const at = (time: string) => new Date(`${toRiyadhDate(day)}T${time}:00+03:00`);

  return (
    <SheetModal
      title={t.blockTitle}
      cancelLabel={t.cancel}
      saveLabel={sheet.saving ? `${t.blockSave}…` : t.blockSave}
      onCancel={close}
      onSave={() => {
        if (sheet.saving) return;
        void blockTime(sheet.staffId || null, at(sheet.from), at(sheet.to), sheet.reason);
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
        {t.blockHelp}
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span
          style={{
            display: 'block',
            font: `500 10px ${font.sans}`,
            color: color.mutedFaint,
            marginBottom: 3,
          }}
        >
          {t.blockWho}
        </span>
        <select
          value={sheet.staffId}
          disabled={sheet.saving}
          onChange={(event) => set('staffId', event.target.value)}
          style={{
            width: '100%',
            padding: '9px 10px',
            borderRadius: 10,
            border: `1.5px solid ${color.lineWarm}`,
            background: color.surfaceWarm,
            font: `600 12.5px ${font.sans}`,
            color: color.ink,
          }}
        >
          <option value="">{t.blockWhole}</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {isArabic ? member.nameAr : member.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
        <TimeSelect
          label={t.blockFrom}
          value={sheet.from}
          disabled={sheet.saving}
          onChange={(value) => set('from', value)}
        />
        <span style={{ color: color.mutedFaint, paddingBottom: 9 }}>–</span>
        <TimeSelect
          label={t.blockTo}
          value={sheet.to}
          disabled={sheet.saving}
          onChange={(value) => set('to', value)}
        />
      </div>

      <label style={{ display: 'block' }}>
        <span
          style={{
            display: 'block',
            font: `500 10px ${font.sans}`,
            color: color.mutedFaint,
            marginBottom: 3,
          }}
        >
          {t.blockReason}
        </span>
        <input
          type="text"
          value={sheet.reason}
          disabled={sheet.saving}
          maxLength={REASON_MAX_LENGTH}
          onChange={(event) => set('reason', event.target.value)}
          style={{
            width: '100%',
            padding: '9px 10px',
            borderRadius: 10,
            border: `1.5px solid ${color.lineWarm}`,
            background: color.surfaceWarm,
            font: `500 12.5px ${font.sans}`,
            color: color.ink,
          }}
        />
        <span
          style={{
            display: 'block',
            font: `500 10px ${font.sans}`,
            color: color.mutedFaint,
            marginTop: 4,
          }}
        >
          {t.blockReasonHint}
        </span>
      </label>
    </SheetModal>
  );
}
