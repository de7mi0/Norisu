import { useState } from 'react';
import { SampleDataNotice } from '../../components/SampleDataNotice';
import { SheetField, SheetModal } from '../../components/SheetModal';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_REVIEWS } from '../../data/vendor';
import type { SalonReview } from '../../data/vendorBookings';
import { REPLY_MAX_LENGTH } from '../../data/vendorBookings';
import { instantLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font, tile } from '../../theme';

/**
 * The initial shown in the avatar circle. Falls back to a dash rather than a
 * random letter when the reviewer never gave a name — see data/vendorBookings.
 */
function initialOf(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || '—';
}

/** Reviews left for the salon, with the owner's published replies. */
export function VendorReviews() {
  const { t, state, dispatch, isArabic, backIcon, vendorReviews } = useApp();

  const live = vendorReviews.source === 'live';

  // Which review is being answered. Local to this screen rather than the
  // reducer: no other screen has any use for it.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const answering = vendorReviews.reviews.find((review) => review.id === replyTo);

  return (
    <Screen bottomInset={40}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.reviewsTitle}
      />

      <SampleDataNotice section={live ? undefined : 'reviews'} />

      <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {live ? (
          // A salon nobody has reviewed yet is the ordinary case for a new
          // business, so it gets a sentence rather than an empty screen.
          vendorReviews.reviews.length === 0 ? (
            <div
              style={{
                border: `1px dashed ${color.lineDashed}`,
                borderRadius: 12,
                padding: '18px 14px',
                textAlign: 'center',
                font: `500 12px/1.5 ${font.sans}`,
                color: color.mutedSoft,
              }}
            >
              {t.noReviewsYet}
            </div>
          ) : (
            vendorReviews.reviews.map((review) => (
              <LiveReview
                key={review.id}
                review={review}
                lang={state.lang}
                onReply={() => setReplyTo(review.id)}
              />
            ))
          )
        ) : (
          VENDOR_REVIEWS.map((review) => {
            const reply = isArabic ? review.arReply : review.reply;
            return (
              <article
                key={review.name}
                style={{
                  border: `1px solid ${color.lineWarm}`,
                  borderRadius: 16,
                  padding: 14,
                  background: color.surface,
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: review.tile,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        font: `700 12px ${font.sans}`,
                        color: '#8a7a4e',
                      }}
                    >
                      {review.initials}
                    </span>
                    <span>
                      <span style={{ display: 'block', font: `600 13px ${font.sans}` }}>
                        {isArabic ? review.arName : review.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          font: `500 10px ${font.sans}`,
                          color: color.mutedSoft,
                        }}
                      >
                        {isArabic ? review.arDate : review.date}
                      </span>
                    </span>
                  </div>
                  <span style={{ font: `600 11px ${font.sans}`, color: color.goldDeep }}>
                    ★ <span className="ltr-run">{review.rating}</span>
                  </span>
                </div>

                <p
                  style={{
                    font: `400 12.5px/1.5 ${font.sans}`,
                    color: color.inkSoft,
                    margin: '10px 0 0',
                  }}
                >
                  {isArabic ? review.arText : review.text}
                </p>

                {reply ? (
                  <div
                    style={{
                      marginTop: 10,
                      background: color.surfaceWarm,
                      borderRadius: 12,
                      padding: '10px 12px',
                      font: `500 11.5px/1.5 ${font.sans}`,
                      color: color.muted,
                    }}
                  >
                    <span style={{ color: color.goldLink, fontWeight: 600 }}>{t.ownerReply}</span>
                    {reply}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
        {/* Replying is still not built, so only the sample screen invites it. */}
        {live ? null : (
          <div
            style={{ textAlign: 'center', font: `500 11px ${font.sans}`, color: color.mutedSoft }}
          >
            {t.tapReview}
          </div>
        )}
      </div>

      {answering ? (
        <ReplySheet review={answering} onClose={() => setReplyTo(null)} />
      ) : null}
    </Screen>
  );
}

/**
 * One real review. Unpublished ones are shown and marked: hiding a complaint
 * from the business it is about would help nobody, and the owner cannot act on
 * what they cannot see.
 */
function LiveReview({
  review,
  lang,
  onReply,
}: {
  review: SalonReview;
  lang: 'en' | 'ar';
  onReply: () => void;
}) {
  const { t } = useApp();

  return (
    <article
      style={{
        border: `1px solid ${color.lineWarm}`,
        borderRadius: 16,
        padding: 14,
        background: color.surface,
        opacity: review.isPublished ? 1 : 0.75,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: tile.sandFine,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: `700 12px ${font.sans}`,
              color: '#8a7a4e',
            }}
          >
            {initialOf(review.customerName)}
          </span>
          <span>
            <span style={{ display: 'block', font: `600 13px ${font.sans}` }}>
              {review.customerName ?? t.anonymousCustomer}
            </span>
            <span
              style={{ display: 'block', font: `500 10px ${font.sans}`, color: color.mutedSoft }}
            >
              {instantLabel(review.createdAt, lang)}
            </span>
          </span>
        </div>
        <span style={{ font: `600 11px ${font.sans}`, color: color.goldDeep }}>
          ★ <span className="ltr-run">{review.rating.toFixed(1)}</span>
        </span>
      </div>

      {review.body ? (
        <p
          style={{ font: `400 12.5px/1.5 ${font.sans}`, color: color.inkSoft, margin: '10px 0 0' }}
        >
          {review.body}
        </p>
      ) : null}

      {review.isPublished ? null : (
        <div style={{ font: `600 10.5px ${font.sans}`, color: color.mutedSoft, marginTop: 8 }}>
          {t.reviewHidden}
        </div>
      )}

      {/* Answering goes through the 0007 function: 0006 left this table with no
          UPDATE privilege at all, so there is no way to write a reply directly. */}
      <button
        type="button"
        onClick={onReply}
        className="press"
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'start',
          marginTop: 10,
          background: review.reply ? color.surfaceWarm : 'transparent',
          border: review.reply ? 'none' : `1px dashed ${color.lineDashed}`,
          borderRadius: 12,
          padding: '10px 12px',
          font: `500 11.5px/1.5 ${font.sans}`,
          color: review.reply ? color.muted : color.goldLink,
          cursor: 'pointer',
        }}
      >
        {review.reply ? (
          <>
            <span style={{ color: color.goldLink, fontWeight: 600 }}>{t.ownerReply}</span>
            {review.reply}
          </>
        ) : (
          <span style={{ fontWeight: 600 }}>{t.replyTitle}</span>
        )}
      </button>
    </article>
  );
}

/** The reply form. Saving closes it; a failure leaves the text where it was. */
function ReplySheet({
  review,
  onClose,
}: {
  review: SalonReview;
  onClose: () => void;
}) {
  const { t, answerReview } = useApp();
  const [text, setText] = useState(review.reply);

  return (
    <SheetModal
      title={t.replyTitle}
      cancelLabel={t.cancel}
      saveLabel={t.save}
      onCancel={onClose}
      onSave={() => {
        void answerReview(review.id, text).then((saved) => {
          if (saved) onClose();
        });
      }}
    >
      <SheetField
        label={t.replyTitle}
        value={text}
        onChange={(value) => setText(value.slice(0, REPLY_MAX_LENGTH))}
        placeholder={t.replyPlaceholder}
        style={{ marginBottom: 14 }}
      />
      {review.reply ? (
        <button
          type="button"
          onClick={() => {
            void answerReview(review.id, '').then((saved) => {
              if (saved) onClose();
            });
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'center',
            marginBottom: 14,
            font: `600 12px ${font.sans}`,
            color: color.danger,
            cursor: 'pointer',
          }}
        >
          {t.replyRemove}
        </button>
      ) : null}
    </SheetModal>
  );
}
