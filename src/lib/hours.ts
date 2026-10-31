/**
 * Is a salon open right now, and until when — from its own working hours.
 *
 * The salon page used to say "Open now · until 11:00 PM" for every salon at
 * every hour, which is the most checkable lie an app can tell: somebody walks
 * there at midnight. This answers from `working_hours`, in Riyadh time, because
 * that is the time the hours are written in whatever the phone's clock says.
 *
 * Pure, so it can be tested without a browser.
 */

/** One day's opening, in the salon's own local time. */
export interface OpeningHours {
  /** 0 = Sunday, matching Postgres' extract(dow) and working_hours. */
  day: number;
  /** "HH:MM", 24-hour. */
  opens: string;
  closes: string;
}

export type OpeningStatus =
  | { open: true; closes: string }
  | { open: false; opens: string; inDays: number }
  | { open: false; opens: null; inDays: null };

function riyadhNow(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** "10:00:00" from the database, or "10:00", to "10:00". */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

export function openingStatus(hours: OpeningHours[], now: Date = new Date()): OpeningStatus {
  if (hours.length === 0) return { open: false, opens: null, inDays: null };
  const { day, minutes } = riyadhNow(now);

  // A salon can have more than one opening on a day (a break at midday), so
  // look at every one of today's, earliest first.
  const today = hours
    .filter((h) => h.day === day)
    .sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens));
  for (const h of today) {
    if (minutes >= toMinutes(h.opens) && minutes < toMinutes(h.closes)) {
      return { open: true, closes: shortTime(h.closes) };
    }
  }
  const laterToday = today.find((h) => toMinutes(h.opens) > minutes);
  if (laterToday) return { open: false, opens: shortTime(laterToday.opens), inDays: 0 };

  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const next = hours
      .filter((h) => h.day === (day + ahead) % 7)
      .sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens))[0];
    if (next) return { open: false, opens: shortTime(next.opens), inDays: ahead };
  }
  return { open: false, opens: null, inDays: null };
}
