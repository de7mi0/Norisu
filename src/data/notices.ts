/**
 * Booking confirmations and reminders (0028) are sent by the notification
 * worker, not from here. All the app needs to know is whether they are on, so
 * the confirmation screen offers a reminder only when one will be sent.
 */
import { supabase } from '../lib/supabase';

export async function remindersEnabled(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('reminders_on');
    return !error && data === true;
  } catch {
    return false;
  }
}
