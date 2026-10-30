/**
 * The Saloni Assistant: what it knows, and how it decides what was asked.
 *
 * It is a guide, not a model. Every answer below is written out in both
 * languages and checked against what the app actually does — the privacy
 * policy and terms in i18n are the source for the facts about payment,
 * cancelling and the waitlist — so it can be brief, but it cannot be wrong.
 * A question it does not recognise is not guessed at: it says so and offers a
 * person. That is the whole design, and the reason the old version had to go —
 * it told customers "I've flagged this for the salon manager" when nothing had
 * been sent anywhere.
 *
 * Pure and dependency-light on purpose, so the matching can be tested without
 * a browser, and so that swapping in a model later replaces `answerFor` and
 * nothing else.
 */
import { normalize } from '../lib/search';
import type { CustomerScreen } from '../types';

export type Bilingual = { en: string; ar: string };

export type TopicKey =
  | 'book'
  | 'change'
  | 'pay'
  | 'waitlist'
  | 'review'
  | 'account'
  | 'salonQuestion'
  | 'problem'
  | 'person';

/** What a button under one of the assistant's messages does. */
export type AssistantAction =
  | { kind: 'go'; screen: Extract<CustomerScreen, 'home' | 'bookings' | 'profile' | 'legal'>; label: Bilingual }
  | { kind: 'topic'; key: TopicKey; label: Bilingual }
  /** Offers the people who could help: the salon(s) involved, and Saloni. */
  | { kind: 'handoff'; label: Bilingual }
  /** Opens a conversation with one salon — or Saloni, when salonId is null. */
  | { kind: 'reach'; salonId: string | null; label: Bilingual }
  | { kind: 'inbox'; label: Bilingual };

export interface AssistantMessage {
  who: 'me' | 'bot';
  /** What the customer typed. Plain text, rendered as text. */
  text?: string;
  /** What the assistant said, in both languages so it follows the toggle. */
  say?: Bilingual;
  actions?: AssistantAction[];
}

interface Topic {
  key: TopicKey;
  /** The chip that asks this question. */
  label: Bilingual;
  answer: Bilingual;
  actions: AssistantAction[];
  /**
   * Words that suggest this topic. Matched after `normalize()` on both sides,
   * so `الغاء` here finds `إلغاء` typed, and `حجزة`/`حجزه` are one word.
   */
  keywords: string[];
}

const TALK: AssistantAction = {
  kind: 'handoff',
  label: { en: 'Talk to a person', ar: 'التحدث مع شخص' },
};

const MY_BOOKINGS: AssistantAction = {
  kind: 'go',
  screen: 'bookings',
  label: { en: 'Open my bookings', ar: 'افتح حجوزاتي' },
};

export const TOPICS: Topic[] = [
  {
    key: 'book',
    label: { en: 'How do I book?', ar: 'كيف أحجز؟' },
    answer: {
      en: 'Four steps: 1) open a salon from Explore, 2) tick the services you want, 3) choose a specialist — or “Any professional” — and a time, 4) tap “Confirm & pay”. You’ll be asked to sign in with a code the first time. Your appointment then appears under Bookings.',
      ar: 'أربع خطوات: ١) افتح صالوناً من «استكشف»، ٢) اختر الخدمات، ٣) اختر المختص — أو «أي مختص» — والوقت، ٤) اضغط «تأكيد والدفع». أول مرة سيُطلب منك تسجيل الدخول برمز. بعدها يظهر موعدك في «الحجوزات».',
    },
    actions: [
      { kind: 'go', screen: 'home', label: { en: 'Find a salon', ar: 'ابحث عن صالون' } },
    ],
    // Not "appointment" or موعد: those turn up in a question about every
    // topic — cancelling one, paying for one — and would win ties they
    // should lose.
    keywords: ['book', 'booking', 'reserve', 'make an', 'how do i get', 'احجز', 'حجز', 'اسوي موعد', 'احجز موعد'],
  },
  {
    key: 'change',
    label: { en: 'Cancel or change', ar: 'إلغاء أو تغيير موعد' },
    answer: {
      en: 'Open Bookings, find the appointment under Upcoming, and tap “Reschedule” to pick a new time or “Cancel” to call it off. Both are instant, and a cancelled time goes straight back on sale. Saloni charges no cancellation fee; a salon’s own late-cancellation rules are between you and them.',
      ar: 'افتح «الحجوزات»، واختر الموعد من «القادمة»، ثم اضغط «إعادة جدولة» لاختيار وقت جديد أو «إلغاء» لإلغائه. التغيير فوري، والوقت الملغى يعود متاحاً مباشرة. صالوني لا يأخذ رسوم إلغاء؛ وسياسة الصالون للإلغاء المتأخر بينك وبينه.',
    },
    actions: [MY_BOOKINGS],
    keywords: [
      'cancel', 'reschedule', 'change', 'move', 'postpone', 'late',
      'الغاء', 'الغي', 'الغ', 'تغيير', 'غير', 'اغير', 'تاجيل', 'اجل', 'نقل', 'اعادة جدوله',
    ],
  },
  {
    key: 'pay',
    label: { en: 'Payment & refunds', ar: 'الدفع والاسترجاع' },
    answer: {
      en: 'Nothing is paid through Saloni today. Choosing a payment method at checkout only records how you plan to pay — no money is taken and no card number is ever asked for. You pay the salon directly, so a refund is a matter for the salon; I can put you in touch with them.',
      ar: 'لا يتم أي دفع عبر صالوني حالياً. اختيار طريقة الدفع عند الحجز يسجّل فقط كيف تنوي الدفع — لا يُخصم أي مبلغ ولا يُطلب رقم بطاقة أبداً. الدفع يكون للصالون مباشرة، لذلك الاسترجاع يكون مع الصالون؛ أقدر أوصلك به.',
    },
    actions: [TALK],
    keywords: [
      'pay', 'payment', 'refund', 'money', 'card', 'charge', 'charged', 'price', 'cost', 'vat',
      'دفع', 'ادفع', 'استرجاع', 'استرداد', 'فلوس', 'مبلغ', 'بطاقه', 'سعر', 'اسعار', 'خصم', 'ضريبه',
    ],
  },
  {
    key: 'waitlist',
    label: { en: 'Fully booked?', ar: 'الصالون محجوز بالكامل؟' },
    answer: {
      en: 'Join the waitlist from the time screen. When someone cancels, the seat is held for whoever has waited longest for 15 minutes; if that’s you, a banner appears in the app (and a notification, if you allowed them) — tap “Take this seat” to book it. A place on the list isn’t an appointment until you take a seat.',
      ar: 'انضم لقائمة الانتظار من شاشة اختيار الوقت. عند إلغاء أحدهم يُحجز المقعد لمن انتظر أطول لمدة ١٥ دقيقة؛ إن كنت أنت، يظهر لك تنبيه في التطبيق (وإشعار إن سمحت بالإشعارات) — اضغط «احجز هذا الموعد». مكانك في القائمة ليس موعداً حتى تأخذ المقعد.',
    },
    actions: [],
    keywords: ['waitlist', 'wait list', 'full', 'fully booked', 'no times', 'available', 'انتظار', 'قائمه', 'محجوز', 'ممتلئ', 'فاضي', 'متاح'],
  },
  {
    key: 'review',
    label: { en: 'Leave a review', ar: 'كتابة تقييم' },
    answer: {
      en: 'Once the salon marks your visit as completed, it shows “Write a review” under Bookings → Past. A review can’t be written before then, and it’s final once posted. On the salon’s page it shows your first name and initial only.',
      ar: 'بعد أن يحدّد الصالون زيارتك كمكتملة، يظهر لك «اكتب تقييمًا» في «الحجوزات ← السابقة». لا يمكن التقييم قبل ذلك، والتقييم نهائي بعد نشره. يظهر في صفحة الصالون باسمك الأول والحرف الأول فقط.',
    },
    actions: [MY_BOOKINGS],
    keywords: ['review', 'rating', 'rate', 'stars', 'feedback', 'تقييم', 'قيم', 'نجوم', 'رايي', 'ملاحظات'],
  },
  {
    key: 'account',
    label: { en: 'My account', ar: 'حسابي' },
    answer: {
      en: 'Everything about your account is on the Profile tab: your name (the only thing a salon is shown about you), the app’s language, signing out, and “Delete my account”. There’s no password — each sign-in sends a fresh six-digit code.',
      ar: 'كل ما يخص حسابك في شاشة «حسابي»: اسمك (وهو الشيء الوحيد الذي يراه الصالون عنك)، ولغة التطبيق، وتسجيل الخروج، و«حذف حسابي». لا توجد كلمة مرور — كل تسجيل دخول يرسل رمزاً جديداً من ستة أرقام.',
    },
    actions: [
      { kind: 'go', screen: 'profile', label: { en: 'Open my profile', ar: 'افتح ملفي' } },
      { kind: 'go', screen: 'legal', label: { en: 'Privacy policy', ar: 'سياسة الخصوصية' } },
    ],
    keywords: [
      'account', 'profile', 'name', 'language', 'arabic', 'english', 'delete', 'sign in', 'login', 'log in', 'code', 'password', 'privacy',
      'حساب', 'ملف', 'اسم', 'لغه', 'عربي', 'انجليزي', 'حذف', 'دخول', 'رمز', 'كود', 'كلمه المرور', 'خصوصيه',
    ],
  },
  {
    key: 'salonQuestion',
    label: { en: 'Ask the salon', ar: 'سؤال للصالون' },
    answer: {
      en: 'Questions about a particular salon — parking, products, whether a service suits you, a price — are best answered by the salon itself. Its page also has its hours, phone number and directions when it has given them.',
      ar: 'الأسئلة الخاصة بصالون معيّن — المواقف، المنتجات، هل الخدمة تناسبك، سعر — أفضل من يجيب عليها الصالون نفسه. وصفحته فيها أوقات العمل ورقم الهاتف والموقع إن أضافها.',
    },
    actions: [TALK],
    keywords: [
      'parking', 'product', 'hours', 'open', 'location', 'where', 'address', 'phone', 'number', 'staff', 'stylist',
      'موقف', 'مواقف', 'منتج', 'دوام', 'ساعات', 'مفتوح', 'موقع', 'وين', 'عنوان', 'رقم', 'جوال', 'موظفه', 'مختصه',
    ],
  },
  {
    key: 'problem',
    label: { en: 'Something went wrong', ar: 'حصلت مشكلة' },
    answer: {
      en: 'I’m sorry. For a problem with a visit, the salon is who can put it right. For a problem with the app itself, or a complaint about a salon, write to Saloni and a member of our team will reply here.',
      ar: 'نأسف لذلك. إذا كانت المشكلة في الزيارة، فالصالون هو من يقدر يصلحها. وإذا كانت في التطبيق نفسه أو شكوى على صالون، راسل صالوني وسيرد عليك أحد أفراد فريقنا هنا.',
    },
    actions: [TALK],
    keywords: [
      'problem', 'issue', 'wrong', 'complain', 'complaint', 'bad', 'broken', 'bug', 'error', 'rude', 'late', 'not working',
      'مشكله', 'خطا', 'شكوى', 'اشتكي', 'سيء', 'سيئه', 'ما يشتغل', 'خربان', 'تاخير', 'زعلان',
    ],
  },
  {
    key: 'person',
    label: { en: 'Talk to a person', ar: 'التحدث مع شخص' },
    answer: {
      en: 'Of course. Who would you like to reach?',
      ar: 'بكل سرور. مع من تحب تتواصل؟',
    },
    actions: [],
    keywords: [
      'human', 'person', 'agent', 'someone', 'support', 'help desk', 'customer service', 'talk', 'speak', 'contact', 'call',
      'شخص', 'انسان', 'موظف', 'احد', 'دعم', 'خدمه العملاء', 'تواصل', 'اكلم', 'كلم', 'اتصل',
    ],
  },
];

export const GREETING: AssistantMessage = {
  who: 'bot',
  say: {
    en: 'Hi, I’m the Saloni Assistant. I can explain how booking, cancelling and the waitlist work — and if I can’t help, I’ll put you through to the salon or to our team. What would you like to know?',
    ar: 'مرحباً، أنا مساعد صالوني. أقدر أشرح لك الحجز والإلغاء وقائمة الانتظار — وإذا ما قدرت أساعدك أوصلك بالصالون أو بفريقنا. وش تحب تعرف؟',
  },
};

const NOT_SURE: Bilingual = {
  en: 'I’m not sure I understood that, and I’d rather not guess. You can pick one of the topics below, or I can put you through to a person.',
  ar: 'ما أنا متأكد إني فهمت، وما أبي أخمّن. اختر أحد المواضيع بالأسفل، أو أوصلك بشخص.',
};

/** The topic a free-text question is most likely about, or null. */
export function topicFor(question: string): Topic | null {
  const text = ` ${normalize(question)} `;
  if (!text.trim()) return null;

  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      const word = normalize(keyword);
      if (!word) continue;
      // Short Latin words must stand alone — "pay" should not match "paypal"
      // shopfront names, "open" not "opened" in a complaint. Arabic attaches
      // prefixes (و، ب، ال) to the word itself, so it is matched inside one.
      const latin = /^[a-z ]+$/.test(word);
      const found = latin
        ? new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(text)
        : text.includes(word);
      if (found) score += word.length > 4 ? 2 : 1;
    }
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

/** The assistant's reply to a topic chosen from a chip. */
export function answerForTopic(key: TopicKey): AssistantMessage {
  const topic = TOPICS.find((candidate) => candidate.key === key);
  if (!topic) return { who: 'bot', say: NOT_SURE, actions: [TALK] };
  return { who: 'bot', say: topic.answer, actions: topic.actions };
}

/**
 * The assistant's reply to something typed. A question about talking to a
 * person is answered with the people; anything unrecognised offers one.
 */
export function answerFor(question: string): { topic: TopicKey | null; message: AssistantMessage } {
  const topic = topicFor(question);
  if (!topic) return { topic: null, message: { who: 'bot', say: NOT_SURE, actions: [TALK] } };
  return { topic: topic.key, message: answerForTopic(topic.key) };
}

/** The chips under the conversation: every topic but "talk to a person", which is last. */
export const CHIPS: { key: TopicKey; label: Bilingual }[] = TOPICS.map((topic) => ({
  key: topic.key,
  label: topic.label,
}));
