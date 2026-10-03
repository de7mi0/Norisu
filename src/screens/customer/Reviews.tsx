import { Screen, ScreenHeader } from '../../components/Screen';
import { RATING_BARS, REVIEWS } from '../../data/reviews';
import { instantLabel } from '../../i18n';
import { useApp } from '../../state/context';
import { color, font, tile } from '../../theme';
import type { Review } from '../../types';

const REVIEW_TILES = [tile.sandFine, tile.taupeFine, tile.blushFine];

/** Ratings breakdown and customer reviews for the current salon. */
export function Reviews() {
  const { t, state, dispatch, isArabic, backIcon, salon, publicReviews } = useApp();

  // The sample catalogue keeps its sample reviews. A real salon shows its own
  // — and never the samples, which is what it used to show: invented
  // customers praising a salon none of them had visited.
  const demo = publicReviews.source === 'demo';
  const live = publicReviews.reviews;
  const reviews: Review[] = demo
    ? REVIEWS
    : live.map((review, index) => {
        const name = review.author ?? t.verifiedVisit;
        const date = instantLabel(review.createdAt, state.lang);
        return {
          initials: review.author
            ? review.author.split(' ').map((part) => part[0]).join('').slice(0, 2)
            : '✓',
          name,
          arName: name,
          date,
          arDate: date,
          service: review.servicesEn,
          arService: review.servicesAr,
          rating: review.rating,
          text: review.body,
          arText: review.body,
          tile: REVIEW_TILES[index % REVIEW_TILES.length],
        };
      });
  const replies = demo ? [] : live.map((review) => review.reply);
  const bars = demo
    ? RATING_BARS
    : [5, 4, 3, 2, 1].map((star) => ({
        star,
        pct: `${live.length ? Math.round((live.filter((r) => Math.round(r.rating) === star).length / live.length) * 100) : 0}%`,
      }));

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
          {bars.map((bar) => (
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
        {publicReviews.source === 'loading' ? (
          <p style={{ font: `500 12px ${font.sans}`, color: color.mutedFaint, textAlign: 'center' }}>…</p>
        ) : publicReviews.source === 'error' ? (
          // Not "no reviews yet": that would be a claim about the salon, and a
          // failed read knows nothing about it.
          <p style={{ font: `500 12px/1.5 ${font.sans}`, color: color.danger, textAlign: 'center' }}>
            {t.reviewsError}
          </p>
        ) : !demo && reviews.length === 0 ? (
          <p style={{ font: `500 12px/1.5 ${font.sans}`, color: color.mutedFaint, textAlign: 'center' }}>
            {t.reviewsNone}
          </p>
        ) : null}
        {reviews.map((review, index) => (
          <article
            key={`${review.name}-${index}`}
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
            {replies[index] ? (
              <div
                style={{
                  margin: '10px 0 0',
                  background: color.surfaceWarm,
                  borderInlineStart: `3px solid ${color.gold}`,
                  borderRadius: 8,
                  padding: '8px 11px',
                }}
              >
                <div style={{ font: `700 10.5px ${font.sans}`, color: color.goldDeep }}>{t.salonReplied}</div>
                <p style={{ font: `400 12px/1.5 ${font.sans}`, color: color.inkSoft, margin: '3px 0 0' }}>
                  {replies[index]}
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </Screen>
  );
}
