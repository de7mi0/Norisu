import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_GALLERY } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Vendor photo gallery, with the first image acting as the cover. */
export function Gallery() {
  const { t, dispatch, isArabic, backIcon } = useApp();

  return (
    <Screen bottomInset={40}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.photoGallery}
      />

      <p
        style={{
          font: `500 12px ${font.sans}`,
          color: color.mutedSoft,
          padding: '10px 24px 0',
          margin: 0,
        }}
      >
        {t.galleryDesc}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '18px 24px 0',
        }}
      >
        {VENDOR_GALLERY.map((item, index) => (
          <div
            key={index}
            style={{
              position: 'relative',
              aspectRatio: '1',
              borderRadius: 16,
              background: item.tile,
              border: '1px solid #eae3d4',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#b7ad97',
                font: `500 9px ${font.mono}`,
              }}
            >
              PHOTO
            </div>
            {item.cover ? (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  insetInlineStart: 8,
                  background: color.gold,
                  color: color.goldInk,
                  font: `700 9px ${font.sans}`,
                  padding: '3px 8px',
                  borderRadius: 8,
                }}
              >
                {t.cover}
              </div>
            ) : null}
          </div>
        ))}

        {/*
          TODO(roadmap A2): this button has no handler — uploading is unbuilt. Needs a file
          input, client-side resize/compress, and a signed upload to object storage. Strip
          EXIF server-side: phone photos carry GPS coordinates. See ROADMAP.md.
        */}
        <button
          type="button"
          className="press"
          style={{
            aspectRatio: '1',
            borderRadius: 16,
            border: `1.5px dashed ${color.lineDashed}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: color.goldLink,
          }}
        >
          <span style={{ fontSize: 26 }} aria-hidden="true">
            +
          </span>
          <span style={{ font: `600 11px ${font.sans}` }}>{t.upload}</span>
        </button>
      </div>
    </Screen>
  );
}
