import { useRef } from 'react';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_GALLERY } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * The salon's photographs.
 *
 * The upload button had no handler at all until now — the last
 * `TODO(roadmap A2)` marker in the codebase. What it does when tapped is open
 * the phone's own picker; everything after that (orientation, resizing, and
 * removing the GPS coordinates a phone photograph carries) happens in
 * `lib/images.ts` before a single byte is uploaded.
 *
 * An owner with no salon still sees the sample tiles, same as the rest of the
 * portal, because the portal stays browsable signed out on purpose.
 */
export function Gallery() {
  const { t, dispatch, isArabic, backIcon, owner, photos, photoBusy, addPhoto, removePhoto, setCoverPhoto } =
    useApp();

  const picker = useRef<HTMLInputElement>(null);
  const ownsSalon = owner.salon !== null;

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

      {/* Said out loud, because it is the reassuring half of a real concern:
          a phone photograph carries the coordinates of where it was taken. */}
      {ownsSalon ? (
        <p
          style={{
            font: `500 11px/1.55 ${font.sans}`,
            color: color.mutedFaint,
            padding: '8px 24px 0',
            margin: 0,
          }}
        >
          {t.photoStripped}
        </p>
      ) : null}

      {/* One input, opened by the tile below. Hidden rather than styled: a
          file input cannot be made to look like anything else reliably. */}
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = '';
          if (file) void addPhoto(file);
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '18px 24px 0',
        }}
      >
        {ownsSalon
          ? photos.map((photo) => (
              <div
                key={photo.id}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: color.surfaceSand,
                  border: `1px solid ${color.lineSand}`,
                }}
              >
                <img
                  src={photo.url}
                  alt={photo.alt}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {photo.isCover ? (
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
                ) : (
                  <button
                    type="button"
                    className="press"
                    onClick={() => void setCoverPhoto(photo.id)}
                    style={{
                      position: 'absolute',
                      top: 8,
                      insetInlineStart: 8,
                      background: 'rgba(255,255,255,0.92)',
                      color: color.goldLink,
                      font: `600 9px ${font.sans}`,
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {t.photoSetCover}
                  </button>
                )}
                <button
                  type="button"
                  className="press"
                  onClick={() => void removePhoto(photo)}
                  aria-label={t.photoRemove}
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    insetInlineEnd: 8,
                    background: 'rgba(255,255,255,0.92)',
                    color: color.inkSoft,
                    font: `600 9px ${font.sans}`,
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t.photoRemove}
                </button>
              </div>
            ))
          : VENDOR_GALLERY.map((item, index) => (
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

        <button
          type="button"
          className="press"
          disabled={!ownsSalon || photoBusy}
          onClick={() => picker.current?.click()}
          style={{
            aspectRatio: '1',
            borderRadius: 16,
            border: `1.5px dashed ${color.lineDashed}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: ownsSalon ? color.goldLink : color.disabled,
            cursor: ownsSalon && !photoBusy ? 'pointer' : 'default',
          }}
        >
          <span style={{ fontSize: 26 }} aria-hidden="true">
            +
          </span>
          <span style={{ font: `600 11px ${font.sans}` }}>
            {photoBusy ? t.photoUploading : t.upload}
          </span>
        </button>
      </div>

      {ownsSalon && photos.length === 0 ? (
        <p
          style={{
            font: `500 11.5px ${font.sans}`,
            color: color.mutedFaint,
            padding: '14px 24px 0',
            margin: 0,
          }}
        >
          {t.photoEmpty}
        </p>
      ) : null}
    </Screen>
  );
}
