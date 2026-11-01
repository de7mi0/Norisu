import { useRef, useState } from 'react';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_GALLERY } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import { canFrame } from '../../lib/images';
import { PhotoCropSheet } from './PhotoCropSheet';
import { SheetModal } from '../../components/SheetModal';
import { ALT_MAX_LENGTH, type SalonPhoto } from '../../data/photos';

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
  const {
    t,
    dispatch,
    isArabic,
    backIcon,
    owner,
    photos,
    photoBusy,
    addPhoto,
    removePhoto,
    setCoverPhoto,
    describePhoto,
  } = useApp();
  // The photograph whose description is being written, and the two drafts.
  const [describing, setDescribing] = useState<SalonPhoto | null>(null);
  const [altEn, setAltEn] = useState('');
  const [altAr, setAltAr] = useState('');
  const startDescribing = (photo: SalonPhoto) => {
    setDescribing(photo);
    setAltEn(photo.alt);
    setAltAr(photo.altAr);
  };

  const picker = useRef<HTMLInputElement>(null);
  const ownsSalon = owner.salon !== null;
  // Picked but not yet framed. Uploading waits for the crop sheet, so what
  // reaches the salon's page is what the owner chose to show.
  const [framing, setFraming] = useState<File | null>(null);

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
          // A file that cannot be framed goes straight on, so the owner hears
          // why it was refused rather than meeting a sheet with no picture.
          if (file) {
            if (canFrame(file)) setFraming(file);
            else void addPhoto(file);
          }
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
                  alt={isArabic ? photo.altAr || photo.alt : photo.alt || photo.altAr}
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
                {/* What it shows, for customers using a screen reader. Marked
                    until written, so a missing description is visible. */}
                <button
                  type="button"
                  className="press"
                  onClick={() => startDescribing(photo)}
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    insetInlineStart: 8,
                    background: photo.alt || photo.altAr ? 'rgba(255,255,255,0.92)' : color.gold,
                    color: photo.alt || photo.altAr ? color.inkSoft : color.goldInk,
                    font: `600 9px ${font.sans}`,
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {photo.alt || photo.altAr ? t.photoDescribed : t.photoDescribe}
                </button>
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
      {framing ? (
        <PhotoCropSheet
          file={framing}
          isCover={photos.length === 0}
          onCancel={() => setFraming(null)}
          onUnreadable={() => {
            setFraming(null);
            void addPhoto(framing);
          }}
          onConfirm={(crop) => {
            setFraming(null);
            void addPhoto(framing, crop);
          }}
        />
      ) : null}
      {describing ? (
        <SheetModal
          title={t.photoDescribeTitle}
          cancelLabel={t.cancel}
          saveLabel={t.saveChanges}
          saveDisabled={!altEn.trim() || !altAr.trim()}
          onCancel={() => setDescribing(null)}
          onSave={() => {
            void describePhoto(describing.id, altEn, altAr).then((saved) => {
              if (saved) setDescribing(null);
            });
          }}
        >
          <p style={{ font: `500 12px/1.55 ${font.sans}`, color: color.muted, margin: '0 0 12px' }}>
            {t.photoDescribeHint}
          </p>
          <label style={{ display: 'block', font: `600 11px ${font.sans}`, color: color.mutedSoft }}>
            {t.photoDescribeEn}
            <textarea
              value={altEn}
              dir="ltr"
              maxLength={ALT_MAX_LENGTH}
              onChange={(event) => setAltEn(event.target.value)}
              rows={2}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: 12,
                borderRadius: 12,
                border: `1.5px solid ${color.lineWarm}`,
                background: color.surfaceWarm,
                font: `500 13px/1.5 ${font.sans}`,
                color: color.ink,
                resize: 'none',
              }}
            />
          </label>
          <label style={{ display: 'block', marginTop: 12, font: `600 11px ${font.sans}`, color: color.mutedSoft }}>
            {t.photoDescribeAr}
            <textarea
              value={altAr}
              dir="rtl"
              maxLength={ALT_MAX_LENGTH}
              onChange={(event) => setAltAr(event.target.value)}
              rows={2}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: 12,
                borderRadius: 12,
                border: `1.5px solid ${color.lineWarm}`,
                background: color.surfaceWarm,
                font: `500 13px/1.5 ${font.sans}`,
                color: color.ink,
                resize: 'none',
              }}
            />
          </label>
        </SheetModal>
      ) : null}
    </Screen>
  );
}
