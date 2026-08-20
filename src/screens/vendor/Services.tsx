import { useState } from 'react';
import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen } from '../../components/Screen';
import { SheetField, SheetModal } from '../../components/SheetModal';
import { priceNow } from '../../data/services';
import { VENDOR_SERVICES } from '../../data/vendor';
import { localizeUnits } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { OwnerService, ServiceDraft } from '../../data/owner';

const EMPTY_DRAFT: ServiceDraft = {
  nameEn: '',
  nameAr: '',
  price: 0,
  durationMinutes: 45,
  discountPercent: 0,
};

/**
 * Vendor service catalogue.
 *
 * For an owner this is the real menu customers book from: adding, editing,
 * hiding and removing all write to `services`. Removing archives rather than
 * deletes, because bookings reference the service they were made at and a past
 * booking must keep meaning what it meant.
 *
 * Anyone who owns no salon still sees the sample catalogue and the original
 * browser-only sheet, so the public demo is unchanged.
 */
export function Services() {
  const {
    t,
    state,
    dispatch,
    isArabic,
    money,
    owner,
    saveService,
    removeService,
    toggleServiceLive,
  } = useApp();

  // 'new', or the service being edited. Local because nothing outside this
  // screen reads it — same reasoning as the registration form.
  const [editing, setEditing] = useState<OwnerService | 'new' | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setDraft(EMPTY_DRAFT);
    setEditing('new');
  };

  const openEdit = (service: OwnerService) => {
    setDraft({
      nameEn: service.name,
      nameAr: service.ar,
      price: service.price,
      durationMinutes: service.durationMinutes ?? 45,
      discountPercent: service.discount ?? 0,
    });
    setEditing(service);
  };

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    const saved = await saveService(draft, editing === 'new' ? undefined : editing?.id);
    setBusy(false);
    if (saved) setEditing(null);
  };

  const commitRemove = async () => {
    if (busy || editing === 'new' || !editing) return;
    setBusy(true);
    const removed = await removeService(editing.id);
    setBusy(false);
    if (removed) setEditing(null);
  };

  // An owner sees their own catalogue; anybody else sees the sample one. The
  // per-service booking counts stay blank on real rows rather than borrowing
  // the sample's invented ones — counting them needs an aggregate query.
  const services = owner.salon
    ? [...owner.salon.services.map((service) => ({ ...service, bookings: '' })), ...state.extraServices]
    : [...VENDOR_SERVICES, ...state.extraServices];

  return (
    <>
      <Screen bottomInset={88}>
        <div style={{ padding: '56px 24px 0' }}>
          <h1 style={{ font: `600 26px ${font.serif}`, margin: 0 }}>{t.servicesPricing}</h1>
          <div lang="ar" style={{ font: `700 16px ${font.arabicDisplay}`, color: color.goldLink }}>
            الخدمات والأسعار
          </div>
        </div>

        <SampleDataNotice />

        <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {services.map((service) => {
            // An owner's Live switch is the stored is_active; the demo's is a
            // browser-only flag that resets on refresh.
            const own = owner.salon
              ? (owner.salon.services.find((s) => s.id === service.id) ?? null)
              : null;
            const hidden = own ? !own.isActive : Boolean(state.vOff[service.id]);
            return (
              <div
                key={service.id}
                style={{
                  background: color.surface,
                  border: `1px solid ${color.lineWarm}`,
                  borderRadius: 16,
                  padding: 14,
                  boxShadow: '0 6px 16px -14px rgba(60,50,20,.4)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ font: `600 15px ${font.sans}` }}>
                      {isArabic ? service.ar : service.name}
                    </div>
                    <div
                      style={{
                        font: `500 10.5px ${font.arabicSans}`,
                        color: color.mutedSoft,
                        margin: '2px 0 6px',
                      }}
                    >
                      {isArabic ? service.name : service.ar}
                      {' · '}
                      {/* Latin digits beside Arabic reorder without isolation. */}
                      <span className="ltr-run">{localizeUnits(service.dur, state.lang)}</span>
                      {/* Booking counts are only known for the sample rows; a
                          real one would need an aggregate query, so the
                          separator goes too rather than dangling. */}
                      {service.bookings ? (
                        <>
                          {' · '}
                          {localizeUnits(service.bookings, state.lang)}
                        </>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ font: `700 15px ${font.sans}` }}>
                        {money(priceNow(service))}
                      </span>
                      {service.discount > 0 ? (
                        <span
                          style={{
                            font: `600 10px ${font.sans}`,
                            color: color.goldInkAlt,
                            background: color.gold,
                            padding: '2px 7px',
                            borderRadius: 6,
                          }}
                          className="ltr-run"
                        >
                          -{service.discount}%
                        </span>
                      ) : null}
                      {own ? (
                        <button
                          type="button"
                          onClick={() => openEdit(own)}
                          className="press"
                          style={{
                            marginInlineStart: 'auto',
                            font: `600 11.5px ${font.sans}`,
                            color: color.goldLink,
                          }}
                        >
                          {t.edit}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      own
                        ? void toggleServiceLive(own.id, !own.isActive)
                        : dispatch({ type: 'toggleVendorService', serviceId: service.id })
                    }
                    role="switch"
                    aria-checked={!hidden}
                    aria-label={`${isArabic ? service.ar : service.name} — ${
                      hidden ? (isArabic ? 'مخفي' : 'Hidden') : isArabic ? 'مباشر' : 'Live'
                    }`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 23,
                        borderRadius: 12,
                        background: hidden ? '#e2ddd2' : color.gold,
                        position: 'relative',
                        transition: 'background .2s',
                        display: 'block',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 3,
                          insetInlineStart: hidden ? 3 : 21,
                          width: 17,
                          height: 17,
                          borderRadius: '50%',
                          background: '#fff',
                          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                          transition: 'inset-inline-start .2s',
                        }}
                      />
                    </span>
                    <span style={{ font: `600 9px ${font.sans}`, color: color.mutedSoft }}>
                      {hidden ? (isArabic ? 'مخفي' : 'Hidden') : isArabic ? 'مباشر' : 'Live'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => (owner.salon ? openNew() : dispatch({ type: 'openServiceModal' }))}
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
            {t.addService}
          </button>
        </div>
      </Screen>

      {editing ? (
        <SheetModal
          title={editing === 'new' ? t.newService : t.editService}
          cancelLabel={t.cancel}
          saveLabel={busy ? t.saving : t.save}
          onCancel={() => setEditing(null)}
          onSave={() => void commit()}
        >
          <SheetField
            label={isArabic ? 'الاسم (بالإنجليزية)' : 'Name (English)'}
            value={draft.nameEn}
            onChange={(value) => setDraft((d) => ({ ...d, nameEn: value }))}
            placeholder="Signature Haircut"
            style={{ marginBottom: 10 }}
          />
          <SheetField
            label={isArabic ? 'الاسم (بالعربية)' : 'Name (Arabic)'}
            value={draft.nameAr}
            onChange={(value) => setDraft((d) => ({ ...d, nameAr: value }))}
            placeholder="قص شعر"
            style={{ marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <SheetField
              label={isArabic ? 'السعر (ر.س)' : 'Price (SAR)'}
              value={draft.price ? String(draft.price) : ''}
              onChange={(value) =>
                setDraft((d) => ({ ...d, price: Number.parseInt(value, 10) || 0 }))
              }
              placeholder="150"
              inputMode="numeric"
              style={{ flex: 1, minWidth: 0 }}
            />
            <SheetField
              label={isArabic ? 'المدة (دقيقة)' : 'Minutes'}
              value={draft.durationMinutes ? String(draft.durationMinutes) : ''}
              onChange={(value) =>
                setDraft((d) => ({ ...d, durationMinutes: Number.parseInt(value, 10) || 0 }))
              }
              placeholder="45"
              inputMode="numeric"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <SheetField
            label={isArabic ? 'الخصم (%)' : 'Discount (%)'}
            value={draft.discountPercent ? String(draft.discountPercent) : ''}
            onChange={(value) =>
              setDraft((d) => ({ ...d, discountPercent: Number.parseInt(value, 10) || 0 }))
            }
            placeholder="0"
            inputMode="numeric"
            style={{ marginBottom: 16 }}
          />

          {editing !== 'new' ? (
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
              {t.removeService}
            </button>
          ) : null}
          {/* Says why removing is safe, since "remove" usually means "delete". */}
          {editing !== 'new' ? (
            <p
              style={{
                font: `500 10.5px/1.5 ${font.sans}`,
                color: color.mutedFaint,
                margin: '0 0 4px',
              }}
            >
              {t.removeServiceNote}
            </p>
          ) : null}
        </SheetModal>
      ) : null}

      {state.svcModal ? (
        <SheetModal
          title={t.newService}
          cancelLabel={t.cancel}
          saveLabel={t.save}
          onCancel={() => dispatch({ type: 'closeServiceModal' })}
          onSave={() => dispatch({ type: 'saveService' })}
        >
          <SheetField
            label={t.svcNamePh}
            value={state.svcForm.name}
            onChange={(value) => dispatch({ type: 'setServiceForm', field: 'name', value })}
            placeholder={t.svcNamePh}
            style={{ marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <SheetField
              label={t.pricePh}
              value={state.svcForm.price}
              onChange={(value) => dispatch({ type: 'setServiceForm', field: 'price', value })}
              placeholder={t.pricePh}
              inputMode="numeric"
              style={{ flex: 1, minWidth: 0 }}
            />
            <SheetField
              label={t.durPh}
              value={state.svcForm.dur}
              onChange={(value) => dispatch({ type: 'setServiceForm', field: 'dur', value })}
              placeholder={t.durPh}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </SheetModal>
      ) : null}
    </>
  );
}
