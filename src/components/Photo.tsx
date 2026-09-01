import { useState, type CSSProperties } from 'react';

/**
 * A photograph where the app used to draw a coloured placeholder.
 *
 * Every salon picture in Saloni is optional — most salons have none, and the
 * striped tiles are a deliberate design, not a "loading" state. So this takes
 * both: the tile is painted underneath and the photograph over it, which also
 * means a slow image reveals the tile rather than a white hole.
 *
 * A photograph that fails to load falls back to the tile too. The URLs point at
 * a public bucket, so a deleted object 404s for as long as a stale row survives
 * — a broken-image icon on a salon's own page is the worst of the three
 * outcomes and the easiest to avoid.
 *
 * It renders spans rather than divs on purpose: several of these sit inside a
 * <button>, which may only contain phrase content.
 */
export function Photo({
  src,
  tile,
  alt = '',
  style,
}: {
  src?: string;
  tile: string;
  /** Empty — the default — when the salon's name is already beside it. */
  alt?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const showing = src && !failed;

  return (
    <span
      // Decorative when it carries no alt text: the name beside it says which
      // salon this is, and a screen reader announcing the picture too is noise.
      aria-hidden={alt ? undefined : 'true'}
      style={{
        display: 'block',
        position: 'relative',
        overflow: 'hidden',
        background: tile,
        ...style,
      }}
    >
      {showing ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : null}
    </span>
  );
}
