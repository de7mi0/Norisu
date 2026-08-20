import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_REVIEWS } from '../../data/vendor';
import type { SalonReview } from '../../data/vendorBookings';
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
              <LiveReview key={review.id} review={review} lang={state.lang} />
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
    </Screen>
  );
}

/**
 * One real review. Unpublished ones are shown and marked: hiding a complaint
 * from the business it is about would help nobody, and the owner cannot act on
 * what they cannot see.
 */
function LiveReview({ review, lang }: { review: SalonReview; lang: 'en' | 'ar' }) {
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
              {review.customerName ?? t.bookingRef}
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

      {review.reply ? (
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
          {review.reply}
        </div>
      ) : null}
    </article>
  );
}
