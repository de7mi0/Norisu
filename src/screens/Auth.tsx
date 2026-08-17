import { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../state/context';
import { CODE_LENGTH, isPhoneOtpEnabled, type AuthFailure } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Dictionary } from '../i18n';
import { color, font } from '../theme';

/** How long before "resend" becomes available. Supabase rate-limits below this. */
const RESEND_AFTER_MS = 60_000;

/** Counts the seconds left before another passcode may be requested. */
function useResendCountdown(sentAt: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sentAt) return;
    // Resync first: `now` was captured when the sheet mounted, a step earlier,
    // which would otherwise start the countdown a second over the top.
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [sentAt]);

  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000));
}

function failureText(failure: AuthFailure, t: Dictionary): string {
  switch (failure.code) {
    case 'notConfigured':
      return t.authNoBackend;
    case 'invalidEmail':
      return t.authBadEmail;
    case 'invalidPhone':
      return t.authBadPhone;
    case 'invalidCode':
      return t.authBadCode;
    case 'expiredCode':
      return t.authExpiredCode;
    case 'rateLimited':
      return t.authTooMany;
    case 'providerDisabled':
      return t.authProviderOff;
    case 'network':
      return t.authOffline;
    default:
      // No translated sentence fits, so pass on what the backend said rather
      // than replacing a specific problem with a vague one.
      return failure.detail || t.authFailed;
  }
}

/**
 * Sign-in, in two steps: an identifier, then the passcode sent to it. It floats
 * over whatever screen opened it, because signing in is never the destination —
 * the customer was on their way somewhere else.
 */
export function Auth() {
  const { t, state, dispatch, requestPasscode, submitPasscode, backIcon } = useApp();
  const { channel, identifier, code, step, pending, error, sentAt } = state.authForm;

  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();
  const field = useRef<HTMLInputElement>(null);
  const secondsLeft = useResendCountdown(sentAt);

  const onCodeStep = step === 'code';

  // Move focus to whichever field the step is asking about, including after the
  // step changes, so the passcode can be typed without reaching for the screen.
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch({ type: 'closeAuth' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);

  const canSubmit = onCodeStep ? code.length === CODE_LENGTH : identifier.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'absolute',
        inset: 0,
        background: color.page,
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideup .28s ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '52px 24px 0' }}>
        <button
          type="button"
          onClick={() =>
            onCodeStep
              ? dispatch({ type: 'authEditIdentifier' })
              : dispatch({ type: 'closeAuth' })
          }
          aria-label={onCodeStep ? t.authChange : t.cancel}
          className="press"
          style={{
            width: 38,
            height: 38,
            flex: 'none',
            borderRadius: '50%',
            background: color.surfaceSand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
          }}
        >
          {onCodeStep ? backIcon : '✕'}
        </button>
        <div>
          <h1 id={titleId} style={{ font: `600 22px ${font.serif}`, margin: 0 }}>
            {onCodeStep ? t.authCodeTitle : t.authTitle}
          </h1>
          <div style={{ font: `500 11px ${font.sans}`, color: color.mutedSoft }}>
            {onCodeStep ? t.authStep2 : t.authStep1}
          </div>
        </div>
      </div>

      <form
        // The browser's own validation bubble follows the browser's language,
        // not the app's, and would pre-empt the translated message below the
        // field. `type` stays set — it still picks the right on-screen keyboard.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (onCodeStep) submitPasscode();
          else requestPasscode();
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 24px 28px' }}
      >
        {/* Says why the form appeared, when it interrupted something. */}
        {state.authReason === 'booking' && !onCodeStep ? (
          <p
            style={{
              font: `600 12.5px/1.6 ${font.sans}`,
              color: '#8a6d14',
              background: color.cream,
              border: `1px solid ${color.creamLine}`,
              borderRadius: 12,
              padding: '11px 13px',
              margin: '0 0 16px',
            }}
          >
            {t.authWhyBooking}
          </p>
        ) : null}

        <p
          id={hintId}
          style={{
            font: `500 13px/1.6 ${font.sans}`,
            color: color.muted,
            margin: '0 0 18px',
          }}
        >
          {onCodeStep ? (
            <>
              {t.authSentTo}{' '}
              <span className="ltr-run" style={{ font: `600 13px ${font.mono}`, color: color.ink }}>
                {identifier}
              </span>
            </>
          ) : channel === 'phone' ? (
            t.authPhoneHint
          ) : (
            t.authEmailHint
          )}
        </p>

        {/* Only offered when the project has an SMS provider; see supabase/README.md. */}
        {!onCodeStep && isPhoneOtpEnabled ? (
          <div
            role="group"
            aria-label={t.authChannel}
            style={{
              display: 'flex',
              gap: 6,
              background: color.surfaceSand,
              border: `1px solid ${color.lineSand}`,
              borderRadius: 14,
              padding: 4,
              marginBottom: 14,
            }}
          >
            {(['phone', 'email'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => dispatch({ type: 'setAuthChannel', channel: option })}
                aria-pressed={channel === option}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 11,
                  font: `600 12px ${font.sans}`,
                  background: channel === option ? color.gold : 'transparent',
                  color: channel === option ? color.goldInkAlt : color.muted,
                }}
              >
                {option === 'phone' ? t.authPhone : t.authEmail}
              </button>
            ))}
          </div>
        ) : null}

        <label
          htmlFor={fieldId}
          style={{
            display: 'block',
            font: `600 11px ${font.sans}`,
            letterSpacing: '.08em',
            color: color.mutedSoft,
            marginBottom: 7,
          }}
        >
          {onCodeStep ? t.authCodeLabel : channel === 'phone' ? t.authPhone : t.authEmail}
        </label>
        <input
          id={fieldId}
          ref={field}
          value={onCodeStep ? code : identifier}
          onChange={(event) =>
            dispatch(
              onCodeStep
                ? { type: 'setAuthCode', value: event.target.value }
                : { type: 'setAuthIdentifier', value: event.target.value },
            )
          }
          // Both the number and the passcode read left-to-right even in Arabic.
          dir="ltr"
          type={onCodeStep ? 'text' : channel === 'phone' ? 'tel' : 'email'}
          inputMode={onCodeStep || channel === 'phone' ? 'numeric' : 'email'}
          autoComplete={onCodeStep ? 'one-time-code' : channel === 'phone' ? 'tel' : 'email'}
          // No placeholder on the passcode field: at this letter-spacing any
          // stand-in reads as digits already typed.
          placeholder={onCodeStep ? '' : channel === 'phone' ? '05X XXX XXXX' : 'you@example.com'}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          disabled={pending}
          style={{
            width: '100%',
            background: color.surface,
            border: `1.5px solid ${error ? color.danger : color.lineWarm}`,
            borderRadius: 13,
            padding: '14px 15px',
            font: onCodeStep
              ? `600 20px/1 ${font.mono}`
              : `500 15px ${font.sans}`,
            letterSpacing: onCodeStep ? '.34em' : undefined,
            textAlign: onCodeStep ? 'center' : 'start',
            outline: 'none',
            opacity: pending ? 0.6 : 1,
          }}
        />

        {/* aria-live so a failure is announced, not just recoloured. */}
        <div role="status" aria-live="polite" style={{ minHeight: 20, marginTop: 9 }}>
          {error ? (
            <span style={{ font: `500 12px/1.5 ${font.sans}`, color: color.danger }}>
              {failureText(error, t)}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="press"
          style={{
            width: '100%',
            marginTop: 6,
            padding: 15,
            borderRadius: 14,
            background: pending || !canSubmit ? color.disabled : color.gold,
            color: pending || !canSubmit ? color.surface : color.goldInk,
            font: `700 14px ${font.sans}`,
            cursor: pending || !canSubmit ? 'default' : 'pointer',
          }}
        >
          {pending ? t.authWorking : onCodeStep ? t.authVerify : t.authSend}
        </button>

        {onCodeStep ? (
          <button
            type="button"
            onClick={requestPasscode}
            disabled={pending || secondsLeft > 0}
            style={{
              width: '100%',
              marginTop: 14,
              font: `600 12px ${font.sans}`,
              color: secondsLeft > 0 ? color.mutedFaint : color.goldLink,
              textAlign: 'center',
            }}
          >
            {secondsLeft > 0 ? (
              <>
                {t.authResendIn}{' '}
                <span className="ltr-run">{secondsLeft}s</span>
              </>
            ) : (
              t.authResend
            )}
          </button>
        ) : null}

        {!isSupabaseConfigured ? (
          <p
            style={{
              font: `500 11.5px/1.6 ${font.sans}`,
              color: color.mutedSoft,
              background: color.surfaceWarm,
              border: `1px solid ${color.lineWarm}`,
              borderRadius: 12,
              padding: '11px 13px',
              margin: '18px 0 0',
            }}
          >
            {t.authNoBackend}
          </p>
        ) : null}

        <p
          style={{
            font: `500 11px/1.6 ${font.sans}`,
            color: color.mutedFaint,
            margin: '18px 0 0',
            textAlign: 'start',
          }}
        >
          {t.authNoPassword}
        </p>
      </form>
    </div>
  );
}
