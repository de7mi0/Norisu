import { Screen, ScreenHeader } from '../../components/Screen';
import { RATING_BARS, REVIEWS } from '../../data/reviews';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/** Ratings breakdown and customer reviews for the current salon. */
export function Reviews() {
  const { t, dispatch, isArabic, backIcon, salon } = useApp();

  return (
    <Screen bottomInset={30}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'back' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.ratingsReviews}
      />

      <div
        style={{
          margin: '20px 24px 0',
          display: 'flex',
          gap: 18,
          alignItems: 'center',
          background: color.surfaceWarm,
          border: `1px solid ${color.lineWarm}`,
          borderRadius: 18,
          padding: 18,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ font: `600 42px/1 ${font.serif}` }}>
            {salon.rating ?? (isArabic ? 'جديد' : 'New')}
          </div>
          <div style={{ font: `500 11px ${font.sans}`, color: color.goldDeep }} aria-hidden="true">
            ★★★★★
          </div>
          <div style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft, marginTop: 2 }}>
            {isArabic ? `${salon.reviews} تقييم` : `${salon.reviews} reviews`}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {RATING_BARS.map((bar) => (
            <div key={bar.star} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{ font: `500 10px ${font.sans}`, color: color.mutedSoft, width: 8 }}
              >
                {bar.star}
              </span>
              <span
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: '#eae3d4',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{ display: 'block', height: '100%', width: bar.pct, background: color.gold }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {REVIEWS.map((review) => (
          <article
            key={review.name}
            style={{ borderBottom: `1px solid ${color.lineFaint}`, paddingBottom: 16 }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: review.tile,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: `700 13px ${font.sans}`,
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
                    {isArabic ? review.arDate : review.date} ·{' '}
                    {isArabic ? review.arService : review.service}
                  </span>
                </span>
              </div>
              <span style={{ font: `600 11px ${font.sans}`, color: color.goldDeep }}>
                ★ {review.rating}
              </span>
            </div>
            <p
              style={{
                font: `400 12.5px/1.55 ${font.sans}`,
                color: color.inkSoft,
                margin: '10px 0 0',
              }}
            >
              {isArabic ? review.arText : review.text}
            </p>
          </article>
        ))}
      </div>
    </Screen>
  );
}
