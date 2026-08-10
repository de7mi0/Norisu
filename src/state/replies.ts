import type { ChatMessage } from '../types';

/** Longest message accepted from the composer, to keep bubbles bounded. */
export const MAX_MESSAGE_LENGTH = 500;

/** Longest value accepted in a vendor form field. */
export const MAX_FIELD_LENGTH = 60;

export const SALON_GREETING: ChatMessage = {
  who: 'salon',
  en: 'Hi! 👋 This is Maison Noir. How can we help you today?',
  ar: 'مرحباً! 👋 معك ميزون نوار. كيف نقدر نساعدك اليوم؟',
};

export const SALON_AUTO_REPLY: ChatMessage = {
  who: 'salon',
  en: 'Thanks for reaching out! 💛 A team member will confirm the details shortly.',
  ar: 'شكراً لتواصلك! 💛 سيؤكد أحد أعضاء الفريق التفاصيل قريباً.',
};

export const BOT_GREETING: ChatMessage = {
  who: 'bot',
  en: "Hi, I'm the Saloni Assistant 🤖 I can help with bookings, issues, or feedback. What's on your mind?",
  ar: 'مرحباً، أنا مساعد صالوني 🤖 أقدر أساعدك في الحجوزات أو المشاكل أو الملاحظات. كيف أقدر أخدمك؟',
};

const REFUND_PATTERN = /refund|money|استرجاع|مبلغ/i;

const REFUND_REPLY: ChatMessage = {
  who: 'bot',
  en: 'I understand — refund requests are reviewed within 24 hours. I’ve flagged this for the salon manager. 🙏',
  ar: 'أتفهّم — تُراجع طلبات الاسترجاع خلال 24 ساعة. رفعت طلبك لمدير الصالون. 🙏',
};

const GENERAL_REPLY: ChatMessage = {
  who: 'bot',
  en: 'Got it — I’ve logged that and shared it with the salon. Someone will follow up with you shortly. Anything else?',
  ar: 'تمام — سجّلت ملاحظتك وشاركتها مع الصالون. سيتم التواصل معك قريباً. تحتاج شيئاً آخر؟',
};

/** Picks the assistant's scripted answer for a free-text message. */
export function botReplyFor(message: string): ChatMessage {
  return REFUND_PATTERN.test(message) ? REFUND_REPLY : GENERAL_REPLY;
}

export type BotTopicKey = 'issue' | 'booking' | 'feedback' | 'salon';

interface BotTopic {
  key: BotTopicKey;
  label: { en: string; ar: string };
  /** The message posted on the customer's behalf. Absent for topics that navigate. */
  user?: { en: string; ar: string };
  /** The assistant's scripted response. */
  bot?: { en: string; ar: string };
}

export const BOT_TOPICS: BotTopic[] = [
  {
    key: 'issue',
    label: { en: 'Report an issue', ar: 'الإبلاغ عن مشكلة' },
    user: { en: 'Report an issue', ar: 'الإبلاغ عن مشكلة' },
    bot: {
      en: 'I’m sorry to hear that. 😔 Please describe what went wrong — I’ll make sure the salon’s manager sees it right away.',
      ar: 'أعتذر لسماع ذلك. 😔 صف لنا ما حدث — سأحرص على وصوله لمدير الصالون فوراً.',
    },
  },
  {
    key: 'booking',
    label: { en: 'Booking help', ar: 'مساعدة في الحجز' },
    user: { en: 'Booking help', ar: 'مساعدة في الحجز' },
    bot: {
      en: 'Happy to help! You can reschedule or cancel any appointment from My Bookings. Want me to take you there?',
      ar: 'بكل سرور! تقدر تعيد الجدولة أو تلغي أي موعد من «حجوزاتي». أوديك هناك؟',
    },
  },
  {
    key: 'feedback',
    label: { en: 'Give feedback', ar: 'إرسال ملاحظات' },
    user: { en: 'Give feedback', ar: 'إرسال ملاحظات' },
    bot: {
      en: 'We’d love that 🌟 Tell me about your last visit — the good and the not-so-good.',
      ar: 'يسعدنا ذلك 🌟 خبّرني عن زيارتك الأخيرة — الحلو وغير الحلو.',
    },
  },
  {
    key: 'salon',
    label: { en: 'Message the salon', ar: 'مراسلة الصالون' },
  },
];

/** Delays that make the simulated conversation feel alive. */
export const REPLY_DELAY = {
  salon: 1100,
  bot: 900,
  botTopic: 800,
  toast: 1700,
  seatOpens: 3200,
} as const;
