import type { PayMethod } from '../types';

/**
 * How a customer says they will pay **at the salon**. Nothing is paid through
 * Saloni, so this records an intention and nothing more.
 *
 * This list used to show "mada •••• 4921", "Visa •••• 7734", an STC Pay
 * "wallet balance SAR 340" and Tabby / Tamara instalments — saved cards and a
 * balance that did not exist, and credit offers nobody had agreed to provide.
 * Each was a claim about the customer's own money that the app could not back.
 */
export const PAY_METHODS: PayMethod[] = [
  {
    id: 'cash',
    name: 'Cash',
    nameAr: 'نقداً',
    badge: 'SAR',
    badgeBg: '#f4f1ea',
    badgeFg: '#1c1913',
    badgeBd: '#d8d2c6',
  },
  {
    id: 'mada',
    name: 'mada card',
    nameAr: 'بطاقة مدى',
    badge: 'mada',
    badgeBg: '#fff',
    badgeFg: '#0f7a6b',
    badgeBd: '#0f7a6b',
  },
  {
    id: 'card',
    name: 'Visa or Mastercard',
    nameAr: 'فيزا أو ماستركارد',
    badge: 'CARD',
    badgeBg: '#1a1f71',
    badgeFg: '#fff',
    badgeBd: '#1a1f71',
  },
  {
    id: 'applepay',
    name: 'Apple Pay',
    nameAr: 'أبل باي',
    badge: 'Pay',
    badgeBg: '#000',
    badgeFg: '#fff',
    badgeBd: '#000',
  },
  {
    id: 'stc',
    name: 'STC Pay',
    nameAr: 'إس تي سي باي',
    badge: 'stc',
    badgeBg: '#4f008c',
    badgeFg: '#fff',
    badgeBd: '#4f008c',
  },
];
