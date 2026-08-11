import { Screen } from '../../components/Screen';
import { SheetField, SheetModal } from '../../components/SheetModal';
import { priceNow } from '../../data/services';
import { VENDOR_SERVICES } from '../../data/vendor';
import { localizeUnits } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * Vendor service catalogue with live/hidden switches and an add-service sheet.
 *
 * TODO(roadmap A1): services can be added but not edited or removed. Reuse SheetModal in
 * an edit mode prefilled from the record, and archive rather than delete. Note that
 * bookings must keep the price they were made at. See ROADMAP.md.
 */
export function Services() {
  const { t, state, dispatch, isArabic, money } = useApp();

  const services = [...VENDOR_SERVICES, ...state.extraServices];

  return (
    <>
      <Screen bottomInset={88}>
        <div style={{ padding: '56px 24px 0' }}>
          <h1 style={{ font: `600 26px ${font.serif}`, margin: 0 }}>{t.servicesPricing}</h1>
          <div lang="ar" style={{ font: `700 16px ${font.arabicDisplay}`, color: color.goldLink }}>
            الخدمات والأسعار
          </div>
        </div>

        <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {services.map((service) => {
            const hidden = Boolean(state.vOff[service.id]);
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
                      {isArabic ? service.name : service.ar} ·{' '}
                      {localizeUnits(service.dur, state.lang)} ·{' '}
                      {localizeUnits(service.bookings, state.lang)}
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
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'toggleVendorService', serviceId: service.id })}
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
            onClick={() => dispatch({ type: 'openServiceModal' })}
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
