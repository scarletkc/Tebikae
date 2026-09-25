import type { NoteColor } from '../../domain/types';

/**
 * Card surface per note color. Colored cards drop the visible border so the tint
 * reads as the card edge; the default card keeps `border-line`.
 */
export const cardColor = {
  default: 'bg-card-default',
  yellow: 'bg-card-yellow border-transparent',
  green: 'bg-card-green border-transparent',
  blue: 'bg-card-blue border-transparent',
  purple: 'bg-card-purple border-transparent',
  red: 'bg-card-red border-transparent',
} satisfies Record<NoteColor, string>;

/** Plain tinted background for small color swatches (filter choices, color picker). */
export const noteColorBg = {
  default: 'bg-card-default',
  yellow: 'bg-card-yellow',
  green: 'bg-card-green',
  blue: 'bg-card-blue',
  purple: 'bg-card-purple',
  red: 'bg-card-red',
} satisfies Record<NoteColor, string>;

/** Header tint for the editor dialog; the default note has no tint. */
export const editorTint = {
  yellow: '[--editor-tint:var(--card-yellow)]',
  green: '[--editor-tint:var(--card-green)]',
  blue: '[--editor-tint:var(--card-blue)]',
  purple: '[--editor-tint:var(--card-purple)]',
  red: '[--editor-tint:var(--card-red)]',
} satisfies Partial<Record<NoteColor, string>>;
