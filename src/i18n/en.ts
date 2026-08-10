export const en = {
  chTag: "Book the Kingdom's finest salons — or grow your own. Choose how you'd like to enter.",
  chCust: "I'm a customer",
  chCustSub: 'Browse & book appointments',
  chVend: 'I own a salon',
  chVendSub: 'Manage bookings & staff',

  location: 'LOCATION',
  city: 'Riyadh, Al Olaya',
  featEyebrow: 'THIS WEEK · FEATURED',
  headline1: 'Book beauty,',
  headline2: 'beautifully.',
  nearYou: 'Near you',
  seeAll: 'See all',
  noSalons: 'No salons in this category yet.',

  openNow: 'Open now',
  until: 'until 11:00 PM',
  privateRooms: 'Private rooms',
  services: 'Services',
  continue_: 'Continue',
  chooseSpecialist: 'Choose your specialist',
  pickTime: 'Pick a time',

  selectDateTime: 'Select date & time',
  month: 'July 2026',
  availableSlots: 'Available slots',
  reschedulingNote: 'Rescheduling — choose a new time',

  reviewPay: 'Review & pay',
  step3: 'Step 3 of 3',
  subtotal: 'Subtotal',
  discount: 'Discount',
  vat: 'VAT (15%)',
  total: 'Total',
  paymentMethod: 'Payment method',
  confirmPay: 'Confirm & pay',

  booked: "You're booked!",
  bookingRef: 'Booking ref',
  paid: 'Paid',
  viewBookings: 'View my bookings',
  backHome: 'Back to home',

  ratingsReviews: 'Ratings & reviews',
  myBookings: 'My bookings',
  upcoming: 'Upcoming',
  past: 'Past',
  reschedule: 'Reschedule',
  directions: 'Directions',

  userName: 'Nora Al-Harbi',
  switchVendor: 'Switch to vendor portal',

  registerSalon: 'Register your salon',
  registerDesc: "Join the Kingdom's premium salon network. It takes about 5 minutes.",
  dropPin: 'DROP PIN · MAP LOCATION',
  createSalon: 'Create salon & open dashboard',

  goodMorning: 'Good morning ✦',
  todaySchedule: "Today's schedule",
  calendarArrow: 'Calendar ›',
  bookingsTitle: 'Bookings',
  add: '+ Add',

  servicesPricing: 'Services & pricing',
  addService: '+ Add a service',
  staff: 'Staff',
  edit: 'Edit',
  addStaff: '+ Add team member',

  photoGallery: 'Photo gallery',
  galleryDesc:
    'High-quality photos boost bookings by up to 3×. The first photo is your cover.',
  cover: 'COVER',
  upload: 'Upload',

  reviewsTitle: 'Reviews',
  ownerReply: 'Owner reply · ',
  tapReview: 'Tap a review to reply',
  verified: 'Al Olaya, Riyadh · Verified',
  switchCustomer: 'Switch to customer app',

  explore: 'Explore',
  bookingsTab: 'Bookings',
  profile: 'Profile',
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  servicesTab: 'Services',
  more: 'More',

  newService: 'New service',
  svcNamePh: 'Service name',
  pricePh: 'Price (SAR)',
  durPh: 'e.g. 45 min',
  cancel: 'Cancel',
  save: 'Save',
  newStaff: 'New team member',
  staffNamePh: 'Full name',
  rolePh: 'Role',

  linkCopied: 'Link copied ✓',
  openingMaps: 'Opening in Maps…',
  withWord: 'with',
  step1: 'Step 1 of 3',
  step2: 'Step 2 of 3',

  message: 'Message',
  callNow: 'Call',
  repliesFast: 'Typically replies in ~10 min',
  assistant: 'Assistant',
  assistantName: 'Saloni Assistant',
  assistantSub: 'AI support · always here to help',
  typeMessage: 'Type a message…',

  fullyBooked: 'This day is fully booked',
  waitlistDesc:
    "Join the waitlist and we'll notify you the moment a spot opens up on this date.",
  joinWaitlist: 'Join the waitlist',
  onWaitlist: "You're on the waitlist — we'll notify you the second a seat frees up.",
  waitlistClosed: "The salon isn't accepting waitlist requests for this day.",
  seatOpenedNote: 'A spot just opened — grab the highlighted slot below!',

  seatBannerTitle: 'A spot opened at Maison Noir!',
  seatBannerSub: "Tap to book before it's gone",
  waitlistTitle: 'Waitlist',
  enableWaitlist: 'Accept waitlist requests',
  enableWaitlistSub:
    "Let customers join a waitlist when you're fully booked. They're auto-notified the moment a client cancels.",
  waiting: 'Currently waiting',
  notify: 'Notify',
  waitlistOffMsg:
    "Waitlist is turned off. Customers won't be able to join when you're fully booked.",
};

/** Every dictionary carries the same keys; values are plain strings. */
export type Dictionary = Record<keyof typeof en, string>;
