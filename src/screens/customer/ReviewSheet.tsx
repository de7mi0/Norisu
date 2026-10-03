import { useId, useState } from 'react';
import { SheetModal } from '../../components/SheetModal';
import { REVIEW_MAX_LENGTH } from '../../data/customerReviews';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { Booking } from '../../types';

/**
 * Writing a review of a visit the salon has marked complete.
 *
 * Stars are a radio group — five real buttons with `aria-checked`, so a
 * screen reader says "4 of 5 stars, checked" rather than "star star star".
 * Posting is final: authenticated has no UPDATE on reviews (0006), because a
 * review a customer could keep rewriting is one a salon could pressure them
 * into rewriting, and the sheet says so before they post.
 */
export function ReviewSheet({ booking }: { booking: Booking }) {
  const { t, dispatch, isArabic, submitReview } = useApp();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyId = useId();

  const post = async () => {
    if (busy || rating === 0) return;
    setBusy(true);
    await submitReview(booking, rating, body);
    setBusy(false);
  };

  return (
    <SheetModal
      title={t.writeReview}
      cancelLabel={t.cancel}
      saveLabel={busy ? t.saving : t.postReview}
      saveDisabled={rating === 0 || busy}
      onCancel={() => dispatch({ type: 'closeReview' })}
      onSave={() => void post()}
    >
      <p style={{ font: `600 13px ${font.sans}`, margin: '-6px 0 12px', color: color.mutedSoft }}>
        {isArabic ? booking.salonAr : booking.salon}
      </p>

      <div
        role="radiogroup"
        aria-label={t.yourRating}
        style={{ display: 'flex', gap: 6, marginBottom: 14, direction: 'ltr', justifyContent: 'center' }}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={isArabic ? `${star} من 5 نجوم` : `${star} of 5 stars`}
            onClick={() => setRating(star)}
            className="press"
            style={{
              fontSize: 32,
              lineHeight: 1,
              padding: 4,
              color: star <= rating ? color.gold : '#ddd5c4',
            }}
          >
            ★
          </button>
        ))}
      </div>

      <label
        htmlFor={bodyId}
        style={{ display: 'block', font: `600 11px ${font.sans}`, color: color.mutedSoft, marginBottom: 5 }}
      >
        {t.reviewBodyLabel}
      </label>
      <textarea
        id={bodyId}
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, REVIEW_MAX_LENGTH))}
        maxLength={REVIEW_MAX_LENGTH}
        rows={4}
        placeholder={t.reviewBodyPlaceholder}
        dir={isArabic ? 'rtl' : 'ltr'}
        style={{
          width: '100%',
          background: color.surfaceWarm,
          border: `1.5px solid ${color.lineWarm}`,
          borderRadius: 12,
          padding: 13,
          font: `500 14px/1.5 ${font.sans}`,
          outline: 'none',
          resize: 'vertical',
        }}
      />
      <p style={{ font: `500 10.5px/1.5 ${font.sans}`, color: color.mutedFaint, margin: '6px 0 14px' }}>
        {t.reviewFinalNote}
      </p>
    </SheetModal>
  );
}
