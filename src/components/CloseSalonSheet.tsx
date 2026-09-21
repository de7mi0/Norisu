import { SheetModal } from './SheetModal';
import { useApp } from '../state/context';
import { color, font } from '../theme';

/**
 * Closing a salon, for good.
 *
 * This exists because of a store requirement rather than a feature request.
 * Both stores demand account deletion from inside the app, and
 * `delete_my_account()` (0016) refuses anybody who owns a salon — correctly,
 * because a salon holds other people's appointments. Until closing existed
 * that refusal was a dead end, and a reviewer who registered a salon and then
 * tried to delete their account would have read it as the requirement being
 * missing.
 *
 * It asks twice, like `DeleteAccountSheet` and for the same reason: this
 * cannot be undone from inside the app, and a mis-tap on a phone is otherwise
 * all it takes to shut a business.
 *
 * The three paragraphs are deliberately in this order — what stops, what
 * survives, what it means — because "are you sure?" is not consent to
 * something nobody has been told. What survives matters most to an owner who
 * fears losing their records, and it is the half a confirmation dialog
 * normally leaves out.
 */
export function CloseSalonSheet() {
  const { t, state, dispatch, closeMySalon } = useApp();

  const sheet = state.closeSheet;
  if (!sheet) return null;

  // Compared case-insensitively but shown in capitals, and Latin in both
  // languages — the same call DeleteAccountSheet makes. Asking somebody to
  // type an Arabic word on a keyboard that may be set to English is worse
  // than asking for an English one.
  const confirmed = sheet.typed.trim().toUpperCase() === t.closeConfirmWord;

  return (
    <SheetModal
      title={t.closeTitle}
      cancelLabel={t.cancel}
      saveLabel={sheet.saving ? `${t.closeGo}…` : t.closeGo}
      saveDisabled={!confirmed || sheet.saving}
      saveTone="danger"
      onCancel={() => dispatch({ type: 'closeCloseSheet' })}
      onSave={() => {
        if (!confirmed || sheet.saving) return;
        void closeMySalon();
      }}
    >
      <p
        style={{
          font: `500 12.5px/1.6 ${font.sans}`,
          color: color.inkSoft,
          margin: '0 0 10px',
        }}
      >
        {t.closeBody}
      </p>

      <p
        style={{
          font: `600 12.5px/1.6 ${font.sans}`,
          color: color.inkSoft,
          margin: '0 0 10px',
        }}
      >
        {t.closeKept}
      </p>

      <p
        style={{
          font: `500 12px/1.6 ${font.sans}`,
          color: color.mutedSoft,
          margin: '0 0 14px',
        }}
      >
        {t.closeFinal}
      </p>

      <label style={{ display: 'block' }}>
        <span
          style={{
            display: 'block',
            font: `500 10px ${font.sans}`,
            color: color.mutedFaint,
            marginBottom: 3,
          }}
        >
          {t.closeConfirmHint}
        </span>
        <input
          type="text"
          id="close-salon-confirm"
          value={sheet.typed}
          disabled={sheet.saving}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          // The word is Latin in both languages, so the field is too — left to
          // the paragraph's direction it would sit on the wrong side in Arabic.
          dir="ltr"
          onChange={(event) => dispatch({ type: 'setCloseTyped', value: event.target.value })}
          style={{
            width: '100%',
            padding: '9px 10px',
            borderRadius: 10,
            border: `1.5px solid ${confirmed ? color.danger : color.lineWarm}`,
            background: color.surfaceWarm,
            font: `600 12.5px ${font.mono}`,
            color: color.ink,
            letterSpacing: '.08em',
          }}
        />
      </label>
    </SheetModal>
  );
}
