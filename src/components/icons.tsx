interface IconProps {
  size?: number;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function PinIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2.4} aria-hidden="true">
      <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

export function ChatIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2} aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}

export function PhoneIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2} aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .8 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.4 1.9.7 2.9.8a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

export function SendIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2} aria-hidden="true">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CalendarCheckIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.9} aria-hidden="true">
      <rect x="4" y="5" width="16" height="16" rx="2.5" />
      <path d="M4 10h16M8 3v4M16 3v4M8.5 14.5l2.5 2.5 4.5-4.5" />
    </svg>
  );
}

export function UserIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.9} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function StorefrontIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.9} aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V8l7-4 7 4v13" />
      <path d="M9.5 21v-5h5v5" />
      <path d="M9 11h.01M15 11h.01" />
    </svg>
  );
}

export function CalendarIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.9} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

export function MenuIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
