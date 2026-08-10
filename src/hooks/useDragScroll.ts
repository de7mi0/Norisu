import { useEffect } from 'react';

/**
 * Lets the horizontal rails (`.hscroll`) be dragged with a mouse, the way they
 * behave in the prototype. Touch devices already scroll them natively.
 */
export function useDragScroll(): void {
  useEffect(() => {
    let rail: HTMLElement | null = null;
    let startX = 0;
    let startScrollLeft = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const target = event.target as HTMLElement | null;
      const candidate = target?.closest?.('.hscroll') as HTMLElement | null;
      if (!candidate) return;
      rail = candidate;
      startX = event.clientX;
      startScrollLeft = candidate.scrollLeft;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!rail) return;
      rail.scrollLeft = startScrollLeft - (event.clientX - startX);
    };

    const onPointerUp = () => {
      rail = null;
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);
}
