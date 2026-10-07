/** Longest value accepted in a vendor form field. */
export const MAX_FIELD_LENGTH = 60;

/**
 * Delays, in milliseconds. The salon chat's canned auto-reply and the
 * assistant's scripted lines used to live here; both are gone — the salon
 * chat is a real conversation now (0025), and the assistant's answers are in
 * ./assistant.ts.
 */
export const REPLY_DELAY = {
  /**
   * A beat before the assistant answers. Not to pretend it is thinking: an
   * answer that lands in the same frame as the question is easy to miss.
   */
  bot: 450,
  toast: 1700,
} as const;
