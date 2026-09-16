import type { CSSProperties } from 'react';

/**
 * A label color is only trusted after it is re-validated here. GitHub normally returns
 * six hexadecimal digits without the '#' prefix, but stored or remote data may be
 * corrupted, so anything else falls back to the neutral theme accent.
 */
export function safeLabelColor(color: string | null | undefined): string | null {
  return typeof color === 'string' && /^[0-9a-fA-F]{6}$/u.test(color.trim())
    ? `#${color.trim().toLowerCase()}`
    : null;
}

export function labelStyle(color: string | null | undefined): CSSProperties | undefined {
  const hex = safeLabelColor(color);
  return hex ? ({ '--label-color': hex } as CSSProperties) : undefined;
}
