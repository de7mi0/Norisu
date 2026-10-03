import { useEffect, useState } from 'react';
import { CloseSalonSheet } from '../../components/CloseSalonSheet';
import { LangToggle } from '../../components/LangToggle';
import { SALON_CATEGORIES, findCategory } from '../../data/categories';
import { CITIES, MAX_CITIES } from '../../data/cities';
import { isGoogleMapsUrl } from '../../data/owner';
import { mapsLink } from '../../lib/maps';
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
  cities: [],
  mapsUrl: '',
  latitude: null,
  longitude: null,
  crNumber: '',
  phone: '',
};

/** The draft's free-text fields — the ones typed into a plain input. */
type TextKey = 'nameEn' | 'nameAr' | 'categoryEn' | 'categoryAr' | 'areaEn' | 'areaAr' | 'mapsUrl' | 'crNumber' | 'phone';

/**
 * Long enough for any real value, short enough to bound what is stored — and
 * matched to migration 0015's check constraints field by field, not by one
 * number for all of them. A single cap of 80 was under the limit for a name and
 * over it for a city, a registration number and a phone, which the database
 * would have refused on save with nothing useful to say. Trimming as it is
 * typed is the kinder half of the same rule.
 */
const CAPS: Record<TextKey, number> = {
  nameEn: 80,
  nameAr: 80,
  categoryEn: 60,
  categoryAr: 60,
  areaEn: 80,
  areaAr: 80,
  mapsUrl: 500,
  crNumber: 30,
  phone: 20,
};

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

  // Turned down by Saloni (0021). Both halves are required: the reason is what
  // makes the refusal actionable, and without it the ordinary "awaiting
  // review" banner is the more honest thing to show.
  const review = existing?.review;
  const rejected = Boolean(editing && review?.rejectedAt && review.reason);

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

  const set = (key: TextKey) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value.slice(0, CAPS[key]) }));

  // "Other" is chosen explicitly, or implied by a stored category that is not
  // on the list — a salon registered before the list existed typed its own.
  const [otherCategory, setOtherCategory] = useState(false);
  const listedCategory = findCategory(draft.categoryEn, draft.categoryAr);
  const showOther = otherCategory || Boolean(draft.categoryEn && !listedCategory);

  const toggleCity = (id: string) =>
    setDraft((current) => ({
      ...current,
      cities: current.cities.includes(id)
        ? current.cities.filter((city) => city !== id)
        : current.cities.length >= MAX_CITIES
          ? current.cities
          : [...current.cities, id],
    }));

  // 'idle' | 'asking' | 'failed': whether the browser gave us a position.
  const [locating, setLocating] = useState<'idle' | 'asking' | 'failed'>('idle');
  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocating('failed');
      return;
    }
    setLocating('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Six decimals is about ten centimetres, and is what numeric(9,6) holds.
        const round = (n: number) => Math.round(n * 1e6) / 1e6;
        setDraft((current) => ({
          ...current,
          latitude: round(position.coords.latitude),
          longitude: round(position.coords.longitude),
        }));
        setLocating('idle');
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const mapsUrlBad = draft.mapsUrl.trim() !== '' && !isGoogleMapsUrl(draft.mapsUrl.trim());
  const hasLocation = Boolean(draft.mapsUrl.trim() && !mapsUrlBad) || draft.latitude != null;

  const ready = Boolean(
    draft.nameEn.trim() &&
      draft.nameAr.trim() &&
      draft.crNumber.trim() &&
      draft.cities.length > 0 &&
      !mapsUrlBad,
  );

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
          trailing={<LangToggle variant="pill" />}
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

        {/* Where they stand: turned down, still waiting, live, or not yet
            registered. Being turned down is the newest of these and the only
            one that asks the owner to do something, so it gets its own block
            with the reason in it — a refusal without one is the silence this
            replaced. */}
        {rejected ? (
          <div
            style={{
              margin: '16px 24px 0',
              background: '#fdeceb',
              border: '1px solid #f6d4d1',
              borderRadius: 14,
              padding: '13px 15px',
            }}
          >
            <div style={{ font: `700 12px ${font.sans}`, color: color.danger }}>
              {t.vendorRejectedTitle}
            </div>
            {/* Written by an administrator, rendered as text and never as
                markup — the same rule as every other string a person types. */}
            <p
              style={{
                font: `500 12px/1.6 ${font.sans}`,
                color: color.ink,
                margin: '6px 0 0',
              }}
            >
              {review?.reason}
            </p>
            <p
              style={{
                font: `600 11px/1.55 ${font.sans}`,
                color: color.danger,
                margin: '8px 0 0',
              }}
            >
              {t.vendorRejectedFix}
            </p>
          </div>
        ) : (
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
        )}

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
              <div>
                <FieldLabel label={t.salonCategory} />
                <ChipRow>
                  {SALON_CATEGORIES.map((category) => (
                    <Chip
                      key={category.en}
                      label={isArabic ? category.ar : category.en}
                      selected={!showOther && listedCategory === category}
                      onClick={() => {
                        setOtherCategory(false);
                        setDraft((current) => ({
                          ...current,
                          categoryEn: category.en,
                          categoryAr: category.ar,
                        }));
                      }}
                    />
                  ))}
                  <Chip
                    label={t.categoryOther}
                    selected={showOther}
                    onClick={() => {
                      setOtherCategory(true);
                      if (listedCategory) {
                        setDraft((current) => ({ ...current, categoryEn: '', categoryAr: '' }));
                      }
                    }}
                  />
                </ChipRow>
              </div>
              {showOther ? (
                <>
                  <Field
                    label={isArabic ? 'الفئة (بالإنجليزية)' : 'Category (English)'}
                    value={draft.categoryEn}
                    onChange={set('categoryEn')}
                    max={CAPS.categoryEn}
                    placeholder="Kids' haircuts"
                    dir="ltr"
                  />
                  <Field
                    label={isArabic ? 'الفئة (بالعربية)' : 'Category (Arabic)'}
                    value={draft.categoryAr}
                    onChange={set('categoryAr')}
                    max={CAPS.categoryAr}
                    placeholder="قص شعر الأطفال"
                    dir="rtl"
                  />
                </>
              ) : null}
              <div>
                <FieldLabel label={t.salonCities} required />
                <p style={{ font: `500 11px/1.5 ${font.sans}`, color: color.mutedFaint, margin: '0 0 8px' }}>
                  {t.salonCitiesHint}
                </p>
                <ChipRow>
                  {CITIES.map((city) => (
                    <Chip
                      key={city.id}
                      label={isArabic ? city.ar : city.id}
                      selected={draft.cities.includes(city.id)}
                      onClick={() => toggleCity(city.id)}
                    />
                  ))}
                  {/* A city typed freehand before the list existed stays
                      visible and removable rather than silently dropped. */}
                  {draft.cities
                    .filter((value) => !CITIES.some((city) => city.id === value))
                    .map((value) => (
                      <Chip key={value} label={value} selected onClick={() => toggleCity(value)} />
                    ))}
                </ChipRow>
              </div>
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
                label={isArabic ? 'الهاتف' : 'Phone'}
                value={draft.phone}
                onChange={set('phone')}
                placeholder="+9665XXXXXXXX"
                dir="ltr"
                inputMode="tel"
              />
              <div>
                <FieldLabel label={t.salonLocation} />
                <p style={{ font: `500 11px/1.5 ${font.sans}`, color: color.mutedFaint, margin: '0 0 8px' }}>
                  {t.salonLocationHint}
                </p>
                <Field
                  label={t.mapsLinkLabel}
                  value={draft.mapsUrl}
                  onChange={set('mapsUrl')}
                  max={CAPS.mapsUrl}
                  placeholder="https://maps.app.goo.gl/…"
                  dir="ltr"
                  inputMode="url"
                />
                {mapsUrlBad ? (
                  <p role="alert" style={{ font: `600 11px/1.5 ${font.sans}`, color: color.danger, margin: '6px 0 0' }}>
                    {t.mapsLinkInvalid}
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    disabled={locating === 'asking'}
                    className="press"
                    style={{
                      background: color.surfaceSand,
                      border: `1px solid ${color.lineSand}`,
                      borderRadius: 10,
                      padding: '8px 12px',
                      font: `600 11.5px ${font.sans}`,
                      color: color.ink,
                    }}
                  >
                    📍 {locating === 'asking' ? t.locating : t.useCurrentLocation}
                  </button>
                  {draft.latitude != null ? (
                    <button
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, latitude: null, longitude: null }))}
                      className="press"
                      style={{ font: `600 11.5px ${font.sans}`, color: color.mutedSoft, textDecoration: 'underline' }}
                    >
                      {t.removePin}
                    </button>
                  ) : null}
                  {hasLocation ? (
                    <a
                      href={mapsLink(draft)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ font: `600 11.5px ${font.sans}`, color: color.goldLink }}
                    >
                      {t.checkOnMap}
                    </a>
                  ) : null}
                </div>
                {draft.latitude != null ? (
                  <p style={{ font: `600 11px ${font.sans}`, color: color.teal, margin: '6px 0 0' }}>
                    ✓ {t.pinSaved}{' '}
                    <span className="ltr-run">
                      {draft.latitude.toFixed(4)}, {draft.longitude?.toFixed(4)}
                    </span>
                  </p>
                ) : null}
                {locating === 'failed' ? (
                  <p role="alert" style={{ font: `600 11px/1.5 ${font.sans}`, color: color.danger, margin: '6px 0 0' }}>
                    {t.locationFailed}
                  </p>
                ) : null}
              </div>
        {/*
          Only once the salon exists — there is nothing to close before that,
          and the registration form should not offer it. It sits at the very
          bottom, under the details it undoes, the same place account deletion
          sits under sign-out on the customer's profile: findable by a store
          reviewer looking for it, not in the way of anybody who is not.
        */}
        {editing ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'openCloseSheet' })}
            className="press"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 26,
              textAlign: 'center',
              padding: 12,
              font: `600 12px ${font.sans}`,
              color: color.mutedSoft,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {t.closeSalon}
          </button>
        ) : null}
        </div>
      </Screen>

      <CloseSalonSheet />

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
  inputMode?: 'text' | 'numeric' | 'tel' | 'url';
  max?: number;
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
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
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{children}</div>;
}

/** A toggle in a list of choices; aria-pressed says which are on. */
function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="press"
      style={{
        padding: '8px 13px',
        borderRadius: 20,
        font: `600 12px ${font.sans}`,
        background: selected ? color.ink : color.surfaceSand,
        color: selected ? '#fff' : color.inkSoft,
        border: `1px solid ${selected ? color.ink : color.lineSand}`,
      }}
    >
      {selected ? '✓ ' : ''}
      {label}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, required, dir, inputMode, max = 80 }: FieldProps) {
  return (
    <label style={{ display: 'block' }}>
      <FieldLabel label={label} required={required} />
      <input
        type="text"
        value={value}
        dir={dir}
        inputMode={inputMode}
        maxLength={max}
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
