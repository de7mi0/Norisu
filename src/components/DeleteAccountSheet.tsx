import { SheetModal } from './SheetModal';
import { useApp } from '../state/context';
import { color, font } from '../theme';

/**
 * Deleting an account, for good.
 *
 * Both app stores require this to be reachable from inside the app — not by
 * e-mailing anybody — for any app with sign-in. It is also the only
 * irreversible thing a customer can do in Saloni, which is why it asks twice:
 * once by opening, and once by making the person type the word. A mis-tap on a
 * phone is otherwise all it takes.
 *
 * The sheet says plainly what survives and what does not, because "are you
 * sure?" is not consent to something somebody has not been told. What survives
 * is the salon's own record of appointments it worked, with the person removed
 * from them — see `delete_my_account()` in migration 0016.
 */
export function DeleteAccountSheet() {
  const { t, state, dispatch, deleteAccount } = useApp();

  const sheet = state.deleteSheet;
  if (!sheet) return null;

  // Compared case-insensitively but shown in capitals: the word is the same in
  // both dictionaries on purpose. Asking somebody to type an English word to
  // delete their account is not friendly, but asking them to type an Arabic one
  // on a keyboard that may be set to English is worse.
  const confirmed = sheet.typed.trim().toUpperCase() === t.deleteConfirmWord;

  return (
    <SheetModal
      title={t.deleteTitle}
      cancelLabel={t.cancel}
      saveLabel={sheet.saving ? `${t.deleteGo}…` : t.deleteGo}
      saveDisabled={!confirmed || sheet.saving}
      saveTone="danger"
      onCancel={() => dispatch({ type: 'closeDeleteSheet' })}
      onSave={() => {
        if (!confirmed || sheet.saving) return;
        void deleteAccount();
      }}
    >
      <p
        style={{
          font: `500 12.5px/1.6 ${font.sans}`,
          color: color.inkSoft,
          margin: '0 0 14px',
        }}
      >
        {t.deleteBody}
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
          {t.deleteConfirmHint}
        </span>
        <input
          type="text"
          value={sheet.typed}
          disabled={sheet.saving}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          // The word is Latin in both languages, so the field is too — left to
          // the paragraph's direction it would sit on the wrong side in Arabic.
          dir="ltr"
          onChange={(event) => dispatch({ type: 'setDeleteTyped', value: event.target.value })}
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
