import type { ReactNode } from 'react';

interface PhoneFrameProps {
  dir: 'ltr' | 'rtl';
  lang: string;
  children: ReactNode;
}

/**
 * The device shell the prototype is presented in: a bezel on desktop, and a
 * plain full-bleed surface once the viewport is phone sized (see global.css).
 */
export function PhoneFrame({ dir, lang, children }: PhoneFrameProps) {
  return (
    <div className="stage">
      <div className="bezel">
        <div className="viewport" dir={dir} lang={lang}>
          <div className="notch" aria-hidden="true" />
          {children}
        </div>
      </div>
    </div>
  );
}
