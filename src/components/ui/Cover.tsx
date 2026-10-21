import { useState } from 'react';
import type { ImageRef } from '@/lib/types';

interface Props {
  image: ImageRef | null;
  /** Used for the typographic fallback when there is no image. */
  label?: string;
  className?: string;
  ratio?: string;
  priority?: boolean;
  sizes?: string;
}

/**
 * Article image with reserved space (no layout shift) and a designed
 * fallback for articles without an image or with a broken one.
 */
export function Cover({ image, label = '', className = '', ratio = '16 / 10', priority = false }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = image?.src && !failed;
  return (
    <div className={`relative overflow-hidden bg-charcoal ${className}`} style={{ aspectRatio: ratio }}>
      {showImage ? (
        <img
          src={image.src}
          alt={image.alt ?? ''}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-end overflow-hidden p-5" aria-hidden>
          <span className="pointer-events-none absolute -right-4 -top-10 select-none font-serif text-[11rem] leading-none text-copper/20">
            {(label.trim()[0] ?? 'E').toUpperCase()}
          </span>
          <span className="relative h-px w-12 bg-copper/70" />
        </div>
      )}
    </div>
  );
}
