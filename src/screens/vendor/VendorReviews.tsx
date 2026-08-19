import { SampleDataNotice } from '../../components/SampleDataNotice';
import { Screen, ScreenHeader } from '../../components/Screen';
import { VENDOR_REVIEWS } from '../../data/vendor';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Reviews left for the salon, with the owner's published replies. */
export function VendorReviews() {
  const { t, dispatch, isArabic, backIcon } = useApp();

  return (
    <Screen bottomInset={40}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'go', screen: 'v_more' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.reviewsTitle}
      />

      <SampleDataNotice section="reviews" />

      <div style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {VENDOR_REVIEWS.map((review) => {
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
                  ★ {review.rating}
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
        })}
        <div style={{ textAlign: 'center', font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
          {t.tapReview}
        </div>
      </div>
    </Screen>
  );
}
