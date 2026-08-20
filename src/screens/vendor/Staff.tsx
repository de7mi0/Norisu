import { useState } from 'react';
import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen, ScreenHeader } from '../../components/Screen';
import { SheetField, SheetModal } from '../../components/SheetModal';
import { VENDOR_STAFF } from '../../data/vendor';
import { localizeUnits } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font, tile } from '../../theme';
import type { OwnerStaff, StaffDraft } from '../../data/owner';

const STAFF_TILES = [tile.sandFine, tile.taupeFine, tile.blushFine];

const EMPTY_DRAFT: StaffDraft = { nameEn: '', nameAr: '', roleEn: '', roleAr: '' };

/**
 * Vendor team list.
 *
 * For an owner this is the real team a customer picks from: adding, editing and
 * removing write to `staff`. Removing archives, because bookings name the
 * person who did the work.
 */
export function Staff() {
  const { t, state, dispatch, isArabic, backIcon, owner, saveStaff, removeStaff } = useApp();

  const [editing, setEditing] = useState<OwnerStaff | 'new' | null>(null);
  const [draft, setDraft] = useState<StaffDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const openEdit = (person: OwnerStaff) => {
    setDraft({
      nameEn: person.name,
      nameAr: person.nameAr,
      roleEn: person.role,
      roleAr: person.roleAr,
    });
    setEditing(person);
  };

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    const saved = await saveStaff(draft, editing === 'new' ? undefined : editing?.id);
    setBusy(false);
    if (saved) setEditing(null);
  };

  const commitRemove = async () => {
    if (busy || editing === 'new' || !editing) return;
    setBusy(true);
    const removed = await removeStaff(editing.id);
    setBusy(false);
    if (removed) setEditing(null);
  };

  // An owner sees their real team. Per-person ratings and today's counts are
  // not modelled yet, so they are left out rather than borrowed from the
  // sample data — a made-up 4.9 next to a real name is worse than no number.
  const team = owner.salon
    ? [
        ...owner.salon.staff.map((person, index) => ({
          id: person.id,
          name: person.name,
          arName: person.nameAr,
          role: person.role,
          arRole: person.roleAr,
          rating: '' as const,
          todayCount: '',
          initials: person.initials,
          tile: STAFF_TILES[index % STAFF_TILES.length],
        })),
        ...state.extraStaff,
      ]
    : [...VENDOR_STAFF, ...state.extraStaff];

  return (
    <>
      <Screen bottomInset={40}>
        <ScreenHeader
          onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={t.staff}
        />

        <SampleDataNotice />

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
                {person.rating || person.todayCount ? (
                  <div
                    style={{ font: `600 11px ${font.sans}`, color: color.goldDeep, marginTop: 4 }}
                  >
                    {person.rating ? `★ ${person.rating}` : null}
                    {person.rating && person.todayCount ? ' · ' : null}
                    {person.todayCount ? localizeUnits(person.todayCount, state.lang) : null}
                  </div>
                ) : null}
              </div>
              {owner.salon ? (
                <button
                  type="button"
                  onClick={() => {
                    const own = owner.salon?.staff.find((member) => member.id === person.id);
                    if (own) openEdit(own);
                  }}
                  className="press"
                  style={{ font: `600 12px ${font.sans}`, color: color.goldLink }}
                >
                  {t.edit}
                </button>
              ) : (
                // Sample rows have nothing behind them to edit.
                <div style={{ font: `600 12px ${font.sans}`, color: color.mutedFaint }}>{t.edit}</div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              if (!owner.salon) {
                dispatch({ type: 'openStaffModal' });
                return;
              }
              setDraft(EMPTY_DRAFT);
              setEditing('new');
            }}
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

      {editing ? (
        <SheetModal
          title={editing === 'new' ? t.addStaffMember : t.editStaff}
          cancelLabel={t.cancel}
          saveLabel={busy ? t.saving : t.save}
          onCancel={() => setEditing(null)}
          onSave={() => void commit()}
        >
          <SheetField
            label={isArabic ? 'الاسم (بالإنجليزية)' : 'Name (English)'}
            value={draft.nameEn}
            onChange={(value) => setDraft((d) => ({ ...d, nameEn: value }))}
            placeholder="Layla A."
            style={{ marginBottom: 10 }}
          />
          <SheetField
            label={isArabic ? 'الاسم (بالعربية)' : 'Name (Arabic)'}
            value={draft.nameAr}
            onChange={(value) => setDraft((d) => ({ ...d, nameAr: value }))}
            placeholder="ليلى ع."
            style={{ marginBottom: 10 }}
          />
          <SheetField
            label={isArabic ? 'الدور (بالإنجليزية)' : 'Role (English)'}
            value={draft.roleEn}
            onChange={(value) => setDraft((d) => ({ ...d, roleEn: value }))}
            placeholder="Stylist"
            style={{ marginBottom: 10 }}
          />
          <SheetField
            label={isArabic ? 'الدور (بالعربية)' : 'Role (Arabic)'}
            value={draft.roleAr}
            onChange={(value) => setDraft((d) => ({ ...d, roleAr: value }))}
            placeholder="مصففة"
            style={{ marginBottom: 16 }}
          />

          {editing !== 'new' ? (
            <>
              <button
                type="button"
                onClick={() => void commitRemove()}
                disabled={busy}
                className="press"
                style={{
                  width: '100%',
                  textAlign: 'center',
                  background: 'transparent',
                  border: `1.5px solid ${color.lineFaint}`,
                  borderRadius: 13,
                  padding: 13,
                  font: `600 12.5px ${font.sans}`,
                  color: '#b4443a',
                  marginBottom: 4,
                }}
              >
                {t.removeStaff}
              </button>
              <p
                style={{
                  font: `500 10.5px/1.5 ${font.sans}`,
                  color: color.mutedFaint,
                  margin: '0 0 4px',
                }}
              >
                {t.removeStaffNote}
              </p>
            </>
          ) : null}
        </SheetModal>
      ) : null}

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
