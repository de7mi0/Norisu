import { Screen, ScreenHeader } from '../../components/Screen';
import { SheetField, SheetModal } from '../../components/SheetModal';
import { VENDOR_STAFF } from '../../data/vendor';
import { localizeUnits } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Vendor team list with an add-member sheet. */
export function Staff() {
  const { t, state, dispatch, isArabic, backIcon } = useApp();

  const team = [...VENDOR_STAFF, ...state.extraStaff];

  return (
    <>
      <Screen bottomInset={40}>
        <ScreenHeader
          onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={t.staff}
        />

        <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {team.map((person) => (
            <div
              key={person.id}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                background: color.surface,
                border: `1px solid ${color.lineWarm}`,
                borderRadius: 18,
                padding: 14,
                boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  flex: 'none',
                  background: person.tile,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: `700 16px ${font.serif}`,
                  color: '#8a7a4e',
                }}
              >
                {person.initials}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ font: `600 15px ${font.sans}` }}>
                  {isArabic ? person.arName : person.name}
                </div>
                <div
                  style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft, marginTop: 1 }}
                >
                  {isArabic ? person.arRole : person.role}
                </div>
                <div
                  style={{ font: `600 11px ${font.sans}`, color: color.goldDeep, marginTop: 4 }}
                >
                  ★ {person.rating} · {localizeUnits(person.todayCount, state.lang)}
                </div>
              </div>
              {/* TODO(roadmap A1): not yet a control — editing a team member is unbuilt. */}
              <div style={{ font: `600 12px ${font.sans}`, color: color.goldLink }}>{t.edit}</div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => dispatch({ type: 'openStaffModal' })}
            className="press"
            style={{
              border: `1.5px dashed ${color.lineDashed}`,
              borderRadius: 16,
              padding: 16,
              textAlign: 'center',
              font: `600 13px ${font.sans}`,
              color: color.goldLink,
            }}
          >
            {t.addStaff}
          </button>
        </div>
      </Screen>

      {state.staffModal ? (
        <SheetModal
          title={t.newStaff}
          cancelLabel={t.cancel}
          saveLabel={t.save}
          onCancel={() => dispatch({ type: 'closeStaffModal' })}
          onSave={() => dispatch({ type: 'saveStaff' })}
        >
          <SheetField
            label={t.staffNamePh}
            value={state.staffForm.name}
            onChange={(value) => dispatch({ type: 'setStaffForm', field: 'name', value })}
            placeholder={t.staffNamePh}
            style={{ marginBottom: 10 }}
          />
          <SheetField
            label={t.rolePh}
            value={state.staffForm.role}
            onChange={(value) => dispatch({ type: 'setStaffForm', field: 'role', value })}
            placeholder={t.rolePh}
            style={{ marginBottom: 16 }}
          />
        </SheetModal>
      ) : null}
    </>
  );
}
