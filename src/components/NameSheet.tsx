import { SheetField, SheetModal } from './SheetModal';
import { useApp } from '../state/context';

/**
 * "What should we call you?"
 *
 * `profiles.full_name` was never written by anything, so every account signed
 * in blank and the salon's calendar had only a booking reference to show
 * against an appointment. This is the one place the name is typed, shared by
 * the profile screen and the prompt after a booking so the two cannot drift.
 *
 * Nothing here is compulsory. A customer who would rather not give a name still
 * books, and the salon still sees the reference — which is the honest outcome,
 * not a degraded one.
 */
export function NameSheet() {
  const { t, state, dispatch, saveMyName } = useApp();

  if (!state.nameModal) return null;

  return (
    <SheetModal
      title={t.nameSheetTitle}
      cancelLabel={t.cancel}
      saveLabel={t.save}
      onCancel={() => dispatch({ type: 'closeNameSheet' })}
      onSave={() => void saveMyName(state.nameForm)}
    >
      <SheetField
        label={t.nameSheetLabel}
        value={state.nameForm}
        onChange={(value) => dispatch({ type: 'setNameForm', value })}
        placeholder={t.nameSheetPlaceholder}
        style={{ marginBottom: 14 }}
      />
    </SheetModal>
  );
}
