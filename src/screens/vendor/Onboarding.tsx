import { useEffect, useState } from 'react';
import { BottomBar, Screen, ScreenHeader } from '../../components/Screen';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { SalonDraft } from '../../data/owner';

/**
 * Salon registration, and afterwards the business profile editor.
 *
 * One screen for both because the fields are the same ones: an owner who mistyped
 * their district at sign-up was previously stuck, since this screen only ever
 * offered to open the dashboard once a salon existed.
 *
 * Verification is not editable here, and not merely absent from the form:
 * migration 0004 revokes the owner's UPDATE privilege on is_verified and
 * is_published, so a salon cannot approve itself into the catalogue.
 *
 * The form state is local rather than in the reducer because it belongs to one
 * screen and nothing else reads it. The sign-in sheet floats over this screen
 * rather than replacing it, so a half-filled form survives being asked to sign
 * in partway through.
 */

const EMPTY: SalonDraft = {
  nameEn: '',
  nameAr: '',
  categoryEn: '',
  categoryAr: '',
  areaEn: '',
  areaAr: '',
  city: 'Riyadh',
  crNumber: '',
  phone: '',
};

/** Long enough for any real value, short enough to bound what is stored. */
const MAX = 80;

export function Onboarding() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    backIcon,
    owner,
    registerSalon,
    saveBusinessProfile,
  } = useApp();

  const existing = owner.salon;
  const editing = Boolean(existing);

  const [draft, setDraft] = useState<SalonDraft>(existing?.profile ?? EMPTY);
  const [saving, setSaving] = useState(false);

  // Adopt the stored profile once it arrives, and again if the owner changes.
  // Keyed on the salon id so a half-typed edit is not overwritten by a reload.
  const [loadedFor, setLoadedFor] = useState<string | null>(existing?.id ?? null);
  useEffect(() => {
    if (existing && existing.id !== loadedFor) {
      setDraft(existing.profile);
      setLoadedFor(existing.id);
    }
  }, [existing, loadedFor]);

  const set = (key: keyof SalonDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value.slice(0, MAX) }));

  const ready = Boolean(draft.nameEn.trim() && draft.nameAr.trim() && draft.crNumber.trim());

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    if (editing) {
      await saveBusinessProfile(draft);
    } else {
      const created = await registerSalon(draft);
      if (created) setDraft(EMPTY);
    }
    setSaving(false);
  };

  return (
    <>
      <Screen bottomInset={100}>
        <ScreenHeader
          onBack={() =>
            dispatch({ type: 'go', screen: state.obBack === 'v_more' ? 'v_more' : 'v_dash' })
          }
          backIcon={backIcon}
          backLabel={isArabic ? 'رجوع' : 'Back'}
          title={editing ? t.businessProfile : t.registerSalon}
        />
        <div
          lang="ar"
          style={{
            font: `700 15px ${font.arabicDisplay}`,
            color: color.goldLink,
            padding: '0 24px 0 76px',
          }}
        >
          {editing ? 'ملف العمل' : 'سجّل صالونك'}
        </div>

        <p
          style={{
            font: `500 12px/1.5 ${font.sans}`,
            color: color.mutedSoft,
            padding: '10px 24px 0',
            margin: 0,
          }}
        >
          {editing ? t.businessProfileDesc : t.registerDesc}
        </p>

        {/* Where they stand: still waiting on approval, live, or not yet registered. */}
        <div
          style={{
            margin: '16px 24px 0',
            background: existing?.isPublished ? color.tealSoft : color.cream,
            border: `1px solid ${existing?.isPublished ? color.tealLine : color.creamLine}`,
            borderRadius: 14,
            padding: '13px 15px',
            font: `600 11.5px/1.6 ${font.sans}`,
            color: existing?.isPublished ? color.teal : '#8a6d14',
          }}
        >
          {!editing
            ? t.verificationNote
            : existing?.isPublished
              ? t.profileLive
              : existing?.isVerified
                ? t.profileVerifiedNotLive
                : t.profileAwaitingReview}
        </div>

        <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field
                label={isArabic ? 'اسم الصالون (بالإنجليزية)' : 'Salon name (English)'}
                value={draft.nameEn}
                onChange={set('nameEn')}
                placeholder="Maison Noir"
                required
                dir="ltr"
              />
              <Field
                label={isArabic ? 'اسم الصالون (بالعربية)' : 'Salon name (Arabic)'}
                value={draft.nameAr}
                onChange={set('nameAr')}
                placeholder="ميزون نوار"
                required
                dir="rtl"
              />
              <Field
                label={isArabic ? 'السجل التجاري' : 'Commercial registration (CR)'}
                value={draft.crNumber}
                onChange={set('crNumber')}
                placeholder="1010XXXXXX"
                required
                dir="ltr"
                inputMode="numeric"
              />
              <Field
                label={isArabic ? 'الفئة (بالإنجليزية)' : 'Category (English)'}
                value={draft.categoryEn}
                onChange={set('categoryEn')}
                placeholder="Hair"
                dir="ltr"
              />
              <Field
                label={isArabic ? 'الفئة (بالعربية)' : 'Category (Arabic)'}
                value={draft.categoryAr}
                onChange={set('categoryAr')}
                placeholder="شعر"
                dir="rtl"
              />
              <Field
                label={isArabic ? 'الحي (بالإنجليزية)' : 'District (English)'}
                value={draft.areaEn}
                onChange={set('areaEn')}
                placeholder="Al Olaya"
                dir="ltr"
              />
              <Field
                label={isArabic ? 'الحي (بالعربية)' : 'District (Arabic)'}
                value={draft.areaAr}
                onChange={set('areaAr')}
                placeholder="العليا"
                dir="rtl"
              />
              <Field
                label={isArabic ? 'المدينة' : 'City'}
                value={draft.city}
                onChange={set('city')}
                placeholder="Riyadh"
              />
              <Field
                label={isArabic ? 'الهاتف' : 'Phone'}
                value={draft.phone}
                onChange={set('phone')}
                placeholder="+9665XXXXXXXX"
                dir="ltr"
                inputMode="tel"
              />
        </div>
      </Screen>

      <BottomBar>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || saving}
          className="press"
          style={{
            width: '100%',
            textAlign: 'center',
            background: ready && !saving ? color.gold : '#f0ece2',
            color: ready && !saving ? color.goldInk : '#b8b2a5',
            borderRadius: 15,
            padding: 16,
            font: `700 14px ${font.sans}`,
            cursor: ready && !saving ? 'pointer' : 'not-allowed',
            boxShadow: ready && !saving ? '0 12px 26px -12px rgba(245,197,66,.9)' : 'none',
          }}
        >
          {saving
            ? editing
              ? t.saving
              : t.registering
            : !ready
              ? t.registerNeedsFields
              : editing
                ? t.saveChanges
                : t.createSalon}
        </button>
      </BottomBar>
    </>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  dir?: 'ltr' | 'rtl';
  inputMode?: 'text' | 'numeric' | 'tel';
}

function Field({ label, value, onChange, placeholder, required, dir, inputMode }: FieldProps) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'block',
          font: `600 11px ${font.sans}`,
          color: color.mutedSoft,
          marginBottom: 6,
        }}
      >
        {label}
        {required ? <span style={{ color: color.goldDeep }}> *</span> : null}
      </span>
      <input
        type="text"
        value={value}
        dir={dir}
        inputMode={inputMode}
        maxLength={MAX}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: '100%',
          background: color.surfaceWarm,
          border: `1.5px solid ${color.lineWarm}`,
          borderRadius: 13,
          padding: 14,
          font: `600 13.5px ${font.sans}`,
          color: color.ink,
        }}
      />
    </label>
  );
}
