import type { ReactNode } from 'react';
import { color, font } from '../theme';

export interface TabItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface TabBarProps {
  items: TabItem[];
  activeKey: string;
  label: string;
}

/** The bottom navigation shared by the customer app and the vendor portal. */
export function TabBar({ items, activeKey, label }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      style={{
        position: 'absolute',
        bottom: 0,
        insetInline: 0,
        height: 76,
        background: color.surface,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingBottom: 12,
        borderTop: `1px solid ${color.line}`,
        zIndex: 50,
      }}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              font: `600 9.5px ${font.sans}`,
              color: active ? color.goldInkAlt : color.mutedFaint,
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
