import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { SheetModal } from '../../components/SheetModal';
import type { CropRect } from '../../lib/images';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';

/**
 * Framing a photograph before it is uploaded: drag to move it, pinch or use
 * the slider to zoom, and choose the shape it will be shown in.
 *
 * Nothing is cut here. The sheet works out which rectangle of the original
 * the owner framed and hands that to `prepareImage()`, which draws only those
 * pixels onto its canvas — the same re-encode that strips the photograph's
 * GPS coordinates, so framing cannot weaken that.
 *
 * Coordinates: the picture is drawn at `scale` (screen pixels per image
 * pixel) with its top-left corner at `offset` inside the frame. It always
 * covers the frame — `clamp` keeps an edge from being dragged inside it,
 * which would upload a white band.
 */

type Shape = 'wide' | 'square' | 'original';

const SHAPES: Record<Exclude<Shape, 'original'>, number> = { wide: 16 / 9, square: 1 };
const MAX_ZOOM = 4;

interface Props {
  file: File;
  /** The first photograph becomes the salon's cover, which is shown wide. */
  isCover: boolean;
  onCancel: () => void;
  /** The browser could not show it — handed back so the usual error is shown. */
  onUnreadable: () => void;
  onConfirm: (crop: CropRect) => void;
}

export function PhotoCropSheet({ file, isCover, onCancel, onUnreadable, onConfirm }: Props) {
  const { t } = useApp();
  const sliderId = useId();

  const [url, setUrl] = useState('');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [shape, setShape] = useState<Shape>(isCover ? 'wide' : 'square');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frameWidth, setFrameWidth] = useState(0);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useLayoutEffect(() => {
    const measure = () => setFrameWidth(holder.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const aspect = shape === 'original' ? (natural ? natural.w / natural.h : 4 / 3) : SHAPES[shape];
  // Never taller than half the screen, so the controls stay in view.
  const maxHeight = Math.round(window.innerHeight * 0.45);
  const frame = (() => {
    const w = frameWidth;
    const h = w / aspect;
    return h > maxHeight ? { w: maxHeight * aspect, h: maxHeight } : { w, h };
  })();

  // The smallest scale at which the picture still covers the frame; zoom
  // multiplies it.
  const baseScale = natural ? Math.max(frame.w / natural.w, frame.h / natural.h) : 1;
  const scale = baseScale * zoom;

  const clamp = (x: number, y: number, s = scale) =>
    natural
      ? {
          x: Math.min(0, Math.max(frame.w - natural.w * s, x)),
          y: Math.min(0, Math.max(frame.h - natural.h * s, y)),
        }
      : { x: 0, y: 0 };

  // Re-centre whenever the frame's shape changes or the picture arrives.
  useEffect(() => {
    if (!natural || !frame.w) return;
    const s = Math.max(frame.w / natural.w, frame.h / natural.h);
    setZoom(1);
    setOffset({ x: (frame.w - natural.w * s) / 2, y: (frame.h - natural.h * s) / 2 });
  }, [natural, frame.w, frame.h]);

  /** Zooms about a point in the frame, so what is under it stays under it. */
  const zoomTo = (next: number, about = { x: frame.w / 2, y: frame.h / 2 }) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const ratio = z / zoom;
    setZoom(z);
    setOffset((o) =>
      clamp(about.x - (about.x - o.x) * ratio, about.y - (about.y - o.y) * ratio, baseScale * z),
    );
  };

  // Pointer handling: one pointer drags, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance), {
        x: (a.x + b.x) / 2 - rect.left,
        y: (a.y + b.y) / 2 - rect.top,
      });
    } else if (pointers.current.size === 1) {
      setOffset((o) => clamp(o.x + now.x - last.x, o.y + now.y - last.y));
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const crop = (): CropRect => ({
    x: -offset.x / scale,
    y: -offset.y / scale,
    width: frame.w / scale,
    height: frame.h / scale,
  });

  const shapeLabels: Record<Shape, string> = {
    wide: t.cropWide,
    square: t.cropSquare,
    original: t.cropOriginal,
  };

  return (
    <SheetModal
      title={t.cropTitle}
      cancelLabel={t.cancel}
      saveLabel={t.cropUse}
      saveDisabled={!natural}
      onCancel={onCancel}
      onSave={() => onConfirm(crop())}
    >
      <div ref={holder} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div
          role="application"
          aria-label={t.cropHint}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            zoomTo(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
          }}
          onKeyDown={(event) => {
            const step = 12;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [step, 0],
              ArrowRight: [-step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              setOffset((o) => clamp(o.x + move[0], o.y + move[1]));
            }
          }}
          style={{
            position: 'relative',
            width: frame.w,
            height: frame.h,
            overflow: 'hidden',
            borderRadius: 14,
            background: color.surfaceSand,
            touchAction: 'none',
            cursor: 'grab',
            // Pixels, not text: the frame is the same whichever way the app reads.
            direction: 'ltr',
          }}
        >
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              onError={onUnreadable}
              onLoad={(event) =>
                setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
              }
              style={{
                position: 'absolute',
                left: offset.x,
                top: offset.y,
                width: natural ? natural.w * scale : 'auto',
                height: natural ? natural.h * scale : 'auto',
                maxWidth: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          ) : null}
          {/* Thirds, the way a phone camera frames a shot. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              backgroundImage:
                'linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.45) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.45) 66.6%, transparent 66.8%),' +
                'linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.45) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.45) 66.6%, transparent 66.8%)',
            }}
          />
        </div>
      </div>

      <p style={{ font: `500 11px/1.5 ${font.sans}`, color: color.mutedFaint, margin: '8px 0 10px', textAlign: 'center' }}>
        {t.cropHint}
      </p>

      <label
        htmlFor={sliderId}
        style={{ display: 'block', font: `600 11px ${font.sans}`, color: color.mutedSoft, marginBottom: 4 }}
      >
        {t.cropZoom}
      </label>
      <input
        id={sliderId}
        type="range"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(event) => zoomTo(Number(event.target.value))}
        style={{ width: '100%', accentColor: color.gold, marginBottom: 12 }}
      />

      <div role="radiogroup" aria-label={t.cropShape} style={{ display: 'flex', gap: 7, marginBottom: 16 }}>
        {(['wide', 'square', 'original'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={shape === option}
            onClick={() => setShape(option)}
            className="press"
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: 11,
              font: `600 12px ${font.sans}`,
              background: shape === option ? color.ink : color.surfaceSand,
              color: shape === option ? '#fff' : color.inkSoft,
              border: `1px solid ${shape === option ? color.ink : color.lineSand}`,
            }}
          >
            {shapeLabels[option]}
          </button>
        ))}
      </div>
    </SheetModal>
  );
}
